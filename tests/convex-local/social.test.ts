import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { addMember, addWork } from "./socialFixtures";

describe("follows", () => {
  it("is idempotent and keeps both counts in step", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    await addMember(t, "bob");

    expect(await alice.as.mutation(api.social.setFollow, { username: "bob", follow: true })).toEqual({
      following: true,
      followers: 1,
    });
    // Following again changes nothing.
    expect(await alice.as.mutation(api.social.setFollow, { username: "Bob", follow: true })).toEqual({
      following: true,
      followers: 1,
    });
    const rows = await t.run((ctx) => ctx.db.query("follows").collect());
    expect(rows).toHaveLength(1);
    expect(await t.query(api.social.profile, { username: "bob" })).toMatchObject({ followers: 1, following: 0 });
    expect(await t.query(api.social.profile, { username: "alice" })).toMatchObject({ followers: 0, following: 1 });
    expect(await alice.as.query(api.social.followState, { username: "bob" })).toEqual({ following: true, self: false });

    await alice.as.mutation(api.social.setFollow, { username: "bob", follow: false });
    expect(await alice.as.mutation(api.social.setFollow, { username: "bob", follow: false })).toEqual({
      following: false,
      followers: 0,
    });
    expect(await t.run((ctx) => ctx.db.query("follows").collect())).toHaveLength(0);
    expect(await t.query(api.social.profile, { username: "alice" })).toMatchObject({ followers: 0, following: 0 });
  });

  it("refuses following yourself, unknown members, and signed-out callers", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    await expect(alice.as.mutation(api.social.setFollow, { username: "alice", follow: true })).rejects.toThrow(
      /yourself/u,
    );
    await expect(alice.as.mutation(api.social.setFollow, { username: "nobody", follow: true })).rejects.toThrow(
      /No member/u,
    );
    await expect(t.mutation(api.social.setFollow, { username: "alice", follow: true })).rejects.toThrow(/Sign in/u);
    expect(await alice.as.query(api.social.followState, { username: "alice" })).toEqual({ following: false, self: true });
    expect(await t.query(api.social.followState, { username: "alice" })).toEqual({ following: false, self: false });
    expect(await t.run((ctx) => ctx.db.query("userSocialStats").collect())).toHaveLength(0);
  });

  it("needs a username before following", async () => {
    const t = newTest();
    await addMember(t, "bob");
    await t.run((ctx) => ctx.db.insert("users", { authId: "test|fresh", email: "fresh@example.com" }));
    const fresh = t.withIdentity({ subject: "test|fresh", issuer: "test" });
    await expect(fresh.mutation(api.social.setFollow, { username: "bob", follow: true })).rejects.toThrow(/username/u);
  });
});

describe("hearts", () => {
  it("is idempotent and counts each member once", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const workId = await addWork(t, bob.userId);

    await alice.as.mutation(api.social.setHeart, { workId, heart: true });
    expect(await alice.as.mutation(api.social.setHeart, { workId, heart: true })).toEqual({ hearted: true, count: 1 });
    // Hearting your own work is fine.
    expect(await bob.as.mutation(api.social.setHeart, { workId, heart: true })).toEqual({ hearted: true, count: 2 });
    expect(await alice.as.query(api.social.heartState, { workId })).toEqual({ hearted: true, count: 2 });
    expect(await t.query(api.social.heartState, { workId })).toEqual({ hearted: false, count: 2 });

    await alice.as.mutation(api.social.setHeart, { workId, heart: false });
    expect(await alice.as.mutation(api.social.setHeart, { workId, heart: false })).toEqual({ hearted: false, count: 1 });
    expect(await t.run((ctx) => ctx.db.query("hearts").collect())).toHaveLength(1);
    const feed = await t.query(api.feed.latest, { paginationOpts: { numItems: 5, cursor: null } });
    expect(feed.page[0].hearts).toBe(1);
  });

  it("takes new hearts only on published works, but lets a heart on a withdrawn work go", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const preparing = await addWork(t, bob.userId, { status: "preparing" });
    await expect(alice.as.mutation(api.social.setHeart, { workId: preparing, heart: true })).rejects.toThrow(
      /isn’t published/u,
    );
    await expect(t.mutation(api.social.setHeart, { workId: preparing, heart: true })).rejects.toThrow(/Sign in/u);

    const workId = await addWork(t, bob.userId);
    await alice.as.mutation(api.social.setHeart, { workId, heart: true });
    await t.run((ctx) => ctx.db.patch("works", workId, { status: "withdrawn" }));
    expect(await alice.as.query(api.social.heartState, { workId })).toEqual({ hearted: false, count: 0 });
    expect(await alice.as.mutation(api.social.setHeart, { workId, heart: false })).toEqual({ hearted: false, count: 0 });
    expect(await t.run((ctx) => ctx.db.query("hearts").collect())).toHaveLength(0);
  });
});

describe("profiles", () => {
  it("render signed out with public fields only", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice", { creatorNumber: 1, email: "secret@example.com" });
    await t.run((ctx) =>
      ctx.db.patch("users", alice.userId, { image: "https://images.example.com/a.png", bio: "Hi", phone: "+15555550100" }),
    );
    const profile = await t.query(api.social.profile, { username: "ALICE" });
    expect(profile).toEqual({
      username: "alice",
      creatorNumber: 1,
      image: "https://images.example.com/a.png",
      bio: "Hi",
      followers: 0,
      following: 0,
    });
    expect(JSON.stringify(profile)).not.toMatch(/secret|test\|alice|5555550100/u);
    expect(await t.query(api.social.profile, { username: "nobody" })).toBeNull();
  });

  it("never shows a non-https avatar", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    await t.run((ctx) => ctx.db.patch("users", alice.userId, { image: "javascript:alert(1)" }));
    expect((await t.query(api.social.profile, { username: "alice" }))?.image).toBeUndefined();
  });

  it("splits works from remixes and pages through them", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const parent = await addWork(t, bob.userId, { publishedAt: 1000 });
    for (let i = 0; i < 5; i += 1) await addWork(t, alice.userId, { publishedAt: 2000 + i, title: `w${i}` });
    await addWork(t, alice.userId, { publishedAt: 3000, kind: "variation", parentWorkId: parent, title: "remix" });
    await addWork(t, alice.userId, { publishedAt: 3001, kind: "fork", parentWorkId: parent, title: "fork" });
    await addWork(t, alice.userId, { status: "preparing" });

    const first = await t.query(api.social.works, {
      username: "alice",
      shelf: "works",
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(first.page.map((item) => item.title)).toEqual(["w4", "w3", "w2"]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.social.works, {
      username: "alice",
      shelf: "works",
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    expect(second.page.map((item) => item.title)).toEqual(["w1", "w0"]);
    expect(second.isDone).toBe(true);

    const remixes = await t.query(api.social.works, {
      username: "alice",
      shelf: "remixes",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(remixes.page.map((item) => item.title)).toEqual(["fork", "remix"]);
    expect(remixes.page[0].parentCr).toBeDefined();
  });
});

describe("bio", () => {
  it("saves plain text, clears when empty, and refuses long bios", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    expect(await alice.as.mutation(api.social.setBio, { bio: "  Prints\n\tand   remixes ​ " })).toBe(
      "Prints and remixes",
    );
    expect((await t.query(api.social.profile, { username: "alice" }))?.bio).toBe("Prints and remixes");
    await alice.as.mutation(api.social.setBio, { bio: "   " });
    expect((await t.query(api.social.profile, { username: "alice" }))?.bio).toBeUndefined();
    await expect(alice.as.mutation(api.social.setBio, { bio: "x".repeat(161) })).rejects.toThrow(/160/u);
    await expect(t.mutation(api.social.setBio, { bio: "hi" })).rejects.toThrow(/Sign in/u);
  });
});
