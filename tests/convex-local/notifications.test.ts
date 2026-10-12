import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { notifyBacked } from "../../convex/lib/notifications";
import { newTest } from "./setup";
import { addMember, addWork, page } from "./socialFixtures";
import type { Id } from "../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function publishRemix(
  t: ReturnType<typeof newTest>,
  creatorId: Id<"users">,
  parentWorkId: Id<"works">,
  kind: "variation" | "fork" = "fork",
) {
  const workId = await addWork(t, creatorId, { status: "preparing", kind, parentWorkId });
  await t.mutation(internal.publish.markPublished, { workId, artKey: "fake:art", contentHash: "abc" });
  return workId;
}

describe("notifications", () => {
  it("tell you about a follow, a heart, and a remix, newest first", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    await t.run((ctx) => ctx.db.patch("users", bob.userId, { image: "https://example.com/b.png" }));
    const workId = await addWork(t, alice.userId, { title: "Night Market" });

    await bob.as.mutation(api.social.setFollow, { username: "alice", follow: true });
    vi.advanceTimersByTime(1000);
    await bob.as.mutation(api.social.setHeart, { workId, heart: true });
    vi.advanceTimersByTime(1000);
    const remixId = await publishRemix(t, bob.userId, workId);

    const list = await alice.as.query(api.notifications.list, { paginationOpts: page(10) });
    expect(list.page.map((item) => item.kind)).toEqual(["remix", "heart", "follow"]);
    const [remix, heart, follow] = list.page;
    expect(remix.actor).toEqual({ username: "bob", image: "https://example.com/b.png" });
    const remixWork = await t.run((ctx) => ctx.db.get("works", remixId));
    const parentWork = await t.run((ctx) => ctx.db.get("works", workId));
    expect(remix.work?.cr).toBe(`${remixWork?.crFamily}-001`);
    expect(remix.parent).toMatchObject({ cr: `${parentWork?.crFamily}-001`, title: "Night Market" });
    expect(heart.work).toMatchObject({ cr: `${parentWork?.crFamily}-001`, title: "Night Market" });
    expect(heart.parent).toBeUndefined();
    expect(follow.work).toBeUndefined();
    expect(await alice.as.query(api.notifications.status, {})).toEqual({ unread: 3, lastReadAt: 0 });

    // Bob was the one acting; he has nothing.
    expect((await bob.as.query(api.notifications.list, { paginationOpts: page(10) })).page).toEqual([]);
  });

  it("say nothing about your own hearts and remixes", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const workId = await addWork(t, alice.userId);
    await alice.as.mutation(api.social.setHeart, { workId, heart: true });
    await publishRemix(t, alice.userId, workId, "variation");
    await expect(alice.as.mutation(api.social.setFollow, { username: "alice", follow: true })).rejects.toThrow();

    expect((await alice.as.query(api.notifications.list, { paginationOpts: page(10) })).page).toEqual([]);
    expect(await alice.as.query(api.notifications.status, {})).toEqual({ unread: 0, lastReadAt: 0 });
  });

  it("collapse repeated hearts and follows from one person within a day", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const cara = await addMember(t, "cara");
    const workId = await addWork(t, alice.userId);
    const otherWorkId = await addWork(t, alice.userId);

    for (let i = 0; i < 3; i++) {
      await bob.as.mutation(api.social.setHeart, { workId, heart: true });
      await bob.as.mutation(api.social.setHeart, { workId, heart: false });
      await bob.as.mutation(api.social.setFollow, { username: "alice", follow: true });
      await bob.as.mutation(api.social.setFollow, { username: "alice", follow: false });
      vi.advanceTimersByTime(HOUR);
    }
    // A different work, and a different person, each count on their own.
    await bob.as.mutation(api.social.setHeart, { workId: otherWorkId, heart: true });
    await cara.as.mutation(api.social.setHeart, { workId, heart: true });

    let list = await alice.as.query(api.notifications.list, { paginationOpts: page(10) });
    expect(list.page.map((item) => `${item.kind}:${item.actor.username}`)).toEqual([
      "heart:cara",
      "heart:bob",
      "follow:bob",
      "heart:bob",
    ]);
    expect((await alice.as.query(api.notifications.status, {})).unread).toBe(4);

    // A day after the first, the same heart notifies again.
    vi.advanceTimersByTime(24 * HOUR);
    await bob.as.mutation(api.social.setHeart, { workId, heart: true });
    list = await alice.as.query(api.notifications.list, { paginationOpts: page(10) });
    expect(list.page).toHaveLength(5);
    expect((await alice.as.query(api.notifications.status, {})).unread).toBe(5);
  });

  it("count unread until the list is opened, and only count what comes after", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const cara = await addMember(t, "cara");
    const workId = await addWork(t, alice.userId);

    await bob.as.mutation(api.social.setFollow, { username: "alice", follow: true });
    await bob.as.mutation(api.social.setHeart, { workId, heart: true });
    expect((await alice.as.query(api.notifications.status, {})).unread).toBe(2);

    vi.advanceTimersByTime(1000);
    await alice.as.mutation(api.notifications.markAllRead, {});
    const read = await alice.as.query(api.notifications.status, {});
    expect(read).toEqual({ unread: 0, lastReadAt: Date.now() });
    // Opening it again changes nothing.
    await alice.as.mutation(api.notifications.markAllRead, {});
    expect(await alice.as.query(api.notifications.status, {})).toEqual(read);

    vi.advanceTimersByTime(1000);
    await cara.as.mutation(api.social.setFollow, { username: "alice", follow: true });
    expect((await alice.as.query(api.notifications.status, {})).unread).toBe(1);
    const list = await alice.as.query(api.notifications.list, { paginationOpts: page(10) });
    expect(list.page.filter((item) => item.createdAt > read.lastReadAt).map((item) => item.actor.username)).toEqual([
      "cara",
    ]);
  });

  it("page newest first with no gaps", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const names: Array<string> = [];
    for (let i = 0; i < 7; i++) {
      const name = `fan${i}`;
      const fan = await addMember(t, name);
      await fan.as.mutation(api.social.setFollow, { username: "alice", follow: true });
      names.unshift(name);
      vi.advanceTimersByTime(1000);
    }
    const seen: Array<string | undefined> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: FunctionReturnType<typeof api.notifications.list> = await alice.as.query(
        api.notifications.list,
        { paginationOpts: page(3, cursor) },
      );
      seen.push(...result.page.map((item) => item.actor.username));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(names);
  });

  it("are empty signed out, and marking read signed out does nothing", async () => {
    const t = newTest();
    expect(await t.query(api.notifications.status, {})).toEqual({ unread: 0, lastReadAt: 0 });
    expect(await t.query(api.notifications.list, { paginationOpts: page(10) })).toMatchObject({
      page: [],
      isDone: true,
    });
    expect(await t.mutation(api.notifications.markAllRead, {})).toBeNull();
  });

  it("leave a hook for Backs that notifies the work's creator every time", async () => {
    const t = newTest();
    const alice = await addMember(t, "alice");
    const bob = await addMember(t, "bob");
    const workId = await addWork(t, alice.userId);
    await t.run((ctx) => notifyBacked(ctx, { workId, backerId: bob.userId }));
    await t.run((ctx) => notifyBacked(ctx, { workId, backerId: bob.userId }));
    expect(await t.run((ctx) => notifyBacked(ctx, { workId, backerId: alice.userId }))).toBeNull();

    const list = await alice.as.query(api.notifications.list, { paginationOpts: page(10) });
    expect(list.page.map((item) => item.kind)).toEqual(["back", "back"]);
    expect((await alice.as.query(api.notifications.status, {})).unread).toBe(2);
  });
});
