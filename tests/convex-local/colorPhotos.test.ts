import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { photoWorstCaseCents } from "../../convex/lib/pricing";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

// Scheduled actions (the photo edits) never run here: timers stay fake and are never advanced.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const PHOTO_1 = "works/101/001/photos/1/original.png";

// A published work offered in white (the lead, which the photo was shot on) and four more colors.
async function setup(switchOn = true) {
  const t = newTest();
  const ids = await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { authId: "test|alice", username: "alice", usernameLower: "alice" });
    const sessionId = await ctx.db.insert("creativeSessions", { ownerId: alice, updatedAt: 0, phrase: "", styleDirection: "", presets: [] });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: alice,
      instruction: "a red sun",
      presets: [],
      backgroundColor: "#f7f6f2",
      operation: "create",
      model: "test",
      count: 4,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: alice,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "test",
      model: "test",
      charged: true,
      favorite: false,
    });
    const workId = await ctx.db.insert("works", {
      crFamily: 101,
      crExpression: 1,
      creatorId: alice,
      kind: "original",
      generationId,
      requestId: "req",
      title: "Red Sun",
      backgroundColor: "#f7f6f2",
      offeredColors: ["white", "butter", "moss", "true-navy", "crimson"],
      status: "published",
      publishedAt: 0,
      contentHash: "a".repeat(64),
      artKey: "works/101/001/original.png",
    });
    const shootId = await ctx.db.insert("shoots", { workId, status: "done", requestedBy: alice, createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("shootPhotos", { shootId, workId, index: 1, state: "succeeded", publicKey: PHOTO_1 });
    await ctx.db.insert("featureFlags", { key: "photos.colors", enabled: switchOn });
    return { alice, workId, shootId };
  });
  return { t, ...ids };
}

async function rows(t: T, workId: Id<"works">) {
  return await t.run((ctx) =>
    ctx.db
      .query("colorPhotos")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .collect(),
  );
}

async function reservation(t: T, attemptId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("reservations")
      .withIndex("by_attempt", (q) => q.eq("attemptId", attemptId))
      .unique(),
  );
}

describe("photos in every color", () => {
  it("starts up to three, in the colors after the lead, each holding a photo's worst case, and never twice", async () => {
    const { t, alice, workId } = await setup();
    expect(await t.mutation(internal.colorPhotos.start, { workId })).toBe(3);
    const made = await rows(t, workId);
    expect(made.map((row) => row.colorKey)).toEqual(["butter", "moss", "true-navy"]);
    expect(made.every((row) => row.state === "pending" && row.basedOn === PHOTO_1)).toBe(true);
    expect(await reservation(t, `colorPhoto:${made[0]._id}`)).toMatchObject({
      attemptKind: "photo",
      provider: "gateway",
      userId: alice,
      credits: 0,
      worstCaseCents: photoWorstCaseCents("medium"),
      state: "open",
    });
    expect(await t.mutation(internal.colorPhotos.start, { workId })).toBe(0);
    expect(await rows(t, workId)).toHaveLength(3);
  });

  it("waits for the Photos in every color switch", async () => {
    const { t, workId } = await setup(false);
    expect(await t.mutation(internal.colorPhotos.start, { workId })).toBe(0);
    expect(await rows(t, workId)).toHaveLength(0);
  });

  it("shows only the ones made from the photo the page shows, and a reshoot gets its own", async () => {
    const { t, workId } = await setup();
    await t.mutation(internal.colorPhotos.start, { workId });
    const moss = (await rows(t, workId)).find((row) => row.colorKey === "moss")!;
    await t.mutation(internal.colorPhotos.record, {
      colorPhotoId: moss._id,
      publicKey: "works/101/001/photos/1/colors/moss/original.png",
      spend: { kind: "settle", actualCents: 3 },
    });
    expect((await reservation(t, `colorPhoto:${moss._id}`))?.state).toBe("settled");
    const page = await t.query(api.feed.byCr, { cr: "101-001" });
    expect(page?.colorPhotos.map((photo) => photo.colorKey)).toEqual(["moss"]);

    // A reshoot: the page's photo is new, so the old colors stop showing and new ones start.
    await t.run(async (ctx) => {
      const photo = await ctx.db.query("shootPhotos").withIndex("by_work", (q) => q.eq("workId", workId)).unique();
      if (photo) await ctx.db.patch("shootPhotos", photo._id, { publicKey: "works/101/001/photos/2/original.png" });
    });
    expect((await t.query(api.feed.byCr, { cr: "101-001" }))?.colorPhotos).toEqual([]);
    expect(await t.mutation(internal.colorPhotos.start, { workId })).toBe(3);
  });

  it("releases a failed one's hold, and tries that color again next time", async () => {
    const { t, workId } = await setup();
    await t.mutation(internal.colorPhotos.start, { workId });
    const butter = (await rows(t, workId)).find((row) => row.colorKey === "butter")!;
    await t.mutation(internal.colorPhotos.fail, {
      colorPhotoId: butter._id,
      reason: "The image call failed.",
      spend: { kind: "release", reason: "not sent" },
    });
    expect((await reservation(t, `colorPhoto:${butter._id}`))?.state).toBe("released");
    expect((await rows(t, workId)).find((row) => row._id === butter._id)?.state).toBe("failed");
    expect(await t.mutation(internal.colorPhotos.start, { workId })).toBe(1);
  });
});
