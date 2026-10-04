import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// Compare's designs (a few of a session's designs, by id, in the order asked) and a batch made with
// "Use as image" naming the design it started from.

type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_URL", "https://img.test");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
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

// A batch of four designs keyed "<label>/<index>.png" (the last one can still be in flight), made
// from the given image keys.
async function addBatch(
  t: T,
  sessionId: Id<"creativeSessions">,
  ownerId: Id<"users">,
  label: string,
  opts: { color?: string; lastQueued?: boolean; imageKeys?: Array<string> } = {},
) {
  return await t.run(async (ctx) => {
    const images = [];
    for (const key of opts.imageKeys ?? []) {
      const imageId = await ctx.db.insert("userImages", { ownerId, key, analysis: "ready", usedAt: Date.now() });
      images.push({ imageId, key });
    }
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: label,
      presets: [],
      images: opts.imageKeys ? images : undefined,
      backgroundColor: opts.color ?? "#ffffff",
      operation: opts.imageKeys ? "edit" : "create",
      model: "test-model",
      count: 4,
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

const page = { paginationOpts: { numItems: 10, cursor: null } };

describe("compareDesigns", () => {
  it("returns the session's designs in the order asked, with their colors", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const one = await addBatch(t, sessionId, alice.userId, "one", { color: "#ff0000" });
    const two = await addBatch(t, sessionId, alice.userId, "two", { color: "#00ff00" });

    const tiles = await alice.as.query(api.studio.compareDesigns, {
      sessionId,
      generationIds: [two.ids[1], one.ids[0], two.ids[3]],
    });
    expect(tiles.map((tile) => tile.generationId)).toEqual([two.ids[1], one.ids[0], two.ids[3]]);
    expect(tiles.map((tile) => tile.backgroundColor)).toEqual(["#00ff00", "#ff0000", "#00ff00"]);
    expect(tiles[0].url).toBe("https://img.test/two/1.png");
  });

  it("leaves out repeats, unfinished designs, bad ids, and other sessions, and stops at four", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const otherSession = await addSession(t, alice.userId);
    const one = await addBatch(t, sessionId, alice.userId, "one", { lastQueued: true });
    const two = await addBatch(t, sessionId, alice.userId, "two");
    const elsewhere = await addBatch(t, otherSession, alice.userId, "elsewhere");

    const tiles = await alice.as.query(api.studio.compareDesigns, {
      sessionId,
      generationIds: [one.ids[0], one.ids[0], one.ids[3], "nonsense", elsewhere.ids[0], one.ids[1], two.ids[0], two.ids[1], two.ids[2]],
    });
    expect(tiles.map((tile) => tile.generationId)).toEqual([one.ids[0], one.ids[1], two.ids[0], two.ids[1]]);
  });

  it("keeps dismissed designs (they were picked on purpose)", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    const one = await addBatch(t, sessionId, alice.userId, "one");
    await alice.as.mutation(api.studio.setRejected, { generationId: one.ids[1], rejected: true });

    const tiles = await alice.as.query(api.studio.compareDesigns, { sessionId, generationIds: [one.ids[0], one.ids[1]] });
    expect(tiles.map((tile) => [tile.generationId, tile.rejected])).toEqual([
      [one.ids[0], false],
      [one.ids[1], true],
    ]);
  });

  it("shows nothing of another member's session, or to someone signed out", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const sessionId = await addSession(t, alice.userId);
    const one = await addBatch(t, sessionId, alice.userId, "one");

    expect(await bob.as.query(api.studio.compareDesigns, { sessionId, generationIds: one.ids })).toEqual([]);
    expect(await t.query(api.studio.compareDesigns, { sessionId, generationIds: one.ids })).toEqual([]);
  });
});

describe("a batch's parent design", () => {
  it("names the design a batch was made from, in this session or another", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const first = await addSession(t, alice.userId);
    const second = await addSession(t, alice.userId);
    const start = await addBatch(t, first, alice.userId, "start", { color: "#123456" });
    const here = await addBatch(t, first, alice.userId, "here", { imageKeys: ["start/2.png", "upload/cat.png"] });
    await addBatch(t, second, alice.userId, "there", { imageKeys: ["start/1.png"] });

    const firstBatches = await alice.as.query(api.studio.sessionBatches, { sessionId: first, ...page });
    const branched = firstBatches.page.find((batch) => batch.batchId === here.batchId);
    expect(branched?.images).toEqual([
      {
        url: "https://img.test/start/2.png",
        thumbUrl: "https://img.test/start/2.png",
        design: { generationId: start.ids[2], sessionId: first, backgroundColor: "#123456" },
      },
      { url: "https://img.test/upload/cat.png", thumbUrl: "https://img.test/upload/cat.png", design: undefined },
    ]);

    const secondBatches = await alice.as.query(api.studio.sessionBatches, { sessionId: second, ...page });
    expect(secondBatches.page[0].images[0].design).toEqual({
      generationId: start.ids[1],
      sessionId: first,
      backgroundColor: "#123456",
    });

    const linked = await alice.as.query(api.studio.designBatch, { sessionId: first, generationId: here.ids[0] });
    expect(linked?.images[0].design?.generationId).toBe(start.ids[2]);
  });

  it("never links to another member's design with the same key", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const bobSession = await addSession(t, bob.userId);
    await addBatch(t, bobSession, bob.userId, "shared");
    const aliceSession = await addSession(t, alice.userId);
    await addBatch(t, aliceSession, alice.userId, "mine", { imageKeys: ["shared/0.png"] });

    const batches = await alice.as.query(api.studio.sessionBatches, { sessionId: aliceSession, ...page });
    expect(batches.page[0].images[0].design).toBeUndefined();
  });

  it("has no parent for uploads or a design that never finished", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const sessionId = await addSession(t, alice.userId);
    await addBatch(t, sessionId, alice.userId, "start", { lastQueued: true });
    await t.run(async (ctx) => {
      const failed = (await ctx.db.query("generations").collect()).find((g) => g.fullKey === "start/0.png");
      if (failed) await ctx.db.patch("generations", failed._id, { status: "failed" });
    });
    await addBatch(t, sessionId, alice.userId, "next", { imageKeys: ["start/0.png", "upload/dog.png"] });

    const batches = await alice.as.query(api.studio.sessionBatches, { sessionId, ...page });
    expect(batches.page[0].images.map((image) => image.design)).toEqual([undefined, undefined]);
  });
});
