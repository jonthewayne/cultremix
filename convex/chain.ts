import { ConvexError, v } from "convex/values";
import { BaseError, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  
  assertDeploymentConsistency,
  assertRelayerAddress,
  assertRpcChainId,
  explorerAddressUrl,
  explorerNetwork
} from "../shared/config/chains";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendRequestedCorrections } from "./amendments";
import { decodeRegistryRevert, revertHandling } from "./lib/chain/calldata";
import { signForMember } from "./lib/chain/custody";
import { chainDeps } from "./lib/chain/deps";
import { backTypedData, registerWorkTypedData, registryDomain, signatureDeadline } from "./lib/chain/eip712";
import { chainWritesEnabled, promoteDependents, promoteWrite } from "./lib/chain/queue";
import {
  INCLUSION_BLOCKS,
  MAX_REPLACEMENTS,
  
  
  bumpedFees,
  eventOutcome,
  gasLimitFor,
  needsMemberSignature,
  parsePayload,
  readRegistry,
  reconcileFromState,
  writeCalldata
} from "./lib/chain/writes";
import { requirePlatformCapability, requireSuperAdmin } from "./lib/permissions";
import { recordBackConfirmed } from "./lib/social";
import { chainTables, chainTxValidator } from "./schema/chain";
import type { WritePayload, WriteResult } from "./lib/chain/writes";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { ChainDeployment } from "../shared/config/chains";
import type { RegistryErrorName } from "./lib/chain/calldata";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { Doc, Id } from "./_generated/dataModel";
import type { ChainBlock, ChainReceipt, ChainRpc } from "./lib/chain/rpc";

// The relayer's chain-write engine ("Chain write outcomes" in the V1 plan). One tick at a time
// holds the relayer lease for a (chain, relayer) pair; every mutation that touches nonces or
// outcomes checks the lease generation, so a tick that lost its lease can't write. A tick:
//   A. follows submitted writes to a finalized, canonical receipt, rebroadcasting the persisted
//      raw transaction, replacing it at +20% fees after 30 blocks (3 times at most), then stalling;
//   B. promotes writes whose wallet or parent gate opened;
//   C. when chain.writes is on, signs and sends pending writes. Each raw transaction, hash, and
//      nonce is persisted before it is broadcast, so a tick that dies resumes from it.
// MONAD_RELAYER_PRIVATE_KEY is read here only and never logged or stored.

const LEASE_MS = 2 * 60_000;
// Re-sign a member signature with less than this left before its deadline.
const RESIGN_MARGIN_MS = 60_000;
const SEND_BATCH = 10;
const TICK_AGAIN_MS = 2_000;
const TICK_WHILE_STALLED_MS = 30_000;
const ERROR_RETRY_MS = 15_000;
const DEFER_BASE_MS = 5_000;
const DEFER_MAX_MS = 5 * 60_000;
const LEASE_LOST = "LEASE_LOST";

const writeDocValidator = v.object({
  _id: v.id("chainWrites"),
  _creationTime: v.number(),
  ...chainTables.chainWrites.validator.fields,
});
const relayerStateDocValidator = v.object({
  _id: v.id("relayerState"),
  _creationTime: v.number(),
  ...chainTables.relayerState.validator.fields,
});
const resultValidator = v.object({ ordinal: v.number(), week: v.number() });
const leaseArgs = { key: v.string(), generation: v.number() };

type Lease = { key: string; generation: number };
type WriteDoc = Doc<"chainWrites">;
// Annotated where actions read them back, which keeps internal.chain's types from referring to themselves.
type TickWork = { state: Doc<"relayerState"> | null; enabled: boolean; submitted: Array<WriteDoc>; pending: Array<WriteDoc> };
type StallInfo = { state: Doc<"relayerState"> | null; stuck: WriteDoc | null; highestSubmittedNonce: number | null };

// ------------------------------------------------------------------ relayer

class RelayerKeyError extends Error {}

function relayerAccount(): PrivateKeyAccount {
  const key = process.env.MONAD_RELAYER_PRIVATE_KEY?.trim();
  if (!key) throw new RelayerKeyError("MONAD_RELAYER_PRIVATE_KEY is not set.");
  if (!/^0x[0-9a-fA-F]{64}$/u.test(key)) throw new RelayerKeyError("MONAD_RELAYER_PRIVATE_KEY is not a 32-byte hex key.");
  try {
    return privateKeyToAccount(key as Hex);
  } catch {
    throw new RelayerKeyError("MONAD_RELAYER_PRIVATE_KEY is not a valid key.");
  }
}

/** An error's message without request bodies or stack, short enough to store. */
function errorText(error: unknown) {
  if (error instanceof BaseError) return [error.shortMessage, error.details].filter(Boolean).join(" ").slice(0, 300);
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function isLeaseLost(error: unknown) {
  if (error instanceof ConvexError) return (error.data as { code?: string } | undefined)?.code === LEASE_LOST;
  return error instanceof Error && error.message.includes(LEASE_LOST);
}

function sameAddress(a: string | undefined, b: string) {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

type Relayer = {
  deployment: ChainDeployment;
  registry: Address;
  account: PrivateKeyAccount;
  rpc: ChainRpc;
  chainId: number;
  key: string;
};

/**
 * Everything checked before the relayer touches the chain, failing closed: the deployment matrix,
 * a deployed registry, the relayer key belonging to this environment, the RPC's chain ID, and the
 * registry listing this relayer (which also catches a wrong registry address).
 */
async function connectRelayer(): Promise<{ ok: true; relayer: Relayer } | { ok: false; reason: string }> {
  try {
    const deployment = assertDeploymentConsistency(process.env);
    if (!deployment.registryAddress) return { ok: false, reason: `No registry is deployed for ${deployment.env} yet.` };
    const account = relayerAccount();
    assertRelayerAddress(deployment, account.address);
    const rpc = chainDeps().rpc(deployment.rpcUrl);
    const chainId = await rpc.getChainId();
    assertRpcChainId(deployment, chainId);
    let listed: unknown;
    try {
      listed = await readRegistry(rpc, deployment.registryAddress, account.address, "isRelayer", [account.address], "latest");
    } catch {
      return { ok: false, reason: "The registry address did not answer as a CultRemix registry." };
    }
    if (listed !== true) return { ok: false, reason: "The registry does not list this relayer." };
    return {
      ok: true,
      relayer: {
        deployment,
        registry: deployment.registryAddress,
        account,
        rpc,
        chainId,
        key: `${chainId}:${account.address.toLowerCase()}`,
      },
    };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

type SignedTx = {
  hash: string;
  rawTx: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  sentBlock: number;
  sentAt: number;
};

async function signTx(
  relayer: Relayer,
  args: { nonce: number; to: Address; data: Hex; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  latestBlock: bigint,
): Promise<SignedTx> {
  const rawTx = await relayer.account.signTransaction({
    type: "eip1559",
    chainId: relayer.chainId,
    nonce: args.nonce,
    to: args.to,
    data: args.data,
    value: 0n,
    gas: args.gas,
    maxFeePerGas: args.maxFeePerGas,
    maxPriorityFeePerGas: args.maxPriorityFeePerGas,
  });
  return {
    hash: keccak256(rawTx),
    rawTx,
    gas: args.gas.toString(),
    maxFeePerGas: args.maxFeePerGas.toString(),
    maxPriorityFeePerGas: args.maxPriorityFeePerGas.toString(),
    sentBlock: Number(latestBlock),
    sentAt: Date.now(),
  };
}

// Node answers that mean the transaction is already there or its nonce is already used; the next
// tick reads the outcome from receipts and nonces.
const BENIGN_BROADCAST = /already known|known transaction|already imported|nonce too low|lower than the current nonce|underpriced/iu;

async function broadcast(ctx: ActionCtx, relayer: Relayer, lease: Lease, writeId: Id<"chainWrites"> | null, rawTx: string) {
  try {
    await relayer.rpc.sendRawTransaction(rawTx as Hex);
    return true;
  } catch (error) {
    const message = errorText(error);
    if (BENIGN_BROADCAST.test(message)) return true;
    if (writeId) await ctx.runMutation(internal.chain.recordBroadcastError, { ...lease, writeId, error: message });
    return false;
  }
}

// ------------------------------------------------------------------ lease

async function relayerStateByKey(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query("relayerState")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** Checks the caller still holds the lease and extends it. Throws (rolling back) when it doesn't. */
async function fence(ctx: MutationCtx, lease: Lease) {
  const state = await relayerStateByKey(ctx, lease.key);
  const now = Date.now();
  if (!state || state.leaseGeneration !== lease.generation || state.leaseExpiresAt <= now) {
    throw new ConvexError({ code: LEASE_LOST, message: "The relayer lease moved to another tick." });
  }
  await ctx.db.patch("relayerState", state._id, { leaseExpiresAt: now + LEASE_MS });
  return state;
}

export const acquireLease = internalMutation({
  args: { key: v.string(), owner: v.string(), chainId: v.number(), relayerAddress: v.string() },
  returns: v.union(v.null(), v.object({ generation: v.number() })),
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await relayerStateByKey(ctx, args.key);
    if (!state) {
      await ctx.db.insert("relayerState", {
        key: args.key,
        chainId: args.chainId,
        relayerAddress: args.relayerAddress,
        leaseOwner: args.owner,
        leaseGeneration: 1,
        leaseExpiresAt: now + LEASE_MS,
      });
      return { generation: 1 };
    }
    if (state.leaseExpiresAt > now && state.leaseOwner !== args.owner) return null;
    const generation = state.leaseGeneration + 1;
    await ctx.db.patch("relayerState", state._id, { leaseOwner: args.owner, leaseGeneration: generation, leaseExpiresAt: now + LEASE_MS });
    return { generation };
  },
});

export const releaseLease = internalMutation({
  args: { ...leaseArgs, lastError: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await relayerStateByKey(ctx, args.key);
    if (!state || state.leaseGeneration !== args.generation) return null;
    await ctx.db.patch("relayerState", state._id, {
      leaseOwner: undefined,
      leaseExpiresAt: 0,
      lastTickAt: Date.now(),
      lastError: args.lastError,
    });
    return null;
  },
});

// ------------------------------------------------------------------ outcomes

function backoffMs(attempts: number) {
  return Math.min(DEFER_BASE_MS * 2 ** attempts, DEFER_MAX_MS);
}

const BACK_REJECTIONS: Partial<Record<string, string>> = {
  WeeklyBackLimit: "You've used your 3 Backs for this registry week.",
  SelfBack: "You can't Back your own work.",
};

/** Mirrors a write's progress onto its work (provenance), Back, or lineage correction. */
async function reflect(
  ctx: MutationCtx,
  write: WriteDoc,
  update:
    | { status: "submitted"; txHash: string }
    | { status: "pending" }
    | { status: "confirmed"; txHash?: string; result?: WriteResult }
    | { status: "rejected" | "failed"; error: string; revertReason?: string },
) {
  const now = Date.now();
  if (write.kind === "registerWork" && write.workId) {
    const patch =
      update.status === "confirmed"
        ? { provenanceStatus: "confirmed" as const, chainTxHash: update.txHash, provenanceConfirmedAt: now }
        : update.status === "submitted"
          ? { provenanceStatus: "submitted" as const, chainTxHash: update.txHash }
          : update.status === "pending"
            ? { provenanceStatus: "pending" as const }
            : { provenanceStatus: "failed" as const };
    if (await ctx.db.get("works", write.workId)) await ctx.db.patch("works", write.workId, patch);
  }
  if (write.kind === "back" && write.backId) {
    const back = await ctx.db.get("backs", write.backId);
    if (!back) return;
    if (update.status === "confirmed") {
      const result = update.result;
      await ctx.db.patch("backs", back._id, {
        status: "confirmed",
        ordinal: result?.ordinal,
        // A Back reconciled from state has no event; it keeps the week it was admitted in.
        week: result && result.week >= 0 ? result.week : back.week,
        txHash: update.txHash,
        error: undefined,
        confirmedAt: now,
      });
      await recordBackConfirmed(ctx, back, now);
    } else if (update.status === "submitted") {
      await ctx.db.patch("backs", back._id, { status: "submitted", txHash: update.txHash });
    } else if (update.status === "pending") {
      await ctx.db.patch("backs", back._id, { status: "reserved" });
    } else {
      // Rejected and failed Backs no longer count toward the weekly limit.
      const error = (update.revertReason && BACK_REJECTIONS[update.revertReason]) ?? update.error;
      await ctx.db.patch("backs", back._id, { status: update.status, error });
    }
  }
  // A correction confirmed onchain takes effect offchain from the same moment (convex/lineage.ts).
  if (write.kind === "amendLineage" && write.amendmentId) {
    if (update.status === "confirmed") {
      await ctx.runMutation(internal.lineage.markConfirmed, { amendmentId: write.amendmentId, confirmedAt: now });
    } else if (update.status === "rejected" || update.status === "failed") {
      await ctx.runMutation(internal.lineage.markRejected, { amendmentId: write.amendmentId, reason: update.error });
    }
  }
}

const outcomeValidator = v.union(
  v.object({
    type: v.literal("confirm"),
    txHash: v.optional(v.string()),
    blockNumber: v.optional(v.number()),
    result: v.optional(resultValidator),
  }),
  v.object({
    type: v.literal("settle"),
    status: v.union(v.literal("rejected"), v.literal("failed")),
    error: v.string(),
    revertReason: v.optional(v.string()),
    txHash: v.optional(v.string()),
    blockNumber: v.optional(v.number()),
  }),
  // Back to pending with a fresh nonce (the old one is consumed); optionally a fresh signature too.
  v.object({ type: v.literal("requeue"), reason: v.string(), clearSignature: v.boolean(), revertReason: v.optional(v.string()) }),
  // Stays pending; tried again after a backoff.
  v.object({ type: v.literal("defer"), error: v.string() }),
);

async function requeue(ctx: MutationCtx, write: WriteDoc, reason: string, clearSignature: boolean, revertReason?: string) {
  await ctx.db.patch("chainWrites", write._id, {
    status: "pending",
    nonce: undefined,
    txs: [],
    replacements: 0,
    lastBroadcastError: undefined,
    txHash: undefined,
    error: reason,
    revertReason,
    ...(clearSignature ? { signature: undefined, signatureDeadline: undefined } : {}),
    nextAttemptAt: undefined,
    updatedAt: Date.now(),
  });
  await reflect(ctx, write, { status: "pending" });
}

export const applyOutcome = internalMutation({
  args: { ...leaseArgs, writeId: v.id("chainWrites"), outcome: outcomeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await fence(ctx, args);
    const write = await ctx.db.get("chainWrites", args.writeId);
    if (!write || write.status === "confirmed" || write.status === "rejected" || write.status === "failed") return null;
    const now = Date.now();
    const outcome = args.outcome;
    switch (outcome.type) {
      case "confirm":
        await ctx.db.patch("chainWrites", write._id, {
          status: "confirmed",
          txHash: outcome.txHash,
          blockNumber: outcome.blockNumber,
          result: outcome.result,
          error: undefined,
          confirmedAt: now,
          updatedAt: now,
        });
        await reflect(ctx, write, { status: "confirmed", txHash: outcome.txHash, result: outcome.result });
        await promoteDependents(ctx, write._id);
        break;
      case "settle":
        await ctx.db.patch("chainWrites", write._id, {
          status: outcome.status,
          error: outcome.error,
          revertReason: outcome.revertReason,
          txHash: outcome.txHash ?? write.txHash,
          blockNumber: outcome.blockNumber,
          updatedAt: now,
        });
        await reflect(ctx, write, { status: outcome.status, error: outcome.error, revertReason: outcome.revertReason });
        break;
      case "requeue":
        await requeue(ctx, write, outcome.reason, outcome.clearSignature, outcome.revertReason);
        break;
      case "defer":
        if (write.status !== "pending") return null;
        await ctx.db.patch("chainWrites", write._id, {
          error: outcome.error,
          attempts: write.attempts + 1,
          nextAttemptAt: now + backoffMs(write.attempts),
          updatedAt: now,
        });
        break;
    }
    return null;
  },
});

export const recordSignature = internalMutation({
  args: {
    ...leaseArgs,
    writeId: v.id("chainWrites"),
    signature: v.string(),
    signatureDeadline: v.number(),
    signer: v.string(),
    chainId: v.number(),
    registryAddress: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await fence(ctx, args);
    const write = await ctx.db.get("chainWrites", args.writeId);
    if (!write || write.status !== "pending") return false;
    await ctx.db.patch("chainWrites", write._id, {
      signature: args.signature,
      signatureDeadline: args.signatureDeadline,
      signer: args.signer,
      chainId: args.chainId,
      registryAddress: args.registryAddress,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/** Persists a signed transaction before it is broadcast: a write's first, or a fee replacement. */
export const recordTx = internalMutation({
  args: {
    ...leaseArgs,
    writeId: v.id("chainWrites"),
    nonce: v.number(),
    tx: chainTxValidator,
    replacement: v.boolean(),
    chainId: v.number(),
    registryAddress: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await fence(ctx, args);
    const write = await ctx.db.get("chainWrites", args.writeId);
    if (!write) return false;
    const now = Date.now();
    if (args.replacement) {
      if (write.status !== "submitted" || write.nonce !== args.nonce) return false;
      await ctx.db.patch("chainWrites", write._id, {
        txs: [...write.txs, args.tx],
        replacements: write.replacements + 1,
        txHash: args.tx.hash,
        updatedAt: now,
      });
    } else {
      if (write.status !== "pending") return false;
      await ctx.db.patch("chainWrites", write._id, {
        status: "submitted",
        nonce: args.nonce,
        txs: [args.tx],
        replacements: 0,
        txHash: args.tx.hash,
        lastBroadcastError: undefined,
        chainId: args.chainId,
        registryAddress: args.registryAddress,
        attempts: write.attempts + 1,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      await reflect(ctx, write, { status: "submitted", txHash: args.tx.hash });
    }
    await ctx.db.patch("relayerState", state._id, { nextNonce: Math.max(state.nextNonce ?? 0, args.nonce + 1) });
    return true;
  },
});

export const recordBroadcastError = internalMutation({
  args: { ...leaseArgs, writeId: v.id("chainWrites"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await fence(ctx, args);
    const write = await ctx.db.get("chainWrites", args.writeId);
    if (write?.status === "submitted") {
      await ctx.db.patch("chainWrites", write._id, { lastBroadcastError: args.error, updatedAt: Date.now() });
    }
    return null;
  },
});

export const setStalled = internalMutation({
  args: { ...leaseArgs, nonce: v.number(), writeId: v.optional(v.id("chainWrites")), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await fence(ctx, args);
    if (state.stalled) return null;
    await ctx.db.patch("relayerState", state._id, {
      stalled: { nonce: args.nonce, writeId: args.writeId, since: Date.now(), reason: args.reason },
    });
    return null;
  },
});

export const dropClearTx = internalMutation({
  args: leaseArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await fence(ctx, args);
    await ctx.db.patch("relayerState", state._id, { clearTx: undefined });
    return null;
  },
});

/**
 * Ends a stall and lets held writes go. With a clearing self-transfer, the stuck write goes back to
 * pending for a fresh nonce; without one (its nonce went through after all), phase A follows it to
 * its receipt. nextNonce, when given, replaces the relayer's next nonce (closing a gap).
 */
export const clearStall = internalMutation({
  args: {
    ...leaseArgs,
    clearTx: v.optional(v.object({ nonce: v.number(), hash: v.string(), rawTx: v.string(), sentAt: v.number(), sentBlock: v.number() })),
    nextNonce: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await fence(ctx, args);
    const stalled = state.stalled;
    if (!stalled) return null;
    if (stalled.writeId && args.clearTx) {
      const write = await ctx.db.get("chainWrites", stalled.writeId);
      if (write?.status === "submitted" && write.nonce === stalled.nonce) {
        await requeue(ctx, write, `Nonce ${stalled.nonce} was cleared; sending again with a new nonce.`, false);
      }
    }
    await ctx.db.patch("relayerState", state._id, {
      stalled: undefined,
      clearTx: args.clearTx ?? state.clearTx,
      nextNonce: args.nextNonce ?? Math.max(state.nextNonce ?? 0, stalled.nonce + 1),
    });
    return null;
  },
});

// ------------------------------------------------------------------ reads

export const tickWork = internalQuery({
  args: { key: v.string() },
  returns: v.object({
    state: v.union(v.null(), relayerStateDocValidator),
    enabled: v.boolean(),
    submitted: v.array(writeDocValidator),
    pending: v.array(writeDocValidator),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const submitted = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "submitted"))
      .take(100);
    const pending = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending"))
      .take(100);
    return {
      state: await relayerStateByKey(ctx, args.key),
      enabled: await chainWritesEnabled(ctx),
      submitted: submitted.sort((a, b) => (a.nonce ?? 0) - (b.nonce ?? 0)),
      pending: pending.filter((write) => (write.nextAttemptAt ?? 0) <= now).slice(0, SEND_BATCH),
    };
  },
});

/** How soon the lease holder should tick again, or null when there's nothing to follow. */
export const nextTickDelay = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args) => {
    const state = await relayerStateByKey(ctx, args.key);
    const submitted = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "submitted"))
      .first();
    if (state?.stalled) return TICK_WHILE_STALLED_MS;
    if (submitted || state?.clearTx) return TICK_AGAIN_MS;
    if (!(await chainWritesEnabled(ctx))) return null;
    const pending = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending"))
      .take(100);
    if (pending.length === 0) return null;
    const soonest = Math.min(...pending.map((write) => write.nextAttemptAt ?? 0));
    return Math.max(TICK_AGAIN_MS, soonest - Date.now());
  },
});

export const memberWallet = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      custody: v.union(v.literal("circle"), v.literal("managed"), v.literal("local")),
      address: v.string(),
      circleWalletId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.walletStatus !== "ready" || !user.walletAddress || !user.walletCustody) return null;
    return { custody: user.walletCustody, address: user.walletAddress, circleWalletId: user.circleWalletId };
  },
});

async function promoteWaitingWrites(ctx: MutationCtx) {
  let promoted = 0;
  for (const status of ["waiting_wallet", "waiting_parent"] as const) {
    const rows = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      .take(50);
    for (const write of rows) if (await promoteWrite(ctx, write)) promoted += 1;
  }
  return promoted;
}

/** Phase B: writes whose wallet or parent gate opened since they were last looked at. */
export const promoteWaiting = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await promoteWaitingWrites(ctx),
});

/**
 * Safety net, every minute (convex/crons.ts): sends requested lineage corrections, promotes writes
 * whose gate opened, then starts a tick when something is in flight, or queued while chain.writes
 * is on.
 */
export const kick = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    await sendRequestedCorrections(ctx);
    await promoteWaitingWrites(ctx);
    const inFlight =
      (await ctx.db.query("chainWrites").withIndex("by_status_and_createdAt", (q) => q.eq("status", "submitted")).first()) !== null ||
      (await ctx.db.query("relayerState").take(10)).some((state) => state.clearTx !== undefined || state.stalled !== undefined);
    const queued =
      (await ctx.db.query("chainWrites").withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending")).first()) !== null &&
      (await chainWritesEnabled(ctx));
    if (!inFlight && !queued) return false;
    await ctx.scheduler.runAfter(0, internal.chain.tick, {});
    return true;
  },
});

// ------------------------------------------------------------------ tick

const summaryValidator = v.object({
  outcome: v.union(v.literal("ran"), v.literal("busy"), v.literal("blocked"), v.literal("lease_lost"), v.literal("error")),
  detail: v.optional(v.string()),
  confirmed: v.number(),
  settled: v.number(),
  requeued: v.number(),
  sent: v.number(),
  replaced: v.number(),
  rebroadcast: v.number(),
  waiting: v.number(),
  held: v.number(),
  deferred: v.number(),
  stalled: v.boolean(),
});

type Summary = {
  outcome: "ran" | "busy" | "blocked" | "lease_lost" | "error";
  detail?: string;
  confirmed: number;
  settled: number;
  requeued: number;
  sent: number;
  replaced: number;
  rebroadcast: number;
  waiting: number;
  held: number;
  deferred: number;
  stalled: boolean;
};

function newSummary(outcome: Summary["outcome"], detail?: string): Summary {
  return { outcome, detail, confirmed: 0, settled: 0, requeued: 0, sent: 0, replaced: 0, rebroadcast: 0, waiting: 0, held: 0, deferred: 0, stalled: false };
}

type Heads = { latest: ChainBlock; finalized: ChainBlock; latestCount: number; finalizedCount: number };

async function readHeads(relayer: Relayer): Promise<Heads> {
  const [latest, finalized, latestCount, finalizedCount] = await Promise.all([
    relayer.rpc.getBlock("latest"),
    relayer.rpc.getBlock("finalized"),
    relayer.rpc.getTransactionCount(relayer.account.address, "latest"),
    relayer.rpc.getTransactionCount(relayer.account.address, "finalized"),
  ]);
  return { latest, finalized, latestCount, finalizedCount };
}

type Step = {
  ctx: ActionCtx;
  relayer: Relayer;
  lease: Lease;
  summary: Summary;
  // What this tick already told opsAlerts about the relayer's MON.
  fundsReported?: FundsLevel;
};

async function outcome(step: Step, write: WriteDoc, result: typeof outcomeValidator.type): Promise<void> {
  await step.ctx.runMutation(internal.chain.applyOutcome, { ...step.lease, writeId: write._id, outcome: result });
  if (result.type === "confirm") step.summary.confirmed += 1;
  else if (result.type === "settle") step.summary.settled += 1;
  else if (result.type === "requeue") step.summary.requeued += 1;
  else step.summary.deferred += 1;
}

function writeRegistry(step: Step, write: WriteDoc) {
  return (write.registryAddress ?? step.relayer.registry) as Address;
}

/**
 * A revert decoded at the finalized tag (or replayed at a finalized receipt's block), handled per
 * "Chain write outcomes": duplicates reconcile from finalized state, an expired signature is
 * re-signed, rule refusals are rejected, the rest fail.
 */
async function handleRevert(
  step: Step,
  write: WriteDoc,
  payload: WritePayload,
  reason: RegistryErrorName | null,
  tx: { txHash?: string; blockNumber?: number },
): Promise<void> {
  const revertReason = reason ?? undefined;
  switch (revertHandling(write.kind, reason)) {
    case "reconcile": {
      const found = await reconcileFromState(step.relayer.rpc, writeRegistry(step, write), step.relayer.account.address, payload);
      if (found.state === "match") return await outcome(step, write, { type: "confirm", result: found.result });
      return await outcome(step, write, {
        type: "settle",
        status: "failed",
        error: found.state === "different" ? found.detail : `Reverted with ${reason}, but nothing matching is onchain.`,
        revertReason,
        ...tx,
      });
    }
    case "resign":
      return await outcome(step, write, { type: "requeue", reason: "The signature expired before inclusion; signing again.", clearSignature: true, revertReason });
    case "rejected":
      return await outcome(step, write, { type: "settle", status: "rejected", error: `The registry refused it (${reason}).`, revertReason, ...tx });
    case "failed":
      return await outcome(step, write, { type: "settle", status: "failed", error: `Reverted (${reason ?? "no reason given"}).`, revertReason, ...tx });
  }
}

async function settleReceipt(step: Step, write: WriteDoc, payload: WritePayload, receipt: ChainReceipt): Promise<void> {
  const registry = writeRegistry(step, write);
  const tx = { txHash: receipt.transactionHash, blockNumber: Number(receipt.blockNumber) };
  if (receipt.status === "success") {
    const event = eventOutcome(payload, receipt.logs, registry);
    if (event) return await outcome(step, write, { type: "confirm", ...tx, result: event.result });
    const found = await reconcileFromState(step.relayer.rpc, registry, step.relayer.account.address, payload);
    if (found.state === "match") return await outcome(step, write, { type: "confirm", ...tx, result: found.result });
    return await outcome(step, write, { type: "settle", status: "failed", error: "The transaction succeeded without the expected event.", ...tx });
  }
  // A finalized revert consumed the nonce. Replay the call at its block to read the reason.
  const data = writeCalldata(payload, write.signature as Hex | undefined, write.signatureDeadline !== undefined ? BigInt(write.signatureDeadline) : undefined);
  const replay = await step.relayer.rpc.call({ from: step.relayer.account.address, to: registry, data }, receipt.blockNumber);
  await handleRevert(step, write, payload, replay.ok ? null : decodeRegistryRevert(replay.revertData), tx);
}

/** Phase A for one write: its receipts, its nonce, and rebroadcast, replacement, or stall. */
async function followSubmitted(step: Step, heads: Heads, write: WriteDoc): Promise<void> {
  const { rpc } = step.relayer;
  const payload = parsePayload(write.kind, write.payload!);
  let provisional = false;
  for (const tx of [...write.txs].reverse()) {
    const receipt = await rpc.getTransactionReceipt(tx.hash as Hex);
    if (!receipt) continue;
    // Not final yet: stays submitted until the block is finalized and still canonical.
    if (receipt.blockNumber > heads.finalized.number) {
      provisional = true;
      continue;
    }
    const block = await rpc.getBlock(receipt.blockNumber);
    if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) continue;
    return await settleReceipt(step, write, payload, receipt);
  }
  if (provisional) {
    step.summary.waiting += 1;
    return;
  }
  const nonce = write.nonce!;
  if (nonce < heads.finalizedCount) {
    // The nonce is final but none of this write's transactions are: something else used it.
    const found = await reconcileFromState(rpc, writeRegistry(step, write), step.relayer.account.address, payload);
    if (found.state === "match") return await outcome(step, write, { type: "confirm", result: found.result });
    if (found.state === "missing") {
      return await outcome(step, write, { type: "requeue", reason: `Nonce ${nonce} was used by another transaction; sending again.`, clearSignature: false });
    }
    return await outcome(step, write, { type: "settle", status: "failed", error: found.detail });
  }
  if (nonce < heads.latestCount) {
    // Used at the latest block; wait for finality to say by what.
    step.summary.waiting += 1;
    return;
  }
  const last = write.txs[write.txs.length - 1];
  const age = Number(heads.latest.number) - last.sentBlock;
  if (nonce > heads.latestCount || age < INCLUSION_BLOCKS) {
    await broadcast(step.ctx, step.relayer, step.lease, write._id, last.rawTx);
    step.summary.rebroadcast += 1;
    return;
  }
  if (write.replacements < MAX_REPLACEMENTS) {
    const fees = bumpedFees(
      { maxFeePerGas: BigInt(last.maxFeePerGas), maxPriorityFeePerGas: BigInt(last.maxPriorityFeePerGas) },
      await rpc.estimateFees(),
    );
    const data = writeCalldata(payload, write.signature as Hex | undefined, write.signatureDeadline !== undefined ? BigInt(write.signatureDeadline) : undefined);
    const tx = await signTx(step.relayer, { nonce, to: writeRegistry(step, write), data, gas: BigInt(last.gas), ...fees }, heads.latest.number);
    const recorded = await step.ctx.runMutation(internal.chain.recordTx, {
      ...step.lease,
      writeId: write._id,
      nonce,
      tx,
      replacement: true,
      chainId: write.chainId ?? step.relayer.chainId,
      registryAddress: writeRegistry(step, write),
    });
    if (recorded) {
      await broadcast(step.ctx, step.relayer, step.lease, write._id, tx.rawTx);
      step.summary.replaced += 1;
    }
    return;
  }
  // Out of replacements: stall (holding later writes) but keep offering the last one.
  await broadcast(step.ctx, step.relayer, step.lease, write._id, last.rawTx);
  await step.ctx.runMutation(internal.chain.setStalled, {
    ...step.lease,
    nonce,
    writeId: write._id,
    reason: `Nonce ${nonce} was not included after ${MAX_REPLACEMENTS} fee increases.`,
  });
  step.summary.stalled = true;
}

async function signMember(step: Step, write: WriteDoc, payload: WritePayload): Promise<{ signature: Hex; deadline: number; signer: string }> {
  const wallet = await step.ctx.runQuery(internal.chain.memberWallet, { userId: write.userId! });
  if (!wallet) throw new Error("The member's wallet is not ready.");
  const deadline = signatureDeadline(Date.now());
  const domain = registryDomain(step.relayer.chainId, step.relayer.registry);
  let typedData;
  if (payload.kind === "registerWork") typedData = registerWorkTypedData(domain, { ...payload.record, deadline });
  else if (payload.kind === "back") typedData = backTypedData(domain, { ...payload.record, deadline });
  else throw new Error(`A ${payload.kind} write has no member signature.`);
  const signature = await signForMember(step.relayer.deployment, process.env, { userId: write.userId!, wallet: { ...wallet, address: wallet.address as Address } }, typedData, chainDeps().fetch);
  return { signature, deadline: Number(deadline), signer: wallet.address };
}

type FundsLevel = "ok" | "low" | "out";

// The relayer is running low when its MON covers fewer than this many more writes at the gas price
// it just paid: about 0.4 MON at mainnet's prices on October 12 (a registration costs about 0.021),
// a day or two of judging. Low tells the owner and ops once, and running out tells them again.
const LOW_FUNDS_WRITES = 20n;

// Tells the owner and ops when the relayer is running low on MON or runs out, once per drop
// (convex/opsAlerts.ts). Once per tick is enough.
async function reportFunds(step: Step, level: FundsLevel, left?: { balance: bigint; perWrite: bigint }) {
  if (step.fundsReported === level) return;
  step.fundsReported = level;
  await step.ctx.runMutation(internal.opsAlerts.recordRelayerFunds, {
    level,
    network: step.relayer.deployment.network.name,
    address: step.relayer.account.address,
    ...(left && left.perWrite > 0n
      ? { balanceWei: left.balance.toString(), writesLeft: Number(left.balance / left.perWrite) }
      : {}),
  });
}

/** Phase C: sign and send pending writes, oldest first. */
async function sendPending(step: Step, heads: Heads): Promise<void> {
  const { ctx, relayer } = step;
  const work: TickWork = await ctx.runQuery(internal.chain.tickWork, { key: relayer.key });
  const state = work.state;
  if (!work.enabled || !state) return;
  // While a nonce is stalled, or its clearing transaction isn't in yet, writes are signed but held.
  const held = Boolean(state.stalled) || (state.clearTx !== undefined && heads.latestCount <= state.clearTx.nonce);
  let nextNonce = Math.max(state.nextNonce ?? 0, heads.latestCount);
  let balance: bigint | null = null;
  // The dearest write sent this tick, to say how many more the balance covers.
  let perWrite = 0n;
  const pending = [...work.pending];
  while (pending.length > 0) {
    const write = pending.shift()!;
    try {
      const sent = await sendOne(step, heads, write, { held, nonce: nextNonce, balance });
      if (sent === "no_funds") {
        for (const waiting of pending) await outcome(step, waiting, { type: "defer", error: "The relayer needs MON." });
        step.summary.detail = "The relayer needs MON.";
        await reportFunds(step, "out");
        return;
      }
      if (sent) {
        nextNonce = sent.nonce + 1;
        balance = sent.balance;
        if (sent.cost > perWrite) perWrite = sent.cost;
      }
    } catch (error) {
      // One write's failure (an RPC hiccup, a bad payload) doesn't hold up the rest.
      if (isLeaseLost(error)) throw error;
      await outcome(step, write, { type: "defer", error: errorText(error) });
    }
  }
  if (balance !== null && perWrite > 0n) {
    await reportFunds(step, balance < perWrite * LOW_FUNDS_WRITES ? "low" : "ok", { balance, perWrite });
  }
}

/**
 * Phase C for one write: bind it, sign it for its member if needed, check it at the finalized
 * tag, and record then broadcast it. Returns the nonce and remaining balance when sent.
 */
async function sendOne(
  step: Step,
  heads: Heads,
  write: WriteDoc,
  at: { held: boolean; nonce: number; balance: bigint | null },
): Promise<{ nonce: number; balance: bigint; cost: bigint } | "no_funds" | null> {
  const { ctx, relayer } = step;
  if (write.chainId !== undefined && (write.chainId !== relayer.chainId || !sameAddress(write.registryAddress, relayer.registry))) {
    await outcome(step, write, { type: "settle", status: "failed", error: "The registry changed since this write was queued." });
    return null;
  }
  const payload = parsePayload(write.kind, write.payload!);
  let signature = write.signature as Hex | undefined;
  let deadline = write.signatureDeadline;
  if (needsMemberSignature(write.kind) && (!signature || deadline === undefined || deadline * 1000 - Date.now() < RESIGN_MARGIN_MS)) {
    let signed;
    try {
      signed = await signMember(step, write, payload);
    } catch (error) {
      await outcome(step, write, { type: "defer", error: `Signing failed: ${errorText(error)}` });
      return null;
    }
    const recorded = await ctx.runMutation(internal.chain.recordSignature, {
      ...step.lease,
      writeId: write._id,
      signature: signed.signature,
      signatureDeadline: signed.deadline,
      signer: signed.signer,
      chainId: relayer.chainId,
      registryAddress: relayer.registry,
    });
    if (!recorded) return null;
    signature = signed.signature;
    deadline = signed.deadline;
  }
  if (at.held) {
    step.summary.held += 1;
    return null;
  }
  const data = writeCalldata(payload, signature, deadline !== undefined ? BigInt(deadline) : undefined);
  const request = { from: relayer.account.address, to: relayer.registry, data };
  const estimate = await relayer.rpc.estimateGas(request);
  if (!estimate.ok) {
    // Act on a revert only when finalized state gives the same reason (INV-30); otherwise it may
    // hinge on a transaction that isn't final yet.
    const reason = decodeRegistryRevert(estimate.revertData);
    const atFinalized = await relayer.rpc.call(request, "finalized");
    if (!atFinalized.ok && decodeRegistryRevert(atFinalized.revertData) === reason) {
      await handleRevert(step, write, payload, reason, {});
    } else {
      await outcome(step, write, { type: "defer", error: `Not sendable yet (${reason ?? estimate.message}).` });
    }
    return null;
  }
  const fees = await relayer.rpc.estimateFees();
  const gas = gasLimitFor(estimate.gas);
  const balance = at.balance ?? (await relayer.rpc.getBalance(relayer.account.address));
  const cost = gas * fees.maxFeePerGas;
  if (balance < cost) {
    await outcome(step, write, { type: "defer", error: "The relayer needs MON." });
    return "no_funds";
  }
  const nonce = at.nonce;
  const tx = await signTx(relayer, { nonce, to: relayer.registry, data, gas, ...fees }, heads.latest.number);
  const recorded = await ctx.runMutation(internal.chain.recordTx, {
    ...step.lease,
    writeId: write._id,
    nonce,
    tx,
    replacement: false,
    chainId: relayer.chainId,
    registryAddress: relayer.registry,
  });
  if (!recorded) return null;
  step.summary.sent += 1;
  await broadcast(ctx, relayer, step.lease, write._id, tx.rawTx);
  return { nonce, balance: balance - cost, cost };
}

async function runTick(step: Step): Promise<void> {
  const { ctx, relayer, lease } = step;
  const work: TickWork = await ctx.runQuery(internal.chain.tickWork, { key: relayer.key });
  const state = work.state!;
  const heads = await readHeads(relayer);

  // The clearing self-transfer: forget it once final, rebroadcast it until it is included.
  if (state.clearTx) {
    if (heads.finalizedCount > state.clearTx.nonce) await ctx.runMutation(internal.chain.dropClearTx, lease);
    else if (heads.latestCount <= state.clearTx.nonce) await broadcast(ctx, relayer, lease, null, state.clearTx.rawTx);
  }

  // A stalled nonce that went through after all (a late replacement, or another sender).
  if (state.stalled && heads.finalizedCount > state.stalled.nonce) await ctx.runMutation(internal.chain.clearStall, lease);

  // A. Submitted writes, lowest nonce first.
  for (const write of work.submitted) await followSubmitted(step, heads, write);

  // A nonce we handed out that nothing holds blocks every later one: stall so an admin can clear it.
  const nextNonce = state.nextNonce ?? 0;
  const holdsNext = work.submitted.some((write) => write.nonce === heads.latestCount) || state.clearTx?.nonce === heads.latestCount;
  if (!state.stalled && !step.summary.stalled && nextNonce > heads.latestCount && !holdsNext) {
    await ctx.runMutation(internal.chain.setStalled, {
      ...lease,
      nonce: heads.latestCount,
      reason: `Nonce ${heads.latestCount} has no transaction, so later ones can't land.`,
    });
    step.summary.stalled = true;
  }

  // B. Gates that opened.
  await ctx.runMutation(internal.chain.promoteWaiting, {});

  // C. New sends.
  await sendPending(step, heads);
}

export const tick = internalAction({
  args: {},
  returns: summaryValidator,
  handler: async (ctx): Promise<Summary> => {
    const connected = await connectRelayer();
    if (!connected.ok) return newSummary("blocked", connected.reason);
    const relayer = connected.relayer;
    const lease: { generation: number } | null = await ctx.runMutation(internal.chain.acquireLease, {
      key: relayer.key,
      owner: `tick:${crypto.randomUUID()}`,
      chainId: relayer.chainId,
      relayerAddress: relayer.account.address,
    });
    if (!lease) return newSummary("busy");
    const fenced = { key: relayer.key, generation: lease.generation };
    const step: Step = { ctx, relayer, lease: fenced, summary: newSummary("ran") };
    try {
      await runTick(step);
    } catch (error) {
      if (isLeaseLost(error)) return { ...step.summary, outcome: "lease_lost" as const };
      step.summary.outcome = "error";
      step.summary.detail = errorText(error);
    }
    await ctx.runMutation(internal.chain.releaseLease, {
      ...fenced,
      lastError: step.summary.outcome === "error" || step.summary.detail ? step.summary.detail : undefined,
    });
    const delay: number | null = await ctx.runQuery(internal.chain.nextTickDelay, { key: relayer.key });
    if (delay !== null) {
      // Back off while the RPC or a dependency keeps failing.
      await ctx.scheduler.runAfter(step.summary.outcome === "error" ? Math.max(delay, ERROR_RETRY_MS) : delay, internal.chain.tick, {});
    }
    return step.summary;
  },
});

// ------------------------------------------------------------------ admin: clear stuck nonce

export const assertChainManager = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requirePlatformCapability(ctx, "chain:manage");
    return null;
  },
});

export const stallInfo = internalQuery({
  args: { key: v.string() },
  returns: v.object({
    state: v.union(v.null(), relayerStateDocValidator),
    stuck: v.union(v.null(), writeDocValidator),
    highestSubmittedNonce: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, args) => {
    const state = await relayerStateByKey(ctx, args.key);
    const stuck = state?.stalled?.writeId ? await ctx.db.get("chainWrites", state.stalled.writeId) : null;
    const submitted = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "submitted"))
      .take(100);
    const nonces = submitted.flatMap((write) => (write.nonce === undefined ? [] : [write.nonce]));
    return { state, stuck, highestSubmittedNonce: nonces.length > 0 ? Math.max(...nonces) : null };
  },
});

function maxBig(...values: Array<bigint>) {
  return values.reduce((a, b) => (a > b ? a : b));
}

/**
 * "Clear stuck nonce": sends a zero-value self-transfer at the stalled nonce with high fees, puts
 * the stuck write back for a fresh nonce, and releases the held writes once the transfer is in.
 */
export const clearStuckNonce = action({
  args: {},
  returns: v.object({ message: v.string() }),
  handler: async (ctx): Promise<{ message: string }> => {
    await ctx.runQuery(internal.chain.assertChainManager, {});
    const connected = await connectRelayer();
    if (!connected.ok) throw new ConvexError({ code: "BLOCKED", message: connected.reason });
    const relayer = connected.relayer;
    const lease: { generation: number } | null = await ctx.runMutation(internal.chain.acquireLease, {
      key: relayer.key,
      owner: `admin:${crypto.randomUUID()}`,
      chainId: relayer.chainId,
      relayerAddress: relayer.account.address,
    });
    if (!lease) throw new ConvexError({ code: "BUSY", message: "The relayer is busy. Try again in a minute." });
    const fenced = { key: relayer.key, generation: lease.generation };
    try {
      const { state, stuck, highestSubmittedNonce }: StallInfo = await ctx.runQuery(internal.chain.stallInfo, { key: relayer.key });
      const stalled = state?.stalled;
      if (!stalled) return { message: "Nothing is stuck." };
      const latestCount = await relayer.rpc.getTransactionCount(relayer.account.address, "latest");
      if (latestCount > stalled.nonce) {
        await ctx.runMutation(internal.chain.clearStall, fenced);
        return { message: `Nonce ${stalled.nonce} went through on its own. Writes are moving again.` };
      }
      const estimate = await relayer.rpc.estimateFees();
      const last = stuck?.nonce === stalled.nonce ? stuck.txs[stuck.txs.length - 1] : undefined;
      const maxPriorityFeePerGas = maxBig(estimate.maxPriorityFeePerGas * 3n, last ? BigInt(last.maxPriorityFeePerGas) * 2n : 0n);
      const maxFeePerGas = maxBig(estimate.maxFeePerGas * 3n, last ? BigInt(last.maxFeePerGas) * 2n : 0n, maxPriorityFeePerGas);
      const latest = await relayer.rpc.getBlock("latest");
      const tx = await signTx(
        relayer,
        { nonce: stalled.nonce, to: relayer.account.address, data: "0x", gas: 21_000n, maxFeePerGas, maxPriorityFeePerGas },
        latest.number,
      );
      await ctx.runMutation(internal.chain.clearStall, {
        ...fenced,
        clearTx: { nonce: stalled.nonce, hash: tx.hash, rawTx: tx.rawTx, sentAt: tx.sentAt, sentBlock: tx.sentBlock },
        // A gap: nonces past it that no write holds are handed out again.
        nextNonce: stalled.writeId ? undefined : Math.max(stalled.nonce, highestSubmittedNonce ?? -1) + 1,
      });
      const sent = await broadcast(ctx, relayer, fenced, null, tx.rawTx);
      return {
        message: sent
          ? `Sent a replacement for nonce ${stalled.nonce}. Held writes go out once it lands.`
          : `Signed a replacement for nonce ${stalled.nonce}; the node refused it for now, and the relayer will keep sending it.`,
      };
    } finally {
      await ctx.runMutation(internal.chain.releaseLease, fenced).catch(() => null);
      await ctx.scheduler.runAfter(0, internal.chain.tick, {});
    }
  },
});

// ------------------------------------------------------------------ admin: relayer status

export const assertChainViewer = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return null;
  },
});

const relayerStatusValidator = v.object({
  env: v.union(v.null(), v.string()),
  networkName: v.union(v.null(), v.string()),
  chainId: v.union(v.null(), v.number()),
  registryAddress: v.union(v.null(), v.string()),
  relayerAddress: v.union(v.null(), v.string()),
  // Wei, as a decimal string.
  balance: v.union(v.null(), v.string()),
  listed: v.union(v.null(), v.boolean()),
  registryAdmin: v.union(v.null(), v.string()),
  // Explorer links, when there's a public explorer for this chain.
  relayerUrl: v.union(v.null(), v.string()),
  registryUrl: v.union(v.null(), v.string()),
  problem: v.union(v.null(), v.string()),
});
type RelayerStatus = typeof relayerStatusValidator.type;

/**
 * For /admin/chain: the relayer's address and balance and whether the registry lists it. Each
 * check that fails is reported as the problem rather than thrown, so the page still shows what
 * it could read. The key itself never leaves this module.
 */
export const relayerStatus = action({
  args: {},
  returns: relayerStatusValidator,
  handler: async (ctx): Promise<RelayerStatus> => {
    await ctx.runQuery(internal.chain.assertChainViewer, {});
    const status: RelayerStatus = {
      env: null,
      networkName: null,
      chainId: null,
      registryAddress: null,
      relayerAddress: null,
      balance: null,
      listed: null,
      registryAdmin: null,
      relayerUrl: null,
      registryUrl: null,
      problem: null,
    };
    try {
      const deployment = assertDeploymentConsistency(process.env);
      status.env = deployment.env;
      status.networkName = deployment.network.name;
      status.registryAddress = deployment.registryAddress;
      status.relayerAddress = deployment.relayerAddress;
      const account = relayerAccount();
      status.relayerAddress = account.address;
      assertRelayerAddress(deployment, account.address);
      const rpc = chainDeps().rpc(deployment.rpcUrl);
      status.chainId = await rpc.getChainId();
      assertRpcChainId(deployment, status.chainId);
      const explorer = explorerNetwork(process.env, status.chainId);
      status.relayerUrl = explorer ? explorerAddressUrl(explorer, account.address) : null;
      status.registryUrl = explorer && deployment.registryAddress ? explorerAddressUrl(explorer, deployment.registryAddress) : null;
      status.balance = (await rpc.getBalance(account.address)).toString();
      if (!deployment.registryAddress) {
        status.problem = `No registry is deployed for ${deployment.env} yet.`;
        return status;
      }
      try {
        status.listed = (await readRegistry(rpc, deployment.registryAddress, account.address, "isRelayer", [account.address], "latest")) === true;
        status.registryAdmin = String(await readRegistry(rpc, deployment.registryAddress, account.address, "admin", [], "latest"));
      } catch {
        status.problem = "The registry address did not answer as a CultRemix registry.";
        return status;
      }
      if (!status.listed) status.problem = "The registry does not list this relayer.";
      else if (status.balance === "0") status.problem = "The relayer needs MON.";
    } catch (error) {
      status.problem = errorText(error);
    }
    return status;
  },
});
