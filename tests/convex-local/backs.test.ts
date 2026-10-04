import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { workIdFor } from "../../convex/lib/chain/ids";
import { enqueueRegisterWork } from "../../convex/lib/chain/queue";
import { RELAYER, insertMember, insertWork, makeWalletReady, setChainWrites, setFlag, useChainEnv, type Member } from "./chainFixtures";
import { FakeChain } from "./fakeChain";
import { newTest } from "./setup";

type T = ReturnType<typeof newTest>;

// Backing needs the Backs switch as well as Monad records; each test turns Monad records on itself.
async function setup() {
  useChainEnv();
  const t = newTest();
  const chain = new FakeChain({ relayer: RELAYER });
  setChainDepsForTests({ rpc: () => chain });
  await setFlag(t, "social.backs", true);
  return { t, chain };
}

const asCtx = (ctx: unknown) => ctx as MutationCtx;
const as = (t: T, member: Member) => t.withIdentity({ subject: member.authId, issuer: "test" });
const backOf = (t: T, member: Member, workId: Id<"works">) => as(t, member).mutation(api.backs.back, { workId });
const view = (t: T, member: Member | null, workId: Id<"works">) =>
  member ? as(t, member).query(api.backs.forWork, { workId }) : t.query(api.backs.forWork, { workId });

async function settle(t: T, chain: FakeChain, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await t.action(internal.chain.tick, {});
    await chain.mine(chain.finalityLag + 1);
  }
  await t.action(internal.chain.tick, {});
}

/** A published work, registered and confirmed onchain. */
async function registeredWork(t: T, chain: FakeChain, creator: Member) {
  const workId = await insertWork(t, creator.userId);
  await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
  await settle(t, chain, 1);
  return workId;
}

async function refusalCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code ?? String(error);
  }
  return "admitted";
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

describe("Backs", () => {
  it("records each backer's place in line from the chain's Backed event", async () => {
    const { t, chain } = await setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const [alice, bob] = [await insertMember(t), await insertMember(t)];
    const workId = await registeredWork(t, chain, creator);

    expect(await view(t, alice, workId)).toMatchObject({ count: 0, earliest: [], viewer: null, canBack: true, weeklyUsed: 0, weeklyLimit: 3 });
    const { backId } = await backOf(t, alice, workId);
    await backOf(t, bob, workId);
    expect(await view(t, alice, workId)).toMatchObject({ viewer: { status: "reserved", ordinal: null }, canBack: false, reason: { code: "ALREADY_BACKED" }, weeklyUsed: 1 });

    await settle(t, chain);
    const back = await t.run(async (ctx) => (await ctx.db.get("backs", backId))!);
    expect(back).toMatchObject({ status: "confirmed", ordinal: 1, week: 0 });
    expect(chain.state.backOrdinal.size).toBe(2);

    const aliceView = (await view(t, alice, workId))!;
    expect(aliceView.count).toBe(2);
    expect(aliceView.viewer).toEqual({ status: "confirmed", ordinal: 1, error: null });
    expect(aliceView.earliest.map(({ ordinal, isViewer }) => ({ ordinal, isViewer }))).toEqual([
      { ordinal: 1, isViewer: true },
      { ordinal: 2, isViewer: false },
    ]);
    const signedOut = (await view(t, null, workId))!;
    expect(signedOut).toMatchObject({ count: 2, viewer: null, canBack: false, reason: { code: "SIGNED_OUT" }, weeklyUsed: null });
    expect(signedOut.earliest.every((backer) => !backer.isViewer && backer.username?.startsWith("m"))).toBe(true);
  });

  it("admits only signed-in, verified members with a ready wallet, for a registered work that isn't theirs", async () => {
    const { t, chain } = await setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const workId = await registeredWork(t, chain, creator);

    await expect(t.mutation(api.backs.back, { workId })).rejects.toMatchObject({ data: { code: "SIGNED_OUT", message: "Sign in to Back this work." } });
    const noUsername = await insertMember(t, { fields: { username: undefined } });
    expect(await refusalCode(backOf(t, noUsername, workId))).toBe("NEEDS_USERNAME");
    const unverified = await insertMember(t, { fields: { emailVerified: false } });
    expect(await refusalCode(backOf(t, unverified, workId))).toBe("EMAIL_UNVERIFIED");
    await expect(backOf(t, creator, workId)).rejects.toMatchObject({ data: { code: "OWN_WORK", message: "You can't Back your own work." } });

    const walletless = await insertMember(t, { walletReady: false });
    expect(await refusalCode(backOf(t, walletless, workId))).toBe("WALLET_NOT_READY");
    await makeWalletReady(t, walletless);

    const unregistered = await insertWork(t, creator.userId);
    expect(await refusalCode(backOf(t, walletless, unregistered))).toBe("NOT_REGISTERED");
    const withdrawn = await insertWork(t, creator.userId, { fields: { status: "withdrawn", provenanceStatus: "confirmed" } });
    expect(await refusalCode(backOf(t, walletless, withdrawn))).toBe("NOT_PUBLISHED");

    await setChainWrites(t, false);
    await expect(backOf(t, walletless, workId)).rejects.toMatchObject({ data: { code: "PAUSED", message: "Backing is paused right now." } });
    expect(await view(t, walletless, workId)).toMatchObject({ canBack: false, reason: { code: "PAUSED" } });
    await setChainWrites(t, true);
    expect(await refusalCode(backOf(t, walletless, workId))).toBe("admitted");
    expect(await refusalCode(backOf(t, walletless, workId))).toBe("ALREADY_BACKED");
    const backs = await t.run((ctx) => ctx.db.query("backs").collect());
    expect(backs).toHaveLength(1);
  });

  it("stays closed until both the Backs and Monad records switches are on", async () => {
    const { t, chain } = await setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const alice = await insertMember(t);
    const workId = await registeredWork(t, chain, creator);
    expect(await view(t, alice, workId)).toMatchObject({ open: true, canBack: true });

    await setFlag(t, "social.backs", false);
    await expect(backOf(t, alice, workId)).rejects.toMatchObject({ data: { code: "PAUSED" } });
    expect(await view(t, alice, workId)).toMatchObject({ open: false, canBack: false, reason: { code: "PAUSED" } });
    expect(await view(t, null, workId)).toMatchObject({ open: false, count: 0, viewer: null });

    await setFlag(t, "social.backs", true);
    await setChainWrites(t, false);
    expect(await view(t, alice, workId)).toMatchObject({ open: false, canBack: false });

    await setChainWrites(t, true);
    expect(await refusalCode(backOf(t, alice, workId))).toBe("admitted");
    expect(await t.run((ctx) => ctx.db.query("backs").collect())).toHaveLength(1);
  });

  it("allows 3 Backs per registry week, counting ones still being recorded", async () => {
    const { t, chain } = await setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const backer = await insertMember(t);
    const works = [];
    for (let i = 0; i < 5; i += 1) works.push(await registeredWork(t, chain, creator));

    for (const workId of works.slice(0, 3)) await backOf(t, backer, workId);
    await expect(backOf(t, backer, works[3])).rejects.toMatchObject({
      data: { code: "WEEKLY_LIMIT", message: "You've used your 3 Backs for this registry week." },
    });
    expect(await view(t, backer, works[3])).toMatchObject({ canBack: false, weeklyUsed: 3, reason: { code: "WEEKLY_LIMIT" } });
    await settle(t, chain);
    expect(await refusalCode(backOf(t, backer, works[3]))).toBe("WEEKLY_LIMIT");

    // The next registry week starts on Monday 2026-10-05 00:00 UTC.
    vi.setSystemTime(new Date("2026-10-05T00:00:01Z"));
    expect(await view(t, backer, works[3])).toMatchObject({ canBack: true, weeklyUsed: 0 });
    const { backId } = await backOf(t, backer, works[3]);
    await settle(t, chain);
    expect(await t.run(async (ctx) => (await ctx.db.get("backs", backId))!)).toMatchObject({ status: "confirmed", ordinal: 1, week: 1 });
  });

  it("lets a member Back again after a Back that didn't go through", async () => {
    const { t, chain } = await setup();
    await setChainWrites(t, true);
    const creator = await insertMember(t);
    const backer = await insertMember(t);
    const workId = await registeredWork(t, chain, creator);
    const { backId } = await backOf(t, backer, workId);
    const writeId = (await t.run(async (ctx) => (await ctx.db.get("backs", backId))!)).chainWriteId!;
    await t.run(async (ctx) => {
      await ctx.db.patch("chainWrites", writeId, { status: "failed", error: "The registry changed since this write was queued." });
      await ctx.db.patch("backs", backId, { status: "failed", error: "The registry changed since this write was queued." });
    });
    expect(await view(t, backer, workId)).toMatchObject({
      canBack: true,
      weeklyUsed: 0,
      viewer: { status: "failed", error: "The registry changed since this write was queued." },
    });

    expect((await backOf(t, backer, workId)).backId).toBe(backId);
    expect(await t.run(async (ctx) => (await ctx.db.get("chainWrites", writeId))!)).toMatchObject({ status: "pending", backId });
    await settle(t, chain);
    const back = await t.run(async (ctx) => (await ctx.db.get("backs", backId))!);
    expect(back).toMatchObject({ status: "confirmed", ordinal: 1 });
    expect(back.error).toBeUndefined();
    expect(chain.state.backerCount.get(workIdFor(workId).toLowerCase())).toBe(1n);
    expect(await t.run((ctx) => ctx.db.query("chainWrites").collect())).toHaveLength(2);
  });
});
