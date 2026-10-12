import { ConvexError, v } from "convex/values";
import { assertDeploymentConsistency, explorerNetwork, explorerTxUrl } from "../shared/config/chains";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { configHashFor } from "./lib/chain/ids";
import { CHAIN_WRITES_FLAG, chainWritesEnabled, enqueueConfig, enqueueRegisterWork, resetWrite, writeBySubject } from "./lib/chain/queue";
import { ECONOMIC_CONFIG_V1, canonicalConfigJson } from "./lib/economics";
import { requirePlatformCapability, requireSuperAdmin } from "./lib/permissions";
import { formatCr } from "./lib/r2";
import { chainWriteKindValidator, chainWriteStatusValidator } from "./schema/chain";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// /admin/chain: the relayer's queue and controls. Super admins can look; changing anything takes
// the chain:manage capability. The relayer's address and balance come from chain.relayerStatus,
// and "Clear stuck nonce" is chain.clearStuckNonce.

const RECENT_WRITES = 50;
const COUNT_CAP = 500;
const BACKFILL_BATCH = 100;

const STATUSES = ["waiting_wallet", "waiting_parent", "pending", "submitted", "confirmed", "rejected", "failed"] as const;

function economicConfigV1() {
  const json = canonicalConfigJson(ECONOMIC_CONFIG_V1);
  return { version: ECONOMIC_CONFIG_V1.version, json, hash: configHashFor(json) };
}

function deploymentSummary() {
  try {
    const deployment = assertDeploymentConsistency(process.env);
    return { env: deployment.env, networkName: deployment.network.name, registryAddress: deployment.registryAddress, problem: null };
  } catch (error) {
    return { env: process.env.DEPLOYMENT_ENV ?? null, networkName: null, registryAddress: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

const writeRowValidator = v.object({
  _id: v.id("chainWrites"),
  kind: chainWriteKindValidator,
  status: chainWriteStatusValidator,
  subject: v.string(),
  nonce: v.union(v.null(), v.number()),
  replacements: v.number(),
  txHash: v.union(v.null(), v.string()),
  txUrl: v.union(v.null(), v.string()),
  problem: v.union(v.null(), v.string()),
  result: v.union(v.null(), v.object({ ordinal: v.number(), week: v.number() })),
  // Whether retryWrite takes it when it fails (not Backs or lineage corrections; see retryWrite).
  retryable: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const overview = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    deployment: v.object({
      env: v.union(v.null(), v.string()),
      networkName: v.union(v.null(), v.string()),
      registryAddress: v.union(v.null(), v.string()),
      problem: v.union(v.null(), v.string()),
    }),
    relayers: v.array(
      v.object({
        key: v.string(),
        chainId: v.number(),
        relayerAddress: v.string(),
        nextNonce: v.union(v.null(), v.number()),
        stalled: v.union(v.null(), v.object({ nonce: v.number(), since: v.number(), reason: v.string(), subject: v.union(v.null(), v.string()) })),
        clearing: v.union(v.null(), v.object({ nonce: v.number(), hash: v.string(), sentAt: v.number() })),
        lastTickAt: v.union(v.null(), v.number()),
        lastError: v.union(v.null(), v.string()),
      }),
    ),
    counts: v.array(v.object({ status: chainWriteStatusValidator, count: v.number(), capped: v.boolean() })),
    recent: v.array(writeRowValidator),
    config: v.object({ version: v.number(), hash: v.string(), status: v.union(v.null(), chainWriteStatusValidator) }),
    unqueuedWorks: v.object({ count: v.number(), capped: v.boolean() }),
  }),
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const subjectLabel = async (write: Doc<"chainWrites">) => {
      const work = write.workId ? await ctx.db.get("works", write.workId) : null;
      const cr = work ? `CR ${formatCr(work.crFamily, work.crExpression)}` : null;
      if (write.kind === "registerWork") return cr ?? write.subjectKey;
      if (write.kind === "back") return cr ? `Back of ${cr}` : write.subjectKey;
      if (write.kind === "amendLineage") return cr ? `Lineage of ${cr} (#${write.subjectKey.split(":")[2]})` : write.subjectKey;
      return `Economic config v${write.subjectKey.split(":")[1]}`;
    };

    const states = await ctx.db.query("relayerState").take(10);
    const relayers = [];
    for (const state of states) {
      const stuck = state.stalled?.writeId ? await ctx.db.get("chainWrites", state.stalled.writeId) : null;
      relayers.push({
        key: state.key,
        chainId: state.chainId,
        relayerAddress: state.relayerAddress,
        nextNonce: state.nextNonce ?? null,
        stalled: state.stalled
          ? { nonce: state.stalled.nonce, since: state.stalled.since, reason: state.stalled.reason, subject: stuck ? await subjectLabel(stuck) : null }
          : null,
        clearing: state.clearTx ? { nonce: state.clearTx.nonce, hash: state.clearTx.hash, sentAt: state.clearTx.sentAt } : null,
        lastTickAt: state.lastTickAt ?? null,
        lastError: state.lastError ?? null,
      });
    }

    const counts = [];
    for (const status of STATUSES) {
      const rows = await ctx.db
        .query("chainWrites")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
        .take(COUNT_CAP);
      counts.push({ status, count: rows.length, capped: rows.length === COUNT_CAP });
    }

    const recent = [];
    for (const write of await ctx.db.query("chainWrites").order("desc").take(RECENT_WRITES)) {
      const txHash = write.txHash ?? write.txs[write.txs.length - 1]?.hash ?? null;
      const explorer = write.chainId === undefined ? null : explorerNetwork(process.env, write.chainId);
      recent.push({
        _id: write._id,
        kind: write.kind,
        status: write.status,
        subject: await subjectLabel(write),
        nonce: write.nonce ?? null,
        replacements: write.replacements,
        txHash,
        txUrl: explorer && txHash ? explorerTxUrl(explorer, txHash) : null,
        problem: write.revertReason ?? write.error ?? write.lastBroadcastError ?? null,
        result: write.result ?? null,
        retryable: retryable(write),
        createdAt: write.createdAt,
        updatedAt: write.updatedAt,
      });
    }

    const config = economicConfigV1();
    const configWrite = await writeBySubject(ctx, `config:${config.version}`);

    const published = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .filter((q) => q.eq(q.field("chainWriteId"), undefined))
      .take(COUNT_CAP);

    return {
      enabled: await chainWritesEnabled(ctx),
      deployment: deploymentSummary(),
      relayers,
      counts,
      recent,
      config: { version: config.version, hash: config.hash, status: configWrite?.status ?? null },
      unqueuedWorks: { count: published.length, capped: published.length === COUNT_CAP },
    };
  },
});

async function kickTick(ctx: MutationCtx) {
  await ctx.scheduler.runAfter(0, internal.chain.tick, {});
}

/** Turns the chain.writes flag on or off. Off: nothing new is sent; sent writes are still followed. */
export const setWritesEnabled = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformCapability(ctx, "chain:manage");
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", CHAIN_WRITES_FLAG))
      .unique();
    if (flag) await ctx.db.patch("featureFlags", flag._id, { enabled: args.enabled });
    else await ctx.db.insert("featureFlags", { key: CHAIN_WRITES_FLAG, enabled: args.enabled });
    if (args.enabled) await kickTick(ctx);
    return null;
  },
});

/**
 * Queues economic config v1 for the registry: the SHA-256 of canonicalConfigJson, the same bytes
 * /economics/v1.json serves. Idempotent.
 */
export const registerEconomicConfig = mutation({
  args: {},
  returns: v.object({ version: v.number(), configHash: v.string() }),
  handler: async (ctx) => {
    await requirePlatformCapability(ctx, "chain:manage");
    const config = economicConfigV1();
    await enqueueConfig(ctx, config.version, config.hash);
    return { version: config.version, configHash: config.hash };
  },
});

/** A failed Back or lineage correction goes again from where it started, not from here. */
function retryable(write: Doc<"chainWrites">) {
  return write.kind !== "back" && !(write.kind === "amendLineage" && write.amendmentId);
}

/**
 * Puts a failed write back in the queue from its first gate, for a fresh signature and nonce.
 * A failed Back isn't retried here: the member Backs again, which checks their weekly limit. Nor
 * is a lineage correction: its failure rejected the correction (convex/lineage.ts), so an admin
 * requests it again there and the new request reuses this write.
 */
export const retryWrite = mutation({
  args: { writeId: v.id("chainWrites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformCapability(ctx, "chain:manage");
    const write = await ctx.db.get("chainWrites", args.writeId);
    if (!write) throw new ConvexError({ code: "NOT_FOUND", message: "That write doesn't exist." });
    if (write.status !== "failed") throw new ConvexError({ code: "NOT_FAILED", message: "Only a failed write can be retried." });
    if (write.kind === "back") throw new ConvexError({ code: "BACK", message: "A failed Back goes again when the member Backs again." });
    if (!retryable(write)) {
      throw new ConvexError({ code: "CORRECTION", message: "A failed lineage correction goes again when it's requested again on the lineage page." });
    }
    await resetWrite(ctx, write);
    return null;
  },
});

/** Queues registrations for published works that have none yet (published before chain writes). */
export const queueEarlierWorks = mutation({
  args: {},
  returns: v.object({ queued: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    await requirePlatformCapability(ctx, "chain:manage");
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .filter((q) => q.eq(q.field("chainWriteId"), undefined))
      .take(BACKFILL_BATCH + 1);
    let queued = 0;
    for (const work of works.slice(0, BACKFILL_BATCH)) {
      if (await enqueueRegisterWork(ctx, work._id)) queued += 1;
    }
    return { queued, more: works.length > BACKFILL_BATCH };
  },
});
