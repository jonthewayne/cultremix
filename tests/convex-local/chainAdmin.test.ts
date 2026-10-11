import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { configHashFor } from "../../convex/lib/chain/ids";
import { CHAIN_WRITES_FLAG, enqueueRegisterWork } from "../../convex/lib/chain/queue";
import { canonicalConfigJson } from "../../convex/lib/economics";
import { RELAYER, insertMember, insertOwner, insertWork, setChainWrites, useChainEnv, type Member } from "./chainFixtures";
import { FakeChain } from "./fakeChain";
import { newTest } from "./setup";

type T = ReturnType<typeof newTest>;

function setup() {
  useChainEnv();
  const t = newTest();
  const chain = new FakeChain({ relayer: RELAYER });
  setChainDepsForTests({ rpc: () => chain });
  return { t, chain };
}

const asCtx = (ctx: unknown) => ctx as MutationCtx;
const asMember = (t: T, member: Member) => t.withIdentity({ subject: member.authId, issuer: "test" });
const getWork = (t: T, workId: Id<"works">) => t.run(async (ctx) => (await ctx.db.get("works", workId))!);
const getWrite = (t: T, writeId: Id<"chainWrites">) => t.run(async (ctx) => (await ctx.db.get("chainWrites", writeId))!);
const sha256Hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

async function settle(t: T, chain: FakeChain, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await t.action(internal.chain.tick, {});
    await chain.mine(chain.finalityLag + 1);
  }
  await t.action(internal.chain.tick, {});
}

/** A work still preparing, as publish.ts leaves it before markPublished. */
async function preparingWork(t: T, creator: Member, options: { kind?: "original" | "variation"; parentWorkId?: Id<"works"> } = {}) {
  return await insertWork(t, creator.userId, { ...options, fields: { status: "preparing" } });
}

const publish = (t: T, workId: Id<"works">, contentHash = sha256Hex()) =>
  t.mutation(internal.publish.markPublished, { workId, artKey: `works/${workId}.png`, contentHash });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  setChainDepsForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("publishing queues the onchain registration", () => {
  it("queues the creator's registration when the work is published", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await preparingWork(t, creator);
    expect(await publish(t, workId)).not.toBeNull();
    const work = await getWork(t, workId);
    expect(work.provenanceStatus).toBe("pending");
    expect((await getWrite(t, work.chainWriteId!)).status).toBe("pending");
    await settle(t, chain);
    expect((await getWork(t, workId)).provenanceStatus).toBe("confirmed");
  });

  it("waits for the creator's wallet, and a remix waits for its parent", async () => {
    const { t } = setup();
    const creator = await insertMember(t, { walletReady: false });
    const parentId = await insertWork(t, creator.userId);
    const remixId = await preparingWork(t, creator, { kind: "variation", parentWorkId: parentId });
    await publish(t, remixId);
    const remix = await getWork(t, remixId);
    const parent = await getWork(t, parentId);
    // The parent, published before chain writes, was queued along with its remix.
    expect((await getWrite(t, parent.chainWriteId!)).status).toBe("waiting_wallet");
    const remixWrite = await getWrite(t, remix.chainWriteId!);
    expect(remixWrite.status).toBe("waiting_wallet");
    expect(remixWrite.dependsOnWriteId).toBe(parent.chainWriteId);
  });

  it("publishes without a registration when the content hash isn't SHA-256 hex", async () => {
    const { t } = setup();
    const creator = await insertMember(t);
    const workId = await preparingWork(t, creator);
    expect(await publish(t, workId, "not-a-hash")).not.toBeNull();
    const work = await getWork(t, workId);
    expect(work.status).toBe("published");
    expect(work.chainWriteId).toBeUndefined();
    expect(work.provenanceStatus).toBeUndefined();
  });
});

describe("provenance on the work page", () => {
  it("shows waiting, then registered, with a transaction link only for a public explorer", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    expect(await t.query(api.provenance.forWork, { workId })).toBeNull();

    await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
    expect(await t.query(api.provenance.forWork, { workId })).toMatchObject({ status: "pending", networkName: "Monad Testnet", txHash: null, txUrl: null, registryLive: true });
    // Before the registry is deployed, a queued record says it waits for it.
    vi.stubEnv("CHAIN_REGISTRY_ADDRESS", "");
    expect(await t.query(api.provenance.forWork, { workId })).toMatchObject({ status: "pending", registryLive: false });
    useChainEnv();

    await settle(t, chain);
    const confirmed = await t.query(api.provenance.forWork, { workId });
    expect(confirmed).toMatchObject({ status: "confirmed", networkName: "Monad Testnet", txUrl: null });
    expect(confirmed!.txHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(confirmed!.confirmedAt).toBe(Date.now());

    // The same deployment on the public testnet RPC links to Monadscan.
    vi.stubEnv("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz");
    expect((await t.query(api.provenance.forWork, { workId }))!.txUrl).toBe(`https://testnet.monadscan.com/tx/${confirmed!.txHash}`);
  });

  it("shows nothing for a work that isn't published", async () => {
    const { t } = setup();
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId, { fields: { status: "withdrawn" } });
    await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
    expect(await t.query(api.provenance.forWork, { workId })).toBeNull();
  });
});

describe("/admin/chain", () => {
  it("lets super admins look and only chain managers act", async () => {
    const { t } = setup();
    const member = await insertMember(t);
    const owner = await insertOwner(t);
    await expect(t.query(api.chainAdmin.overview, {})).rejects.toThrow("Not signed in");
    await expect(asMember(t, member).query(api.chainAdmin.overview, {})).rejects.toThrow("Insufficient permissions");
    await expect(asMember(t, member).action(api.chain.relayerStatus, {})).rejects.toThrow("Insufficient permissions");
    for (const call of [
      () => asMember(t, member).mutation(api.chainAdmin.setWritesEnabled, { enabled: true }),
      () => asMember(t, member).mutation(api.chainAdmin.registerEconomicConfig, {}),
      () => asMember(t, member).mutation(api.chainAdmin.queueEarlierWorks, {}),
    ]) {
      await expect(call()).rejects.toThrow("Insufficient permissions");
    }
    const support = await t.run((ctx) => ctx.db.insert("users", { email: "support@example.com", authId: "auth-support", platformRole: "super_admin_support" }));
    expect(support).toBeTruthy();
    const asSupport = t.withIdentity({ subject: "auth-support", issuer: "test" });
    expect((await asSupport.query(api.chainAdmin.overview, {})).enabled).toBe(false);
    await expect(asSupport.mutation(api.chainAdmin.setWritesEnabled, { enabled: true })).rejects.toThrow("Insufficient permissions");

    await owner.mutation(api.chainAdmin.setWritesEnabled, { enabled: true });
    expect((await owner.query(api.chainAdmin.overview, {})).enabled).toBe(true);
    await owner.mutation(api.chainAdmin.setWritesEnabled, { enabled: false });
    const flag = await t.run((ctx) =>
      ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", CHAIN_WRITES_FLAG))
        .unique(),
    );
    expect(flag?.enabled).toBe(false);
  });

  it("reports the relayer's address, balance, and registry", async () => {
    const { t, chain } = setup();
    const owner = await insertOwner(t);
    expect(await owner.action(api.chain.relayerStatus, {})).toMatchObject({
      env: "dev",
      networkName: "Monad Testnet",
      chainId: 10143,
      relayerAddress: RELAYER,
      balance: (10n ** 21n).toString(),
      listed: true,
      problem: null,
      relayerUrl: null,
    });
    expect((await owner.action(api.chain.relayerStatus, {})).registryAdmin?.toLowerCase()).toBe(RELAYER.toLowerCase());
    chain.setBalance(RELAYER, 0n);
    expect((await owner.action(api.chain.relayerStatus, {})).problem).toBe("The relayer needs MON.");
    vi.stubEnv("MONAD_RELAYER_PRIVATE_KEY", "");
    expect(await owner.action(api.chain.relayerStatus, {})).toMatchObject({ balance: null, problem: "MONAD_RELAYER_PRIVATE_KEY is not set." });
  });

  it("registers economic config v1 as the SHA-256 of its canonical JSON", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const hash = configHashFor(canonicalConfigJson());
    expect((await owner.query(api.chainAdmin.overview, {})).config).toEqual({ version: 1, hash, status: null });
    expect(await owner.mutation(api.chainAdmin.registerEconomicConfig, {})).toEqual({ version: 1, configHash: hash });
    await owner.mutation(api.chainAdmin.registerEconomicConfig, {});
    await settle(t, chain);
    expect(chain.state.configHash.get("1")).toBe(hash);
    const overview = await owner.query(api.chainAdmin.overview, {});
    expect(overview.config.status).toBe("confirmed");
    expect(overview.recent).toHaveLength(1);
    expect(overview.recent[0]).toMatchObject({ kind: "registerEconomicConfig", status: "confirmed", subject: "Economic config v1", nonce: 0, txUrl: null });
    expect(overview.counts.find((row) => row.status === "confirmed")?.count).toBe(1);
    expect(overview.relayers).toHaveLength(1);
    expect(overview.relayers[0]).toMatchObject({ relayerAddress: RELAYER, nextNonce: 1, stalled: null });
  });

  it("retries a failed registration from scratch", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const creator = await insertMember(t);
    const workId = await insertWork(t, creator.userId);
    const writeId = (await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId)))!;
    await expect(owner.mutation(api.chainAdmin.retryWrite, { writeId })).rejects.toMatchObject({ data: { code: "NOT_FAILED" } });
    await t.run(async (ctx) => {
      await ctx.db.patch("chainWrites", writeId, { status: "failed", error: "The registry changed since this write was queued.", chainId: 10143, registryAddress: "0x0000000000000000000000000000000000000001" });
      await ctx.db.patch("works", workId, { provenanceStatus: "failed" });
    });
    expect((await owner.query(api.chainAdmin.overview, {})).recent[0]).toMatchObject({ subject: expect.stringMatching(/^CR \d+-001$/u), problem: "The registry changed since this write was queued." });

    await owner.mutation(api.chainAdmin.retryWrite, { writeId });
    const retried = await getWrite(t, writeId);
    expect(retried).toMatchObject({ status: "pending", attempts: 0, txs: [] });
    expect(retried.registryAddress).toBeUndefined();
    expect(retried.error).toBeUndefined();
    expect((await getWork(t, workId)).provenanceStatus).toBe("pending");
    await settle(t, chain);
    expect((await getWrite(t, writeId)).status).toBe("confirmed");
    expect((await getWork(t, workId)).provenanceStatus).toBe("confirmed");
  });

  it("queues registrations for works published before chain writes", async () => {
    const { t, chain } = setup();
    await setChainWrites(t, true);
    const owner = await insertOwner(t);
    const creator = await insertMember(t);
    const original = await insertWork(t, creator.userId);
    await insertWork(t, creator.userId, { kind: "variation", parentWorkId: original });
    await insertWork(t, creator.userId);
    expect((await owner.query(api.chainAdmin.overview, {})).unqueuedWorks).toEqual({ count: 3, capped: false });
    expect(await owner.mutation(api.chainAdmin.queueEarlierWorks, {})).toEqual({ queued: 3, more: false });
    expect((await owner.query(api.chainAdmin.overview, {})).unqueuedWorks.count).toBe(0);
    await settle(t, chain);
    const counts = (await owner.query(api.chainAdmin.overview, {})).counts;
    expect(counts.find((row) => row.status === "confirmed")?.count).toBe(3);
  });
});
