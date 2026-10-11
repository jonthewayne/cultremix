import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { configHashFor, reasonHashFor, workIdFor, ZERO_BYTES32 } from "../../convex/lib/chain/ids";
import { enqueueAmendment, enqueueBack, enqueueConfig, enqueueRegisterWork } from "../../convex/lib/chain/queue";
import { registryWeek } from "../../convex/lib/chain/writes";
import {
  RELAYER,
  RELAYER_KEY,
  RELAYER_LEASE_KEY,
  insertMember,
  insertOwner,
  insertWork,
  makeWalletReady,
  setChainWrites,
  useChainEnv,
  type Member,
} from "./chainFixtures";
import { FAKE_REGISTRY, FakeChain, type FakeChainOptions } from "./fakeChain";
import { newTest } from "./setup";

type T = ReturnType<typeof newTest>;
const GWEI = 1_000_000_000n;

function setup(options: Partial<FakeChainOptions> = {}) {
  useChainEnv();
  const t = newTest();
  const chain = new FakeChain({ relayer: RELAYER, ...options });
  setChainDepsForTests({ rpc: () => chain });
  return { t, chain };
}

const tick = (t: T) => t.action(internal.chain.tick, {});

// convex-test's run context is a full mutation context; the queue helpers take the generated type.
const asCtx = (ctx: unknown) => ctx as MutationCtx;

async function enqueueWork(t: T, workId: Id<"works">) {
  return (await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId)))!;
}

const getWrite = (t: T, writeId: Id<"chainWrites">) => t.run(async (ctx) => (await ctx.db.get("chainWrites", writeId))!);
const getWork = (t: T, workId: Id<"works">) => t.run(async (ctx) => (await ctx.db.get("works", workId))!);
const relayerState = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("relayerState")
      .withIndex("by_key", (q) => q.eq("key", RELAYER_LEASE_KEY))
      .unique(),
  );

/** Ticks and finalizes until nothing is pending or submitted. */
async function settleAll(t: T, chain: FakeChain, rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await tick(t);
    await chain.mine(chain.finalityLag + 1);
  }
  await tick(t);
}

/** A published original by `member`, registered and confirmed onchain. */
async function confirmedWork(t: T, chain: FakeChain, member: Member) {
  const workId = await insertWork(t, member.userId);
  const writeId = await enqueueWork(t, workId);
  await settleAll(t, chain, 1);
  expect((await getWrite(t, writeId)).status).toBe("confirmed");
  return workId;
}

async function insertBack(t: T, workId: Id<"works">, backer: Member) {
  return await t.run(async (ctx) => {
    const backId = await ctx.db.insert("backs", {
      workId,
      backerId: backer.userId,
      status: "reserved",
      week: registryWeek(Date.now()),
      createdAt: Date.now(),
    });
    const work = (await ctx.db.get("works", workId))!;
    const user = (await ctx.db.get("users", backer.userId))!;
    const writeId = await enqueueBack(asCtx(ctx), { backId, work, backer: user });
    return { backId, writeId };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  setChainDepsForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("chain writes: registering works", () => {
  it("persists the signed transaction, waits for finality, then confirms the work's provenance", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    const writeId = await enqueueWork(t, workId);
    expect((await getWrite(t, writeId)).status).toBe("pending");
    expect((await getWork(t, workId)).provenanceStatus).toBe("pending");

    expect(await tick(t)).toMatchObject({ outcome: "ran", sent: 1 });
    const submitted = await getWrite(t, writeId);
    expect(submitted).toMatchObject({ status: "submitted", nonce: 0, chainId: 10143, registryAddress: FAKE_REGISTRY, signer: creator.address });
    expect(submitted.txs).toHaveLength(1);
    expect(submitted.txs[0].rawTx).toMatch(/^0x02/u);
    expect(chain.sent).toEqual([submitted.txs[0].hash]);
    expect(await getWork(t, workId)).toMatchObject({ provenanceStatus: "submitted", chainTxHash: submitted.txs[0].hash });

    // Included but not final: still submitted.
    await chain.mine(1);
    expect(await tick(t)).toMatchObject({ waiting: 1, confirmed: 0 });
    expect((await getWrite(t, writeId)).status).toBe("submitted");

    await chain.mine(2);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });
    expect(await getWrite(t, writeId)).toMatchObject({ status: "confirmed", txHash: submitted.txs[0].hash, blockNumber: 1 });
    expect(await getWork(t, workId)).toMatchObject({ provenanceStatus: "confirmed", chainTxHash: submitted.txs[0].hash });
    const onchain = chain.work(workIdFor(workId))!;
    expect(onchain.creator.toLowerCase()).toBe(creator.address.toLowerCase());
    expect(onchain.kind).toBe(0);
    expect(onchain.parentId).toBe(ZERO_BYTES32);
    const state = await relayerState(t);
    expect(state).toMatchObject({ nextNonce: 1 });
    expect(state?.leaseOwner).toBeUndefined();
  });

  it("rebroadcasts the persisted raw transaction when the first broadcast never arrived", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));

    chain.failSends = 1;
    expect(await tick(t)).toMatchObject({ sent: 1 });
    const recorded = await getWrite(t, writeId);
    expect(recorded).toMatchObject({ status: "submitted", nonce: 0, lastBroadcastError: "fetch failed" });
    expect(chain.mempoolTxs).toHaveLength(0);

    // The next tick (or a new lease holder) resumes from the stored raw transaction: same hash.
    expect(await tick(t)).toMatchObject({ rebroadcast: 1, sent: 0 });
    expect(chain.mempoolTxs.map((tx) => tx.hash)).toEqual([recorded.txs[0].hash]);
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });
    expect((await getWrite(t, writeId)).txHash).toBe(recorded.txs[0].hash);
  });

  it("holds a remix until its parent confirms, then sends it in the same tick", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const original = await insertMember(t);
    const remixer = await insertMember(t);
    const parentId = await insertWork(t, original.userId);
    const childId = await insertWork(t, remixer.userId, { kind: "variation", parentWorkId: parentId });

    // Queuing the remix queues its unregistered parent first.
    const childWriteId = await enqueueWork(t, childId);
    const parentWriteId = (await getWork(t, parentId)).chainWriteId!;
    expect((await getWrite(t, parentWriteId)).status).toBe("pending");
    expect(await getWrite(t, childWriteId)).toMatchObject({ status: "waiting_parent", dependsOnWriteId: parentWriteId });

    expect(await tick(t)).toMatchObject({ sent: 1 });
    expect((await getWrite(t, childWriteId)).status).toBe("waiting_parent");
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1, sent: 1 });
    expect((await getWrite(t, childWriteId)).status).toBe("submitted");
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });

    const child = chain.work(workIdFor(childId))!;
    expect(child.parentId).toBe(workIdFor(parentId));
    expect(child.kind).toBe(1);
    expect(child.expression).toBe(2);
    expect((await getWork(t, childId)).provenanceStatus).toBe("confirmed");
  });

  it("waits for a member's wallet before signing", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t, { walletReady: false });
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));
    expect((await getWrite(t, writeId)).status).toBe("waiting_wallet");
    expect(await tick(t)).toMatchObject({ sent: 0 });

    await makeWalletReady(t, creator);
    await settleAll(t, chain, 2);
    expect((await getWrite(t, writeId)).status).toBe("confirmed");
  });

  it("ignores a receipt from a block that was reorged away", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));
    await tick(t);
    await chain.mine(1);
    const orphaned = (await chain.getTransactionReceipt((await getWrite(t, writeId)).txHash as Hex))!;

    // The block holding it is replaced by empty ones, and a lagging node still serves the old receipt.
    chain.reorg(1, { dropTxs: true });
    chain.staleReceipts = true;
    await chain.mine(3);
    expect(await chain.getTransactionReceipt(orphaned.transactionHash)).toEqual(orphaned);

    expect(await tick(t)).toMatchObject({ confirmed: 0, rebroadcast: 1 });
    expect((await getWrite(t, writeId)).status).toBe("submitted");
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });
    const confirmed = await getWrite(t, writeId);
    expect(confirmed.blockNumber).toBe(4);
    expect(confirmed.txHash).toBe(orphaned.transactionHash);
  });

  it("re-signs a registration whose signature expired before inclusion", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    const writeId = await enqueueWork(t, workId);
    chain.minPriorityFee = 50n * GWEI;
    await tick(t);
    const first = await getWrite(t, writeId);

    // Included only after the 10-minute signature window: a finalized revert that used nonce 0.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    chain.minPriorityFee = 0n;
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ requeued: 1, sent: 1 });
    const resent = await getWrite(t, writeId);
    expect(resent).toMatchObject({ status: "submitted", nonce: 1, revertReason: "SignatureExpired" });
    expect(resent.signatureDeadline).toBeGreaterThan(first.signatureDeadline!);
    expect(resent.signature).not.toBe(first.signature);

    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });
    expect((await getWork(t, workId)).provenanceStatus).toBe("confirmed");
  });

  it("confirms a registration already onchain from contract state", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    const writeId = await enqueueWork(t, workId);
    await tick(t);
    // The record of the send is lost (say, a restore), but the transaction lands.
    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { status: "pending", nonce: undefined, txs: [], txHash: undefined }));
    await chain.mine(3);

    expect(await tick(t)).toMatchObject({ confirmed: 1, sent: 0 });
    const write = await getWrite(t, writeId);
    expect(write.status).toBe("confirmed");
    expect(write.txHash).toBeUndefined();
    expect((await getWork(t, workId)).provenanceStatus).toBe("confirmed");
  });

  it("sends again with a fresh nonce when another transaction used its nonce", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));
    await tick(t);

    // Something else signed by the relayer takes nonce 0 first.
    chain.dropMempool();
    const relayer = privateKeyToAccount(RELAYER_KEY);
    await chain.sendRawTransaction(
      await relayer.signTransaction({
        type: "eip1559",
        chainId: 10143,
        nonce: 0,
        to: relayer.address,
        value: 0n,
        gas: 21_000n,
        maxFeePerGas: 100n * GWEI,
        maxPriorityFeePerGas: 2n * GWEI,
      }),
    );
    await chain.mine(3);

    expect(await tick(t)).toMatchObject({ requeued: 1, sent: 1 });
    expect(await getWrite(t, writeId)).toMatchObject({ status: "submitted", nonce: 1 });
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1 });
  });
});

describe("chain writes: fees and stalls", () => {
  it("raises fees 20% three times, stalls, holds later writes, and clears the stuck nonce", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const stuckId = await enqueueWork(t, await insertWork(t, creator.userId));
    chain.minPriorityFee = 5n * GWEI;
    await tick(t);

    const tips: Array<bigint> = [];
    for (let round = 1; round <= 3; round += 1) {
      await chain.mine(29);
      expect(await tick(t)).toMatchObject({ rebroadcast: 1, replaced: 0 });
      await chain.mine(1);
      expect(await tick(t)).toMatchObject({ replaced: 1 });
      const write = await getWrite(t, stuckId);
      expect(write.replacements).toBe(round);
      tips.push(BigInt(write.txs[write.txs.length - 1].maxPriorityFeePerGas));
    }
    expect(tips).toEqual([2_400_000_000n, 2_880_000_000n, 3_456_000_000n]);

    await chain.mine(30);
    expect(await tick(t)).toMatchObject({ stalled: true, replaced: 0 });
    expect((await relayerState(t))?.stalled).toMatchObject({ nonce: 0, writeId: stuckId });

    // A later write is signed but held behind the stall.
    const heldId = await enqueueWork(t, await insertWork(t, creator.userId));
    expect(await tick(t)).toMatchObject({ held: 1, sent: 0 });
    const held = await getWrite(t, heldId);
    expect(held.status).toBe("pending");
    expect(held.signature).toBeDefined();

    // Members can't clear it; the owner can.
    const member = t.withIdentity({ subject: creator.authId, issuer: "test" });
    await expect(member.action(api.chain.clearStuckNonce, {})).rejects.toThrow(/Insufficient permissions/u);
    const owner = await insertOwner(t);
    expect(await owner.action(api.chain.clearStuckNonce, {})).toEqual({
      message: "Sent a replacement for nonce 0. Held writes go out once it lands.",
    });
    const cleared = await relayerState(t);
    expect(cleared?.stalled).toBeUndefined();
    expect(cleared?.clearTx?.nonce).toBe(0);
    expect((await getWrite(t, stuckId)).status).toBe("pending");

    // The self-transfer takes nonce 0; the stuck write and the held one go out after it.
    await chain.mine(1);
    expect((await chain.getTransactionReceipt(cleared!.clearTx!.hash as Hex))?.status).toBe("success");
    chain.minPriorityFee = 0n;
    expect(await tick(t)).toMatchObject({ sent: 2, held: 0 });
    expect((await getWrite(t, stuckId)).nonce).toBe(1);
    expect((await getWrite(t, heldId)).nonce).toBe(2);
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 2 });
    expect((await relayerState(t))?.clearTx).toBeUndefined();
    expect(await owner.action(api.chain.clearStuckNonce, {})).toEqual({ message: "Nothing is stuck." });
  });

  it("defers every write while the relayer can't pay for gas", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const first = await enqueueWork(t, await insertWork(t, creator.userId));
    const second = await enqueueWork(t, await insertWork(t, creator.userId));
    chain.setBalance(RELAYER, 0n);

    expect(await tick(t)).toMatchObject({ sent: 0, deferred: 2, detail: "The relayer needs MON." });
    expect(await getWrite(t, first)).toMatchObject({ status: "pending", error: "The relayer needs MON.", attempts: 1 });
    expect((await relayerState(t))?.lastError).toBe("The relayer needs MON.");
    // The owner and ops hear once that it's out, not on every tick.
    const outAlerts = async () =>
      t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((row) => row.kind === "ops_alert" && row.note?.includes("out of MON")).length);
    const told = await outAlerts();
    expect(await t.run(async (ctx) => (await ctx.db.query("opsAlerts").collect()).map((row) => [row.key, row.level]))).toEqual([["relayer-mon", "out"]]);
    vi.setSystemTime(Date.now() + 6_000);
    await tick(t);
    expect(await outAlerts()).toBe(told);

    chain.setBalance(RELAYER, 10n ** 20n);
    expect(await tick(t)).toMatchObject({ sent: 0 });
    vi.setSystemTime(Date.now() + 60_000);
    expect(await tick(t)).toMatchObject({ sent: 2 });
    // Sending again resets it, so running out later is told again.
    expect(await t.run(async (ctx) => (await ctx.db.query("opsAlerts").collect()).map((row) => row.level))).toEqual(["ok"]);
    await chain.mine(3);
    await tick(t);
    expect((await getWrite(t, second)).status).toBe("confirmed");
  });
});

describe("chain writes: Backs", () => {
  it("rejects a fourth Back in a registry week and releases its slot", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const backer = await insertMember(t);
    const works: Array<Id<"works">> = [];
    for (let i = 0; i < 4; i += 1) works.push(await confirmedWork(t, chain, creator));

    const backs: Array<{ backId: Id<"backs">; writeId: Id<"chainWrites"> }> = [];
    for (const workId of works) backs.push(await insertBack(t, workId, backer));
    expect(await tick(t)).toMatchObject({ sent: 4 });
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 3, settled: 1 });

    const rows = await t.run(async (ctx) => await Promise.all(backs.map(({ backId }) => ctx.db.get("backs", backId))));
    expect(rows.slice(0, 3).map((row) => [row?.status, row?.ordinal, row?.week])).toEqual([
      ["confirmed", 1, 0],
      ["confirmed", 1, 0],
      ["confirmed", 1, 0],
    ]);
    expect(rows[3]).toMatchObject({ status: "rejected", error: "You've used your 3 Backs for this registry week." });
    expect(await getWrite(t, backs[3].writeId)).toMatchObject({ status: "rejected", revertReason: "WeeklyBackLimit" });
  });

  it("reconciles a duplicate Back from contract state, keeping its ordinal", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const first = await insertMember(t);
    const second = await insertMember(t);
    const workId = await confirmedWork(t, chain, creator);

    await insertBack(t, workId, first);
    const { backId, writeId } = await insertBack(t, workId, second);
    await tick(t);
    // The second Back lands, but its record of the send is lost.
    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { status: "pending", nonce: undefined, txs: [], txHash: undefined }));
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 2 });
    expect(await t.run((ctx) => ctx.db.get("backs", backId))).toMatchObject({ status: "confirmed", ordinal: 2, week: 0 });
  });

  it("rejects a Back of your own work", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await confirmedWork(t, chain, creator);
    const { backId } = await insertBack(t, workId, creator);
    expect(await tick(t)).toMatchObject({ settled: 1, sent: 0 });
    expect(await t.run((ctx) => ctx.db.get("backs", backId))).toMatchObject({ status: "rejected", error: "You can't Back your own work." });
  });
});

describe("chain writes: admin kinds", () => {
  it("registers an economic config hash and amends a lineage as the registry admin", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const hash = configHashFor('{"version":1}');
    const configWriteId = await t.run((ctx) => enqueueConfig(asCtx(ctx), 1, hash));
    const creator = await insertMember(t);
    const parentId = await confirmedWork(t, chain, creator);
    const childId = await confirmedWork(t, chain, creator);
    expect((await getWrite(t, configWriteId)).status).toBe("confirmed");
    expect(chain.state.configHash.get("1")).toBe(hash);

    const amendId = await t.run(async (ctx) =>
      enqueueAmendment(asCtx(ctx), {
        work: (await ctx.db.get("works", childId))!,
        newParent: (await ctx.db.get("works", parentId))!,
        newKind: "fork",
        reasonHash: reasonHashFor("It was remixed from the harbor piece."),
        sequence: 1,
      }),
    );
    await settleAll(t, chain, 1);
    expect((await getWrite(t, amendId)).status).toBe("confirmed");
    expect(chain.work(workIdFor(childId))).toMatchObject({ kind: 2, parentId: workIdFor(parentId) });
    expect(chain.state.amendmentCount.get(workIdFor(childId).toLowerCase())).toBe(1n);
  });

  it("fails an admin write when the relayer isn't the registry admin", async () => {
    const { t, chain } = setup({ admin: "0x000000000000000000000000000000000000dEaD" });
    await setChainWrites(t, true);
    const writeId = await t.run((ctx) => enqueueConfig(asCtx(ctx), 1, configHashFor("{}")));
    expect(await tick(t)).toMatchObject({ settled: 1, sent: 0 });
    expect(await getWrite(t, writeId)).toMatchObject({ status: "failed", revertReason: "NotAdmin" });
    expect(chain.sent).toHaveLength(0);
  });
});

describe("chain writes: leases and fail-closed checks", () => {
  it("lets one tick hold the relayer lease and fences out a holder that lost it", async () => {
    const { t } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));
    const lease = await t.mutation(internal.chain.acquireLease, { key: RELAYER_LEASE_KEY, owner: "elsewhere", chainId: 10143, relayerAddress: RELAYER });
    expect(lease).toEqual({ generation: 1 });

    expect(await tick(t)).toMatchObject({ outcome: "busy", sent: 0 });
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1_000);
    expect(await tick(t)).toMatchObject({ outcome: "ran", sent: 1 });
    const write = await getWrite(t, writeId);

    await expect(
      t.mutation(internal.chain.recordTx, {
        key: RELAYER_LEASE_KEY,
        generation: 1,
        writeId,
        nonce: 5,
        tx: write.txs[0],
        replacement: false,
        chainId: 10143,
        registryAddress: FAKE_REGISTRY,
      }),
    ).rejects.toMatchObject({ data: { code: "LEASE_LOST" } });
    expect((await getWrite(t, writeId)).nonce).toBe(0);
  });

  it("refuses an RPC on the wrong chain", async () => {
    const { t, chain } = setup({ chainId: 143 });
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const writeId = await enqueueWork(t, await insertWork(t, creator.userId));
    const summary = await tick(t);
    expect(summary.outcome).toBe("blocked");
    expect(summary.detail).toMatch(/reports chain 143/u);
    expect((await getWrite(t, writeId)).status).toBe("pending");
    expect(chain.sent).toHaveLength(0);
  });

  it("refuses a registry that doesn't list the relayer", async () => {
    const { t } = setup({ relayers: ["0x000000000000000000000000000000000000bEEF"] });
    await setChainWrites(t, true);
    expect(await tick(t)).toMatchObject({ outcome: "blocked", detail: "The registry does not list this relayer." });
  });

  it("refuses to run without a relayer key", async () => {
    const { t } = setup();
    vi.stubEnv("MONAD_RELAYER_PRIVATE_KEY", "");
    expect(await tick(t)).toMatchObject({ outcome: "blocked", detail: "MONAD_RELAYER_PRIVATE_KEY is not set." });
  });

  it("fails a write bound to a different registry", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    const writeId = await enqueueWork(t, workId);
    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { chainId: 10143, registryAddress: "0x00000000000000000000000000000000000c0FFE" }));
    expect(await tick(t)).toMatchObject({ settled: 1, sent: 0 });
    expect(await getWrite(t, writeId)).toMatchObject({ status: "failed", error: "The registry changed since this write was queued." });
    expect((await getWork(t, workId)).provenanceStatus).toBe("failed");
    expect(chain.sent).toHaveLength(0);
  });

  it("sends nothing new while chain.writes is off but still follows writes in flight", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const inFlight = await enqueueWork(t, await insertWork(t, creator.userId));
    await tick(t);

    await setChainWrites(t, false);
    const queued = await enqueueWork(t, await insertWork(t, creator.userId));
    await chain.mine(3);
    expect(await tick(t)).toMatchObject({ confirmed: 1, sent: 0 });
    expect((await getWrite(t, inFlight)).status).toBe("confirmed");
    const waiting = await getWrite(t, queued);
    expect(waiting.status).toBe("pending");
    expect(waiting.signature).toBeUndefined();
    expect(await t.mutation(internal.chain.kick, {})).toBe(false);
  });
});
