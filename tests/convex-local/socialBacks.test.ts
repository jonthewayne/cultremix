import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { enqueueRegisterWork } from "../../convex/lib/chain/queue";
import { registryWeek } from "../../convex/lib/chain/writes";
import { BACK_WEIGHT } from "../../convex/lib/trending";
import { RELAYER, insertMember, insertWork, setChainWrites, setFlag, useChainEnv } from "./chainFixtures";
import { FakeChain } from "./fakeChain";
import { newTest } from "./setup";
import { page } from "./socialFixtures";
import type { Member } from "./chainFixtures";
import type { MutationCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

// Backs in the social layer: a confirmed Back notifies the creator, shows in Following, joins the
// backer's profile, and counts toward Trending. Backs come through the relayer and a fake chain,
// as in backs.test.ts.

type T = ReturnType<typeof newTest>;
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  useChainEnv();
  const t = newTest();
  const chain = new FakeChain({ relayer: RELAYER });
  setChainDepsForTests({ rpc: () => chain });
  await setFlag(t, "social.backs", true);
  await setChainWrites(t, true);
  return { t, chain };
}

const asCtx = (ctx: unknown) => ctx as MutationCtx;
const as = (t: T, member: Member) => t.withIdentity({ subject: member.authId, issuer: "test" });
const backOf = (t: T, member: Member, workId: Id<"works">) => as(t, member).mutation(api.backs.back, { workId });

async function member(t: T, username: string) {
  return await insertMember(t, { fields: { username, usernameLower: username } });
}

async function settle(t: T, chain: FakeChain, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await t.action(internal.chain.tick, {});
    await chain.mine(chain.finalityLag + 1);
  }
  await t.action(internal.chain.tick, {});
}

/** A published work, registered and confirmed onchain. */
async function registeredWork(t: T, chain: FakeChain, creator: Member, title: string) {
  const workId = await insertWork(t, creator.userId, { fields: { title } });
  await t.run((ctx) => enqueueRegisterWork(asCtx(ctx), workId));
  await settle(t, chain, 1);
  return workId;
}

const backStatus = (t: T, backId: Id<"backs">) => t.run(async (ctx) => (await ctx.db.get("backs", backId))!.status);
const notificationsFor = (t: T, viewer: Member) => as(t, viewer).query(api.notifications.list, { paginationOpts: page(20) });
const unread = async (t: T, viewer: Member) => (await as(t, viewer).query(api.notifications.status, {})).unread;
const backEvents = (t: T) => t.run((ctx) => ctx.db.query("activityEvents").filter((q) => q.eq(q.field("verb"), "back")).collect());

/** Fills the backer's registry week onchain (in finalized state too), so the registry refuses their next Back. */
async function useUpWeekOnchain(chain: FakeChain, backer: Member) {
  chain.state.weeklyBacks.set(`${backer.address.toLowerCase()}:${registryWeek(Date.now())}`, 3n);
  await chain.mine(chain.finalityLag + 1);
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

describe("Back notifications", () => {
  it("tell the creator once, when the chain confirms the Back, not while it's reserved or sent", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const workId = await registeredWork(t, chain, creator, "Harbor");

    const { backId } = await backOf(t, alice, workId);
    expect(await backStatus(t, backId)).toBe("reserved");
    expect((await notificationsFor(t, creator)).page).toEqual([]);

    await t.action(internal.chain.tick, {});
    expect(await backStatus(t, backId)).toBe("submitted");
    expect((await notificationsFor(t, creator)).page).toEqual([]);
    expect(await unread(t, creator)).toBe(0);

    await settle(t, chain);
    expect(await backStatus(t, backId)).toBe("confirmed");
    const { page: rows } = await notificationsFor(t, creator);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "back", actor: { username: "alice" }, work: { title: "Harbor" } });
    expect(rows[0].work?.cr).toMatch(/^\d+-\d{3}$/u);
    expect(await unread(t, creator)).toBe(1);
    // The backer hears nothing about their own Back.
    expect((await notificationsFor(t, alice)).page).toEqual([]);

    // More relayer ticks don't confirm it again.
    await settle(t, chain);
    expect((await notificationsFor(t, creator)).page).toHaveLength(1);
    expect(await backEvents(t)).toHaveLength(1);
  });

  it("say nothing for a Back the registry refused, and notify once if it's Backed again and confirmed", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const workId = await registeredWork(t, chain, creator, "Harbor");

    await useUpWeekOnchain(chain, alice);
    const { backId } = await backOf(t, alice, workId);
    await settle(t, chain);
    expect(await backStatus(t, backId)).toBe("rejected");
    expect((await notificationsFor(t, creator)).page).toEqual([]);
    expect(await unread(t, creator)).toBe(0);
    expect(await backEvents(t)).toEqual([]);
    expect(await t.query(api.social.profile, { username: "alice" })).toMatchObject({ backed: 0 });
    expect(await t.run((ctx) => ctx.db.query("trendingWorks").collect())).toEqual([]);

    // The next registry week the registry takes it.
    vi.setSystemTime(new Date("2026-10-05T00:00:01Z"));
    expect((await backOf(t, alice, workId)).backId).toBe(backId);
    await settle(t, chain);
    expect(await backStatus(t, backId)).toBe("confirmed");
    expect((await notificationsFor(t, creator)).page.map((row) => row.kind)).toEqual(["back"]);
  });

  it("say nothing for a Back whose write failed", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const workId = await registeredWork(t, chain, creator, "Harbor");
    const { backId } = await backOf(t, alice, workId);
    const writeId = (await t.run(async (ctx) => (await ctx.db.get("backs", backId))!)).chainWriteId!;
    // A write bound to another registry fails closed when the relayer picks it up.
    await t.run((ctx) => ctx.db.patch("chainWrites", writeId, { chainId: 10143, registryAddress: "0x0000000000000000000000000000000000000001" }));
    await settle(t, chain);
    expect(await backStatus(t, backId)).toBe("failed");
    expect((await notificationsFor(t, creator)).page).toEqual([]);
    expect(await backEvents(t)).toEqual([]);
  });
});

describe("Backs in Following", () => {
  it("show a followed member's confirmed Back with the work", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const viewer = await member(t, "viewer");
    const workId = await registeredWork(t, chain, creator, "Harbor");
    await as(t, viewer).mutation(api.social.setFollow, { username: "alice", follow: true });
    const following = () => as(t, viewer).query(api.feed.following, { paginationOpts: page(10) });

    await backOf(t, alice, workId);
    await t.action(internal.chain.tick, {});
    expect((await following()).page).toEqual([]);

    await settle(t, chain);
    const { page: items } = await following();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      workId,
      title: "Harbor",
      creator: { username: "maker" },
      backedBy: { username: "alice", ordinal: 1 },
    });

    // Signed out, Following stays empty; someone who doesn't follow alice doesn't see it.
    expect((await t.query(api.feed.following, { paginationOpts: page(10) })).page).toEqual([]);
    const stranger = await member(t, "stranger");
    expect((await as(t, stranger).query(api.feed.following, { paginationOpts: page(10) })).page).toEqual([]);

    // A work since withdrawn drops out.
    await t.run((ctx) => ctx.db.patch("works", workId, { status: "withdrawn" }));
    expect((await following()).page).toEqual([]);
  });

  it("puts Backs and new designs in one newest-first list", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const viewer = await member(t, "viewer");
    const first = await registeredWork(t, chain, creator, "First");
    await as(t, viewer).mutation(api.social.setFollow, { username: "alice", follow: true });
    await as(t, viewer).mutation(api.social.setFollow, { username: "maker", follow: true });
    // The maker's publish event, as publishing writes it.
    await t.run(async (ctx) => {
      await ctx.db.insert("activityEvents", { actorId: creator.userId, verb: "publish_original", workId: first, createdAt: Date.now() - DAY, shelf: "works" });
    });

    await backOf(t, alice, first);
    await settle(t, chain);
    const { page: items } = await as(t, viewer).query(api.feed.following, { paginationOpts: page(10) });
    expect(items.map((item) => [item.title, item.backedBy?.username ?? null])).toEqual([
      ["First", "alice"],
      ["First", null],
    ]);
    // The work's own publish event is still found for the backfill.
    await t.mutation(internal.activity.backfill, {});
    const events = await t.run((ctx) => ctx.db.query("activityEvents").collect());
    expect(events.map((event) => event.verb).sort()).toEqual(["back", "publish_original"]);
  });
});

type BackedPage = FunctionReturnType<typeof api.social.backed>;

describe("Backed on profiles", () => {
  it("lists the works a member has Backed, newest first, with their place in line, paged and signed out", async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const works: Array<Id<"works">> = [];
    for (let i = 1; i <= 6; i += 1) works.push(await registeredWork(t, chain, creator, `W${i}`));

    // Bob Backs W2 first, so alice is its second backer.
    await backOf(t, bob, works[1]);
    await settle(t, chain);
    for (const workId of works.slice(0, 3)) {
      vi.setSystemTime(Date.now() + 60_000);
      await backOf(t, alice, workId);
      await settle(t, chain);
    }
    vi.setSystemTime(new Date("2026-10-05T09:00:00Z"));
    for (const workId of works.slice(3, 5)) {
      vi.setSystemTime(Date.now() + 60_000);
      await backOf(t, alice, workId);
      await settle(t, chain);
    }
    // Reserved and not yet recorded: not on the profile.
    await backOf(t, alice, works[5]);

    const pages: Array<BackedPage["page"]> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: BackedPage = await t.query(api.social.backed, { username: "alice", paginationOpts: page(2, cursor) });
      pages.push(result.page);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const shown = pages.flat().map((item) => [item.title, item.backedBy?.ordinal]);
    expect(shown).toEqual([
      ["W5", 1],
      ["W4", 1],
      ["W3", 1],
      ["W2", 2],
      ["W1", 1],
    ]);
    expect(pages[0]).toHaveLength(2);
    expect(pages.flat().every((item) => item.backedBy?.username === "alice" && item.creator.username === "maker")).toBe(true);
    expect(await t.query(api.social.profile, { username: "alice" })).toMatchObject({ backed: 5, followers: 0, following: 0 });
    expect(await t.query(api.social.profile, { username: "bob" })).toMatchObject({ backed: 1 });
    expect(await t.query(api.social.profile, { username: "maker" })).toMatchObject({ backed: 0 });

    // Backs stay off the Works and Remixes shelves.
    const shelf = await t.query(api.social.works, { username: "alice", shelf: "works", paginationOpts: page(10) });
    expect(shelf.page).toEqual([]);
    // Public fields only.
    expect(JSON.stringify(pages)).not.toMatch(/@example\.com|auth-|0x[0-9a-f]{40}/iu);
    expect(await t.query(api.social.backed, { username: "nobody", paginationOpts: page(10) })).toEqual({ page: [], isDone: true, continueCursor: "" });

    // The pending one appears once it's confirmed.
    await settle(t, chain);
    const latest = await as(t, alice).query(api.social.backed, { username: "alice", paginationOpts: page(1) });
    expect(latest.page.map((item) => item.title)).toEqual(["W6"]);
  });
});

describe("Backs in Trending", () => {
  it(`count a confirmed Back as ${BACK_WEIGHT}, between a heart and a remix, and expire with the week`, async () => {
    const { t, chain } = await setup();
    const creator = await member(t, "maker");
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const backed = await registeredWork(t, chain, creator, "Backed");
    const hearted = await registeredWork(t, chain, creator, "Hearted");
    const remixed = await registeredWork(t, chain, creator, "Remixed");
    const titles = async () => (await t.query(api.feed.trending, { paginationOpts: page(10) })).page.map((item) => item.title);
    const scores = () => t.run(async (ctx) => Object.fromEntries((await ctx.db.query("trendingWorks").collect()).map((row) => [row.workId, row.score])));

    await as(t, bob).mutation(api.social.setHeart, { workId: hearted, heart: true });
    await insertWork(t, bob.userId, { kind: "fork", parentWorkId: remixed, fields: { title: "Fork", status: "preparing", publishedAt: undefined } }).then((workId) =>
      t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" }),
    );
    await backOf(t, alice, backed);
    await t.action(internal.chain.tick, {});
    // Reserved and sent Backs aren't attention yet.
    expect((await scores())[backed]).toBeUndefined();

    await settle(t, chain);
    expect(await scores()).toEqual({ [hearted]: 1, [backed]: BACK_WEIGHT, [remixed]: 3 });
    expect(await titles()).toEqual(["Remixed", "Backed", "Hearted"]);

    // A rebuild replays the confirmed Back.
    expect(await t.mutation(internal.trending.rebuild, {})).toEqual({ hearts: 1, remixes: 1, backs: 1 });
    expect(await scores()).toEqual({ [hearted]: 1, [backed]: BACK_WEIGHT, [remixed]: 3 });

    // Eight days on, the day leaves the window and the Back comes off the score.
    vi.setSystemTime(Date.now() + 8 * DAY);
    await t.mutation(internal.trending.expire, {});
    expect(await scores()).toEqual({});
    expect(await t.mutation(internal.trending.rebuild, {})).toEqual({ hearts: 0, remixes: 0, backs: 0 });
  });
});
