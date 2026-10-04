import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";
import { addMember, addWork, page } from "./socialFixtures";

const DAY = 24 * 60 * 60 * 1000;
type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function fans(t: T, count: number, prefix = "fan") {
  const members = [];
  for (let i = 0; i < count; i++) members.push(await addMember(t, `${prefix}${i}`));
  return members;
}

async function remix(t: T, creatorId: Id<"users">, parentWorkId: Id<"works">) {
  const workId = await addWork(t, creatorId, { status: "preparing", kind: "fork", parentWorkId });
  await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });
  return workId;
}

async function trendingTitles(t: T, numItems = 20) {
  const result = await t.query(api.feed.trending, { paginationOpts: page(numItems) });
  return result.page.map((item) => item.title);
}

describe("trending", () => {
  it("ranks by hearts and remixes from others, remixes weighing more, signed out", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const [bob, cara] = await fans(t, 2);
    const hearted = await addWork(t, alice.userId, { title: "two hearts" });
    const remixed = await addWork(t, alice.userId, { title: "one remix" });
    const once = await addWork(t, alice.userId, { title: "one heart" });
    await addWork(t, alice.userId, { title: "quiet" });

    await bob.as.mutation(api.social.setHeart, { workId: hearted, heart: true });
    await cara.as.mutation(api.social.setHeart, { workId: hearted, heart: true });
    await remix(t, bob.userId, remixed);
    await cara.as.mutation(api.social.setHeart, { workId: once, heart: true });
    // Your own hearts and remixes don't count.
    await alice.as.mutation(api.social.setHeart, { workId: once, heart: true });
    await remix(t, alice.userId, once);
    await remix(t, alice.userId, once);

    expect(await trendingTitles(t)).toEqual(["one remix", "two hearts", "one heart"]);
  });

  it("breaks ties by the most recent attention, and forgets a heart taken back", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const [bob, cara] = await fans(t, 2);
    const first = await addWork(t, alice.userId, { title: "first" });
    const second = await addWork(t, alice.userId, { title: "second" });

    await bob.as.mutation(api.social.setHeart, { workId: first, heart: true });
    vi.advanceTimersByTime(1000);
    await bob.as.mutation(api.social.setHeart, { workId: second, heart: true });
    expect(await trendingTitles(t)).toEqual(["second", "first"]);

    vi.advanceTimersByTime(1000);
    await cara.as.mutation(api.social.setHeart, { workId: first, heart: true });
    expect(await trendingTitles(t)).toEqual(["first", "second"]);

    await bob.as.mutation(api.social.setHeart, { workId: second, heart: false });
    expect(await trendingTitles(t)).toEqual(["first"]);
    expect(await t.run((ctx) => ctx.db.query("trendingWorks").collect())).toHaveLength(1);
  });

  it("only counts the last 7 days once the hourly cron runs", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const [bob, cara, dan] = await fans(t, 3);
    const old = await addWork(t, alice.userId, { title: "old" });
    const recent = await addWork(t, alice.userId, { title: "recent" });

    // Day 0: three hearts on "old". Day 2: one heart on "recent".
    for (const fan of [bob, cara, dan]) await fan.as.mutation(api.social.setHeart, { workId: old, heart: true });
    vi.advanceTimersByTime(2 * DAY);
    await bob.as.mutation(api.social.setHeart, { workId: recent, heart: true });

    vi.advanceTimersByTime(4 * DAY);
    await t.mutation(internal.trending.expire, {});
    expect(await trendingTitles(t)).toEqual(["old", "recent"]);

    // Day 7: day 0 has left the window.
    vi.advanceTimersByTime(DAY);
    expect(await t.mutation(internal.trending.expire, {})).toEqual({ expired: 1 });
    expect(await trendingTitles(t)).toEqual(["recent"]);
    // Taking back a heart from a day that has left the window changes nothing now.
    await bob.as.mutation(api.social.setHeart, { workId: old, heart: false });
    expect(await trendingTitles(t)).toEqual(["recent"]);
    expect(await t.mutation(internal.trending.expire, {})).toEqual({ expired: 0 });
  });

  it("pages through every trending work once, and drops works no longer published", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const members = await fans(t, 7);
    const titles: Array<string> = [];
    const works: Array<Id<"works">> = [];
    for (let i = 0; i < 7; i++) {
      const workId = await addWork(t, alice.userId, { title: `w${i}` });
      works.push(workId);
      // Work i gets i + 1 hearts.
      for (const fan of members.slice(0, i + 1)) {
        await fan.as.mutation(api.social.setHeart, { workId, heart: true });
      }
      titles.unshift(`w${i}`);
    }

    const seen: Array<string | undefined> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: FunctionReturnType<typeof api.feed.trending> = await t.query(api.feed.trending, {
        paginationOpts: page(3, cursor),
      });
      seen.push(...result.page.map((item) => item.title));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(titles);

    await t.run((ctx) => ctx.db.patch("works", works[6], { status: "withdrawn" }));
    expect((await trendingTitles(t, 3))).toEqual(["w5", "w4"]);
  });

  it("rebuilds from the last week of hearts and remixes, and is safe to rerun", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const [bob, cara] = await fans(t, 2);
    const hearted = await addWork(t, alice.userId, { title: "hearted" });
    const remixed = await addWork(t, alice.userId, { title: "remixed" });
    const stale = await addWork(t, alice.userId, { title: "stale" });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("hearts", { userId: bob.userId, workId: hearted, createdAt: now - DAY });
      await ctx.db.insert("hearts", { userId: cara.userId, workId: hearted, createdAt: now - 2 * DAY });
      await ctx.db.insert("hearts", { userId: alice.userId, workId: hearted, createdAt: now });
      await ctx.db.insert("hearts", { userId: bob.userId, workId: stale, createdAt: now - 10 * DAY });
      await ctx.db.insert("hearts", { userId: cara.userId, workId: stale, createdAt: now - 9 * DAY });
      await ctx.db.insert("hearts", { userId: bob.userId, workId: stale, createdAt: now - 8 * DAY });
    });
    await addWork(t, bob.userId, { title: "a remix", kind: "fork", parentWorkId: remixed, publishedAt: now - 3 * DAY });

    expect(await t.mutation(internal.trending.rebuild, {})).toEqual({ hearts: 2, remixes: 1, backs: 0 });
    expect(await t.mutation(internal.trending.rebuild, {})).toEqual({ hearts: 2, remixes: 1, backs: 0 });
    expect(await trendingTitles(t)).toEqual(["remixed", "hearted"]);
    const scores = await t.run((ctx) => ctx.db.query("trendingWorks").collect());
    expect(scores.map((row) => row.score).sort()).toEqual([2, 3]);
  });
});
