import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { addMember, addWork, page } from "./socialFixtures";

const PUBLIC_KEYS = ["bio", "creatorNumber", "image", "username"];

describe("follower and following lists", () => {
  it("list each side newest follow first, signed out, with public fields only", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice", { creatorNumber: 1 });
    const bob = await addMember(t, "bob");
    const cara = await addMember(t, "cara");
    await addMember(t, "dan");
    await t.run((ctx) => ctx.db.patch("users", alice.userId, { bio: "Loud shirts.", image: "https://example.com/a.png" }));

    await alice.as.mutation(api.social.setFollow, { username: "dan", follow: true });
    await bob.as.mutation(api.social.setFollow, { username: "dan", follow: true });
    await cara.as.mutation(api.social.setFollow, { username: "dan", follow: true });
    await alice.as.mutation(api.social.setFollow, { username: "bob", follow: true });

    const followers = await t.query(api.social.followers, { username: "Dan", paginationOpts: page(10) });
    expect(followers.page.map((member) => member.username)).toEqual(["cara", "bob", "alice"]);
    expect(followers.isDone).toBe(true);
    expect(followers.page[2]).toEqual({
      username: "alice",
      creatorNumber: 1,
      image: "https://example.com/a.png",
      bio: "Loud shirts.",
    });
    for (const member of followers.page) {
      for (const key of Object.keys(member)) expect(PUBLIC_KEYS).toContain(key);
    }

    const following = await t.query(api.social.following, { username: "alice", paginationOpts: page(10) });
    expect(following.page.map((member) => member.username)).toEqual(["bob", "dan"]);
    expect(await t.query(api.social.following, { username: "dan", paginationOpts: page(10) })).toMatchObject({
      page: [],
      isDone: true,
    });

    // An unfollow drops off the list.
    await bob.as.mutation(api.social.setFollow, { username: "dan", follow: false });
    const after = await t.query(api.social.followers, { username: "dan", paginationOpts: page(10) });
    expect(after.page.map((member) => member.username)).toEqual(["cara", "alice"]);
  });

  it("page through every follower once and cap the page size", async () => {
    const t = newTest();
    await addMember(t, "star");
    const names = Array.from({ length: 53 }, (_, i) => `fan${String(i).padStart(2, "0")}`);
    for (const name of names) {
      const fan = await addMember(t, name);
      await fan.as.mutation(api.social.setFollow, { username: "star", follow: true });
    }

    const first = await t.query(api.social.followers, { username: "star", paginationOpts: page(1000) });
    expect(first.page).toHaveLength(48);
    expect(first.isDone).toBe(false);

    const seen: Array<string> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: { page: Array<{ username: string }>; isDone: boolean; continueCursor: string } = await t.query(api.social.followers, { username: "star", paginationOpts: page(20, cursor) });
      seen.push(...result.page.map((member) => member.username));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual([...names].reverse());
  });

  it("return an empty, finished page for an unknown member", async () => {
    const t = newTest();
    expect(await t.query(api.social.followers, { username: "nobody", paginationOpts: page(5) })).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
    expect(await t.query(api.social.following, { username: "", paginationOpts: page(5) })).toMatchObject({
      page: [],
      isDone: true,
    });
  });
});

describe("Who's making things", () => {
  it("lists each creator once, most recently published first, signed out", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice", { creatorNumber: 1 });
    const bob = await addMember(t, "bob", { creatorNumber: 2 });
    const cara = await addMember(t, "cara", { creatorNumber: 3 });
    await addMember(t, "lurker");
    await addWork(t, alice.userId, { publishedAt: 100 });
    await addWork(t, bob.userId, { publishedAt: 200 });
    await addWork(t, alice.userId, { publishedAt: 300 });
    await addWork(t, cara.userId, { status: "preparing" });
    // The backfill fills the list for works published before it existed, and is safe to rerun.
    await t.mutation(internal.activity.backfill, {});
    await t.mutation(internal.activity.backfill, {});

    const result = await t.query(api.social.activeCreators, { paginationOpts: page(10) });
    expect(result.page.map((member) => member.username)).toEqual(["alice", "bob"]);
    for (const member of result.page) {
      for (const key of Object.keys(member)) expect(PUBLIC_KEYS).toContain(key);
    }
    expect(await t.run((ctx) => ctx.db.query("creatorActivity").collect())).toHaveLength(2);
  });

  it("moves a creator to the front when they publish, and pages", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const cara = await addMember(t, "cara");
    for (const [member, at] of [
      [alice, 100],
      [bob, 200],
      [cara, 300],
    ] as const) {
      await addWork(t, member.userId, { publishedAt: at });
    }
    await t.mutation(internal.activity.backfill, {});

    const workId = await addWork(t, alice.userId, { status: "preparing" });
    await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });

    const first = await t.query(api.social.activeCreators, { paginationOpts: page(2) });
    expect(first.page.map((member) => member.username)).toEqual(["alice", "cara"]);
    expect(first.isDone).toBe(false);
    const rest = await t.query(api.social.activeCreators, { paginationOpts: page(2, first.continueCursor) });
    expect(rest.page.map((member) => member.username)).toEqual(["bob"]);
    expect(rest.isDone).toBe(true);
  });
});
