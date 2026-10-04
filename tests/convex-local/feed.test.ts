import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { addMember, addWork, page } from "./socialFixtures";

const FEED_ITEM_KEYS = [
  "artMediumUrl",
  "artThumbUrl",
  "artUrl",
  "backgroundColor",
  "cr",
  "creator",
  "hearts",
  "kind",
  "parentCr",
  "photoMediumUrl",
  "photoState",
  "photoUrl",
  "publishedAt",
  "title",
  "workId",
];

describe("Latest", () => {
  it("lists every published work newest first, a page at a time, signed out", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    for (let i = 0; i < 5; i += 1) {
      await addWork(t, i % 2 ? alice.userId : bob.userId, { publishedAt: 1000 + i, title: `t${i}` });
    }
    await addWork(t, alice.userId, { status: "preparing", title: "hidden" });

    const first = await t.query(api.feed.latest, { paginationOpts: page(2) });
    expect(first.page.map((item) => item.title)).toEqual(["t4", "t3"]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.feed.latest, { paginationOpts: page(2, first.continueCursor) });
    const third = await t.query(api.feed.latest, { paginationOpts: page(2, second.continueCursor) });
    expect([...second.page, ...third.page].map((item) => item.title)).toEqual(["t2", "t1", "t0"]);
    expect(third.isDone).toBe(true);

    for (const item of first.page) {
      expect(Object.keys(item).every((key) => FEED_ITEM_KEYS.includes(key))).toBe(true);
      expect(Object.keys(item.creator).sort()).toEqual(["creatorNumber", "username"].filter((k) => k in item.creator));
    }
    expect(JSON.stringify(first)).not.toMatch(/example\.com|test\||requestId|generationId|notes/u);
  });

  it("caps the page size a browser can ask for", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    for (let i = 0; i < 50; i += 1) await addWork(t, alice.userId, { publishedAt: 1000 + i });
    const result = await t.query(api.feed.latest, { paginationOpts: page(10_000) });
    expect(result.page).toHaveLength(48);
    expect(result.isDone).toBe(false);
  });
});

describe("Following", () => {
  it("shows only followed creators, newest first", async () => {
    const t = newTest();
    const viewer = await addMember(t, "viewer");
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const carol = await addMember(t, "carol");
    await addWork(t, alice.userId, { publishedAt: 100, title: "alice-1" });
    await addWork(t, bob.userId, { publishedAt: 200, title: "bob-1" });
    await addWork(t, carol.userId, { publishedAt: 300, title: "carol-1" });
    await addWork(t, alice.userId, { publishedAt: 400, title: "alice-2" });
    await addWork(t, viewer.userId, { publishedAt: 500, title: "mine" });
    await addWork(t, alice.userId, { status: "preparing", title: "not yet" });

    await viewer.as.mutation(api.social.setFollow, { username: "alice", follow: true });
    await viewer.as.mutation(api.social.setFollow, { username: "carol", follow: true });

    const result = await viewer.as.query(api.feed.following, { paginationOpts: page(10) });
    expect(result.page.map((item) => item.title)).toEqual(["alice-2", "carol-1", "alice-1"]);
    expect(result.isDone).toBe(true);

    await viewer.as.mutation(api.social.setFollow, { username: "carol", follow: false });
    const after = await viewer.as.query(api.feed.following, { paginationOpts: page(10) });
    expect(after.page.map((item) => item.title)).toEqual(["alice-2", "alice-1"]);
  });

  it("is empty signed out", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    await addWork(t, alice.userId, { publishedAt: 100 });
    expect(await t.query(api.feed.following, { paginationOpts: page(10) })).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
  });

  it("pages through every event once, even when several share a timestamp", async () => {
    const t = newTest();
    const viewer = await addMember(t, "viewer");
    const creators = await Promise.all(["a1", "a2", "a3"].map((name) => addMember(t, name)));
    const expected: Array<string> = [];
    // Three creators, seven works each; every pair of works shares a timestamp.
    for (let i = 0; i < 7; i += 1) {
      for (const [j, creator] of creators.entries()) {
        const title = `${i}-${j}`;
        await addWork(t, creator.userId, { publishedAt: 1000 + Math.floor((i * 3 + j) / 2), title });
        expected.push(title);
      }
    }
    for (const name of ["a1", "a2", "a3"]) {
      await viewer.as.mutation(api.social.setFollow, { username: name, follow: true });
    }
    const seen: Array<string> = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const result: { page: Array<{ title?: string }>; isDone: boolean; continueCursor: string } =
        await viewer.as.query(api.feed.following, { paginationOpts: page(4, cursor) });
      seen.push(...result.page.map((item) => item.title ?? ""));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toHaveLength(21);
    expect(new Set(seen).size).toBe(21);
    // Newest first: insertion order reversed (ties broken by creation order).
    expect(seen).toEqual([...expected].reverse());
  });

  it("keeps a pinned page contiguous when a followed creator publishes", async () => {
    const t = newTest();
    const viewer = await addMember(t, "viewer");
    const alice = await addMember(t, "alice");
    for (let i = 0; i < 6; i += 1) await addWork(t, alice.userId, { publishedAt: 1000 + i, title: `w${i}` });
    await viewer.as.mutation(api.social.setFollow, { username: "alice", follow: true });

    const first = await viewer.as.query(api.feed.following, { paginationOpts: page(3) });
    expect(first.page.map((item) => item.title)).toEqual(["w5", "w4", "w3"]);
    await addWork(t, alice.userId, { publishedAt: 2000, title: "new" });
    // The browser pins page one at the cursor page two started from.
    const pinned = await viewer.as.query(api.feed.following, {
      paginationOpts: page(3, null, first.continueCursor),
    });
    expect(pinned.page.map((item) => item.title)).toEqual(["new", "w5", "w4", "w3"]);
    expect(pinned.continueCursor).toBe(first.continueCursor);
    const second = await viewer.as.query(api.feed.following, { paginationOpts: page(3, first.continueCursor) });
    expect(second.page.map((item) => item.title)).toEqual(["w2", "w1", "w0"]);
  });

  it("reads only the latest 200 accounts a member follows", async () => {
    const t = newTest();
    const viewer = await addMember(t, "viewer");
    const first = await addMember(t, "first_followed");
    await addWork(t, first.userId, { publishedAt: 5000, title: "oldest follow" });
    await viewer.as.mutation(api.social.setFollow, { username: "first_followed", follow: true });
    const ids = await t.run(async (ctx) => {
      const out = [];
      for (let i = 0; i < 200; i += 1) {
        const id = await ctx.db.insert("users", { username: `m${i}`, usernameLower: `m${i}` });
        await ctx.db.insert("follows", { followerId: (await ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "test|viewer")).unique())!._id, followeeId: id, createdAt: Date.now() + 1 + i });
        out.push(id);
      }
      return out;
    });
    await addWork(t, ids[199], { publishedAt: 100, title: "newest follow" });
    const result = await viewer.as.query(api.feed.following, { paginationOpts: page(10) });
    expect(result.page.map((item) => item.title)).toEqual(["newest follow"]);
  });

  it("rejects a cursor it didn't write", async () => {
    const t = newTest();
    const viewer = await addMember(t, "viewer");
    const result = await viewer.as.query(api.feed.following, { paginationOpts: page(10, "not-a-cursor") });
    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});

describe("work page remixes", () => {
  it("pages a work's published remixes in number order", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const parent = await addWork(t, alice.userId, { publishedAt: 100 });
    for (let i = 0; i < 4; i += 1) {
      await addWork(t, alice.userId, { publishedAt: 200 + i, kind: "variation", parentWorkId: parent, title: `r${i}` });
    }
    await addWork(t, alice.userId, { status: "preparing", kind: "variation", parentWorkId: parent, title: "hidden" });
    const cr = (await t.query(api.feed.latest, { paginationOpts: page(10) })).page.find(
      (item) => item.workId === parent,
    )!.cr;
    const first = await t.query(api.feed.remixes, { cr, paginationOpts: page(3) });
    expect(first.page.map((item) => item.title)).toEqual(["r0", "r1", "r2"]);
    const rest = await t.query(api.feed.remixes, { cr, paginationOpts: page(3, first.continueCursor) });
    expect(rest.page.map((item) => item.title)).toEqual(["r3"]);
    expect(rest.isDone).toBe(true);
    expect(await t.query(api.feed.remixes, { cr: "999-001", paginationOpts: page(3) })).toMatchObject({ page: [] });
  });
});

describe("activity events", () => {
  it("markPublished writes one event on the creator's works shelf", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const workId = await addWork(t, alice.userId, { status: "preparing" });
    await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });
    await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });
    const events = await t.run((ctx) => ctx.db.query("activityEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: alice.userId, verb: "publish_original", workId, shelf: "works" });
    const profile = await t.query(api.social.works, { username: "alice", shelf: "works", paginationOpts: page(5) });
    expect(profile.page.map((item) => item.workId)).toEqual([workId]);
  });

  it("the backfill adds missing events once, at each work's publish time", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const parent = await addWork(t, alice.userId, { publishedAt: 100, withEvent: false });
    await addWork(t, alice.userId, { publishedAt: 200, kind: "variation", parentWorkId: parent, withEvent: false });
    await addWork(t, alice.userId, { publishedAt: 300 });
    await addWork(t, alice.userId, { status: "preparing" });
    await t.mutation(internal.activity.backfill, {});
    await t.mutation(internal.activity.backfill, {});
    const events = await t.run((ctx) => ctx.db.query("activityEvents").collect());
    expect(events.map((event) => [event.createdAt, event.verb, event.shelf]).sort()).toEqual([
      [100, "publish_original", "works"],
      [200, "publish_variation", "remixes"],
      [300, "publish_original", "works"],
    ]);
  });
});
