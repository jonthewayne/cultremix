import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// The viewer's data: a session's favorites in the order they were favorited, dismissing designs
// without deleting them, the batch behind a shared viewer link, and nobody else touching any of it.

type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_URL", "https://img.test");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function member(t: T, name: string) {
  const authId = `test|${name}`;
  const userId = await t.run((ctx) => ctx.db.insert("users", { authId, name, username: name }));
  return { userId, as: t.withIdentity({ subject: authId, issuer: "test" }) };
}

async function addSession(t: T, ownerId: Id<"users">) {
  return await t.run((ctx) =>
    ctx.db.insert("creativeSessions", { ownerId, updatedAt: Date.now(), phrase: "", styleDirection: "", presets: [] }),
  );
}

// A grid batch with four designs keyed "<label>/<index>.png"; the last one can still be in flight.
async function addBatch(
  t: T,
  sessionId: Id<"creativeSessions">,
  ownerId: Id<"users">,
  label: string,
  opts: { color?: string; lastQueued?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: label,
      presets: [],
      backgroundColor: opts.color ?? "#ffffff",
      operation: "create",
      model: "test-model",
      count: 4,
      layout: "grid",
    });
    const ids: Array<Id<"generations">> = [];
    for (let index = 0; index < 4; index++) {
      const queued = opts.lastQueued && index === 3;
      ids.push(
        await ctx.db.insert("generations", {
          sessionId,
          batchId,
          ownerId,
          index,
          kind: "concept",
          status: queued ? "queued" : "succeeded",
          provider: "test",
          model: "test-model",
          charged: false,
          favorite: false,
          fullKey: queued ? undefined : `${label}/${index}.png`,
        }),
      );
    }
    return { batchId, ids };
  });
}

const page = (numItems: number, cursor: string | null = null) => ({ paginationOpts: { numItems, cursor } });

async function favoriteIds(as: ReturnType<T["withIdentity"]>, sessionId: string) {
  const result = await as.query(api.studio.sessionFavorites, { sessionId, ...page(100) });
  return result.page.map((tile) => tile.generationId);
}

// Each favorite a minute after the last, so favoritedAt orders them.
async function heart(as: ReturnType<T["withIdentity"]>, generationId: Id<"generations">, favorite?: boolean) {
  vi.advanceTimersByTime(60_000);
  return await as.mutation(api.studio.toggleFavorite, { generationId, favorite });
}

describe("favorites tray", () => {
  it("lists favorites in the order they were favorited, across batches", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const first = await addBatch(t, sessionId, alice.userId, "first", { color: "#112233" });
    const second = await addBatch(t, sessionId, alice.userId, "second", { color: "#445566" });

    await heart(alice.as, second.ids[2]);
    await heart(alice.as, first.ids[0]);
    await heart(alice.as, second.ids[0]);

    const result = await alice.as.query(api.studio.sessionFavorites, { sessionId, ...page(10) });
    expect(result.page.map((tile) => tile.generationId)).toEqual([second.ids[2], first.ids[0], second.ids[0]]);
    // Each favorite carries its own batch's shirt color and its picture sizes.
    expect(result.page.map((tile) => tile.backgroundColor)).toEqual(["#445566", "#112233", "#445566"]);
    expect(result.page[1]).toMatchObject({ favorite: true, rejected: false, url: "https://img.test/first/0.png" });
  });

  it("keeps a favorite's place when it is favorited again, and moves it to the end after a fresh heart", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await heart(alice.as, ids[0]);
    await heart(alice.as, ids[1]);
    await heart(alice.as, ids[2]);

    // Setting favorite: true on a favorite (a double tap) changes nothing.
    expect(await heart(alice.as, ids[0], true)).toEqual({ favorite: true });
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[0], ids[1], ids[2]]);

    // Unfavoriting takes it out; favoriting again puts it last.
    expect(await heart(alice.as, ids[0])).toEqual({ favorite: false });
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[1], ids[2]]);
    await heart(alice.as, ids[0]);
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[1], ids[2], ids[0]]);

    // Setting favorite: false twice leaves it off.
    await heart(alice.as, ids[1], false);
    await heart(alice.as, ids[1], false);
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[2], ids[0]]);
  });

  it("pages through favorites without repeats", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const all: Array<Id<"generations">> = [];
    for (const label of ["a", "b", "c"]) {
      const { ids } = await addBatch(t, sessionId, alice.userId, label);
      for (const id of ids) {
        await heart(alice.as, id);
        all.push(id);
      }
    }
    const seen: Array<string> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: { page: Array<{ generationId: string }>; isDone: boolean; continueCursor: string } =
        await alice.as.query(api.studio.sessionFavorites, { sessionId, ...page(5, cursor) });
      seen.push(...result.page.map((tile) => tile.generationId));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(all);
  });

  it("can't heart a design that is still being made", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b", { lastQueued: true });
    await expect(alice.as.mutation(api.studio.toggleFavorite, { generationId: ids[3] })).rejects.toThrow(/not ready/i);
  });
});

describe("dismissing designs", () => {
  it("hides nothing on the server and deletes nothing: the batch still lists it, marked dismissed", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await alice.as.mutation(api.studio.setRejected, { generationId: ids[1], rejected: true });

    const batches = await alice.as.query(api.studio.sessionBatches, { sessionId, ...page(5) });
    const tiles = batches.page[0].tiles;
    expect(tiles).toHaveLength(4);
    expect(tiles.map((tile) => tile.rejected)).toEqual([false, true, false, false]);
    expect(await t.run((ctx) => ctx.db.get("generations", ids[1]))).toMatchObject({ rejected: true, fullKey: "b/1.png" });
  });

  it("takes a dismissed design out of the favorites, and bringing it back doesn't heart it again", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await heart(alice.as, ids[0]);
    await heart(alice.as, ids[1]);

    await alice.as.mutation(api.studio.setRejected, { generationId: ids[0], rejected: true });
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[1]]);

    await alice.as.mutation(api.studio.setRejected, { generationId: ids[0], rejected: false });
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[1]]);
    const row = await t.run((ctx) => ctx.db.get("generations", ids[0]));
    expect(row?.rejected).toBeUndefined();
    expect(row?.favorite).toBe(false);
  });

  it("brings a dismissed design back when it is hearted", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await alice.as.mutation(api.studio.setRejected, { generationId: ids[2], rejected: true });
    await heart(alice.as, ids[2], true);
    const row = await t.run((ctx) => ctx.db.get("generations", ids[2]));
    expect(row).toMatchObject({ favorite: true });
    expect(row?.rejected).toBeUndefined();
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[2]]);
  });

  it("can dismiss a design that didn't work, but not one still being made", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b", { lastQueued: true });
    await expect(alice.as.mutation(api.studio.setRejected, { generationId: ids[3], rejected: true })).rejects.toThrow(
      /still being made/i,
    );
    await t.run((ctx) => ctx.db.patch("generations", ids[3], { status: "failed", error: "No design came back." }));
    await alice.as.mutation(api.studio.setRejected, { generationId: ids[3], rejected: true });
    expect((await t.run((ctx) => ctx.db.get("generations", ids[3])))?.rejected).toBe(true);
  });

  it("leaves dismissed designs off the session's card", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await alice.as.mutation(api.studio.setRejected, { generationId: ids[0], rejected: true });
    const cards = await alice.as.query(api.studio.sessions, page(5));
    expect(cards.page[0].thumbs.map((thumb) => thumb.url)).toEqual([1, 2, 3].map((i) => `https://img.test/b/${i}.png`));
  });
});

describe("a shared viewer link", () => {
  it("finds the batch behind a design in the session", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const old = await addBatch(t, sessionId, alice.userId, "old", { color: "#abcdef" });
    await addBatch(t, sessionId, alice.userId, "new");
    const batch = await alice.as.query(api.studio.designBatch, { sessionId, generationId: old.ids[2] });
    expect(batch?.batchId).toBe(old.batchId);
    expect(batch?.backgroundColor).toBe("#abcdef");
    expect(batch?.tiles.map((tile) => tile.generationId)).toEqual(old.ids);
  });

  it("returns null for a design from another session or an id that isn't one", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const here = await addSession(t, alice.userId);
    const there = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, there, alice.userId, "there");
    expect(await alice.as.query(api.studio.designBatch, { sessionId: here, generationId: ids[0] })).toBeNull();
    expect(await alice.as.query(api.studio.designBatch, { sessionId: here, generationId: "not-an-id" })).toBeNull();
  });
});

describe("other members", () => {
  it("can't heart, unheart, dismiss, or see someone else's designs", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await heart(alice.as, ids[0]);

    await expect(bob.as.mutation(api.studio.toggleFavorite, { generationId: ids[1] })).rejects.toThrow(/not found/i);
    await expect(bob.as.mutation(api.studio.toggleFavorite, { generationId: ids[0], favorite: false })).rejects.toThrow(
      /not found/i,
    );
    await expect(bob.as.mutation(api.studio.setRejected, { generationId: ids[0], rejected: true })).rejects.toThrow(
      /not found/i,
    );
    expect((await bob.as.query(api.studio.sessionFavorites, { sessionId, ...page(10) })).page).toEqual([]);
    expect(await bob.as.query(api.studio.designBatch, { sessionId, generationId: ids[0] })).toBeNull();

    // Nothing changed for alice.
    expect(await favoriteIds(alice.as, sessionId)).toEqual([ids[0]]);
    const rows = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get("generations", id))));
    expect(rows.map((row) => [row?.favorite, row?.rejected])).toEqual([
      [true, undefined],
      [false, undefined],
      [false, undefined],
      [false, undefined],
    ]);
  });

  it("gives signed-out callers nothing and refuses their changes", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const { ids } = await addBatch(t, sessionId, alice.userId, "b");
    await heart(alice.as, ids[0]);
    expect((await t.query(api.studio.sessionFavorites, { sessionId, ...page(10) })).page).toEqual([]);
    expect(await t.query(api.studio.designBatch, { sessionId, generationId: ids[0] })).toBeNull();
    await expect(t.mutation(api.studio.setRejected, { generationId: ids[0], rejected: true })).rejects.toThrow(/sign in/i);
  });
});
