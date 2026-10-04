import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { cappedPage } from "../../convex/lib/paging";
import { BATCH_COUNT_CAP } from "../../convex/lib/studioRules";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// The studio's paged lists: sessions, a session's batches, and the style picker's images. Each is
// newest first, pages through cursors without repeats, and never holds another member's rows.

type T = ReturnType<typeof newTest>;
const BASE = "https://img.test";

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_URL", BASE);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function member(t: T, name: string) {
  const authId = `test|${name}`;
  const userId = await t.run((ctx) => ctx.db.insert("users", { authId, name }));
  return { userId, as: t.withIdentity({ subject: authId, issuer: "test" }) };
}

async function addSession(t: T, ownerId: Id<"users">, updatedAt: number, title?: string) {
  return await t.run((ctx) =>
    ctx.db.insert("creativeSessions", {
      ownerId,
      updatedAt,
      phrase: "",
      styleDirection: "",
      presets: [],
      purpose: "studio",
      title,
    }),
  );
}

// A grid batch with four finished designs, keyed "<label>/<index>.png".
async function addBatch(t: T, sessionId: Id<"creativeSessions">, ownerId: Id<"users">, label: string) {
  return await t.run(async (ctx) => {
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: label,
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "test-model",
      count: 4,
      layout: "grid",
    });
    for (let index = 0; index < 4; index++) {
      await ctx.db.insert("generations", {
        sessionId,
        batchId,
        ownerId,
        index,
        kind: "concept",
        status: "succeeded",
        provider: "test",
        model: "test-model",
        charged: false,
        favorite: false,
        fullKey: `${label}/${index}.png`,
      });
    }
    return batchId;
  });
}

const page = (numItems: number, cursor: string | null = null) => ({ paginationOpts: { numItems, cursor } });

describe("cappedPage", () => {
  it("keeps the page size between 1 and the server's cap", () => {
    expect(cappedPage({ numItems: 500, cursor: null }, 24).numItems).toBe(24);
    expect(cappedPage({ numItems: 0, cursor: null }, 24).numItems).toBe(1);
    expect(cappedPage({ numItems: -3, cursor: null }, 24).numItems).toBe(1);
    expect(cappedPage({ numItems: 2.7, cursor: "abc" }, 24)).toEqual({ numItems: 2, cursor: "abc" });
    expect(cappedPage({ numItems: Number.POSITIVE_INFINITY, cursor: null }, 24).numItems).toBe(24);
  });
});

describe("studio.sessions", () => {
  it("pages the member's sessions, most recently used first, without another member's", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const names: Array<string> = [];
    for (let i = 0; i < 5; i++) {
      const sessionId = await addSession(t, alice.userId, 1000 + i, `Alice ${i}`);
      await addBatch(t, sessionId, alice.userId, `alice-${i}`);
      names.unshift(`Alice ${i}`);
    }
    // Bob's sessions sit between Alice's in time; none of them may show up for her.
    for (let i = 0; i < 3; i++) {
      const sessionId = await addSession(t, bob.userId, 1000 + i + 0.5, `Bob ${i}`);
      await addBatch(t, sessionId, bob.userId, `bob-${i}`);
    }

    const seen: Array<string> = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const result: { page: Array<{ name: string; updatedAt: number }>; isDone: boolean; continueCursor: string } =
        await alice.as.query(api.studio.sessions, page(2, cursor));
      seen.push(...result.page.map((card) => card.name));
      pages++;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(names);
    expect(pages).toBe(3);

    const bobs = await bob.as.query(api.studio.sessions, page(10));
    expect(bobs.page.map((card) => card.name)).toEqual(["Bob 2", "Bob 1", "Bob 0"]);
  });

  it("shows each card's batch count and newest designs, and skips sessions with no batches", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const full = await addSession(t, alice.userId, 2000, "Full");
    await addBatch(t, full, alice.userId, "old");
    await addBatch(t, full, alice.userId, "new");
    await addSession(t, alice.userId, 3000, "Empty");

    const result = await alice.as.query(api.studio.sessions, page(10));
    expect(result.isDone).toBe(true);
    expect(result.page).toHaveLength(1);
    const [card] = result.page;
    expect(card.name).toBe("Full");
    expect(card.batches).toBe(2);
    expect(card.thumbs.map((thumb) => thumb.url)).toEqual([0, 1, 2, 3].map((i) => `${BASE}/new/${i}.png`));
  });

  it("is empty when signed out", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId, 1000);
    await addBatch(t, sessionId, alice.userId, "a");
    expect(await t.query(api.studio.sessions, page(10))).toMatchObject({ page: [], isDone: true });
  });
});

describe("studio.sessionBatches", () => {
  it("pages a session's batches newest first, with every design's urls", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId, 1000, "Mine");
    const labels: Array<string> = [];
    for (let i = 0; i < 5; i++) {
      await addBatch(t, sessionId, alice.userId, `batch-${i}`);
      labels.unshift(`batch-${i}`);
    }
    // The newest design's copies are ready; the others fall back to the original.
    await t.run((ctx) =>
      ctx.db.insert("imageSizes", {
        key: "batch-4/0.png",
        sha256: "x",
        width: 1024,
        height: 1024,
        thumbKey: "batch-4/0-thumb.webp",
        mediumKey: "batch-4/0-medium.webp",
      }),
    );

    const first = await alice.as.query(api.studio.sessionBatches, { sessionId, ...page(2) });
    expect(first.page.map((batch) => batch.instruction)).toEqual(labels.slice(0, 2));
    expect(first.isDone).toBe(false);
    const tile = first.page[0].tiles[0];
    expect(tile).toMatchObject({
      url: `${BASE}/batch-4/0.png`,
      thumbUrl: `${BASE}/batch-4/0-thumb.webp`,
      mediumUrl: `${BASE}/batch-4/0-medium.webp`,
    });
    expect(first.page[0].tiles[1]).toMatchObject({
      url: `${BASE}/batch-4/1.png`,
      thumbUrl: `${BASE}/batch-4/1.png`,
      mediumUrl: `${BASE}/batch-4/1.png`,
    });
    expect(first.page[0].tiles.map((design) => design.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);

    const second = await alice.as.query(api.studio.sessionBatches, {
      sessionId,
      ...page(2, first.continueCursor),
    });
    expect(second.page.map((batch) => batch.instruction)).toEqual(labels.slice(2, 4));
    const third = await alice.as.query(api.studio.sessionBatches, {
      sessionId,
      ...page(2, second.continueCursor),
    });
    expect(third.page.map((batch) => batch.instruction)).toEqual(labels.slice(4));
    expect(third.isDone).toBe(true);
  });

  it("marks a published design with its CR number", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId, 1000);
    const batchId = await addBatch(t, sessionId, alice.userId, "pub");
    await t.run(async (ctx) => {
      const generation = await ctx.db
        .query("generations")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .first();
      await ctx.db.insert("works", {
        crFamily: 101,
        crExpression: 0,
        creatorId: alice.userId,
        kind: "original",
        generationId: generation!._id,
        requestId: "req-1",
        backgroundColor: "#ffffff",
        status: "published",
      });
    });
    const result = await alice.as.query(api.studio.sessionBatches, { sessionId, ...page(6) });
    const crs = result.page[0].tiles.map((tile) => tile.publishedCr);
    expect(crs.filter(Boolean)).toHaveLength(1);
    expect(crs[0]).toBe("101-000");
  });

  it("is empty for someone else's session, a bad id, or a signed-out visitor", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const sessionId = await addSession(t, alice.userId, 1000);
    await addBatch(t, sessionId, alice.userId, "private");

    for (const result of [
      await bob.as.query(api.studio.sessionBatches, { sessionId, ...page(6) }),
      await t.query(api.studio.sessionBatches, { sessionId, ...page(6) }),
      await alice.as.query(api.studio.sessionBatches, { sessionId: "not-an-id", ...page(6) }),
    ]) {
      expect(result).toMatchObject({ page: [], isDone: true });
    }
    expect(await bob.as.query(api.studio.session, { sessionId })).toBeNull();
  });

  it("caps the page size the browser asks for", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId, 1000);
    for (let i = 0; i < 14; i++) await addBatch(t, sessionId, alice.userId, `b${i}`);
    const result = await alice.as.query(api.studio.sessionBatches, { sessionId, ...page(1000) });
    expect(result.page).toHaveLength(12);
    expect(result.isDone).toBe(false);
  });
});

describe("studio.session", () => {
  it("counts batches up to the cap and keeps the newest batch's settings", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId, 1000);
    await t.run(async (ctx) => {
      for (let i = 0; i <= BATCH_COUNT_CAP; i++) {
        await ctx.db.insert("batches", {
          sessionId,
          ownerId: alice.userId,
          instruction: `request ${i}`,
          presets: [],
          backgroundColor: "#000000",
          operation: "create",
          model: "test-model",
          count: 4,
          layout: "grid",
        });
      }
    });
    const view = await alice.as.query(api.studio.session, { sessionId });
    expect(view?.batchCount).toBe(BATCH_COUNT_CAP);
    expect(view?.lastInputs?.instruction).toBe(`request ${BATCH_COUNT_CAP}`);
    expect(view?.name).toBe("request 0");
  });
});

describe("images.styleImages and images.recentImages", () => {
  async function addImage(t: T, ownerId: Id<"users">, key: string, usedAt: number, styleAt?: number) {
    return await t.run((ctx) =>
      ctx.db.insert("userImages", { ownerId, key, analysis: "ready", usedAt, styleAt }),
    );
  }

  async function all<TItem>(fetch: (cursor: string | null) => Promise<{ page: Array<TItem>; isDone: boolean; continueCursor: string }>) {
    const items: Array<TItem> = [];
    let cursor: string | null = null;
    for (;;) {
      const result = await fetch(cursor);
      items.push(...result.page);
      if (result.isDone) return items;
      cursor = result.continueCursor;
    }
  }

  it("pages style images and other images apart, newest first, only the member's own", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    // Alice: six images, two of them in a style mix (added to the mix in the opposite order).
    for (let i = 0; i < 6; i++) {
      await addImage(t, alice.userId, `alice/${i}.png`, 100 + i, i === 1 ? 900 : i === 4 ? 800 : undefined);
    }
    await addImage(t, bob.userId, "bob/0.png", 150);
    await addImage(t, bob.userId, "bob/1.png", 160, 950);

    const styles = await all((cursor) => alice.as.query(api.images.styleImages, page(1, cursor)));
    expect(styles.map((image) => image.key)).toEqual(["alice/1.png", "alice/4.png"]);
    expect(styles[0].url).toBe(`${BASE}/alice/1.png`);
    expect(styles[0].thumbUrl).toBe(`${BASE}/alice/1.png`);

    const recent = await all((cursor) => alice.as.query(api.images.recentImages, page(2, cursor)));
    expect(recent.map((image) => image.key)).toEqual(["alice/5.png", "alice/3.png", "alice/2.png", "alice/0.png"]);

    const bobs = await all((cursor) => bob.as.query(api.images.recentImages, page(5, cursor)));
    expect(bobs.map((image) => image.key)).toEqual(["bob/0.png"]);
  });

  it("is empty when signed out", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    await addImage(t, alice.userId, "alice/0.png", 100, 200);
    expect(await t.query(api.images.styleImages, page(5))).toMatchObject({ page: [], isDone: true });
    expect(await t.query(api.images.recentImages, page(5))).toMatchObject({ page: [], isDone: true });
  });
});
