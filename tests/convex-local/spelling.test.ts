import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// The studio's spelling check (convex/spelling.ts): a batch that asked for words has its designs'
// lettering read back, and the studio shows the words a design drew a letter or two off.

vi.setConfig({ testTimeout: 30_000 });

type T = ReturnType<typeof newTest>;

const design = { fullKey: "users/x/design.png", width: 1024, height: 1024, hasAlpha: true };
let savedProvider: string | undefined;

beforeEach(() => {
  savedProvider = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "gateway";
  // The scheduled reading ("use node") never runs here; the test saves its result itself.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  if (savedProvider === undefined) delete process.env.IMAGE_PROVIDER;
  else process.env.IMAGE_PROVIDER = savedProvider;
});

async function member(t: T) {
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { authId: "test|maker", email: "maker@example.com", username: "maker", usernameLower: "maker" });
    await ctx.db.insert("creditLedger", { userId: id, kind: "grant", amount: 20, reason: "admin" });
    await ctx.db.insert("appSettings", {
      key: "main",
      signupGrant: { enabled: true, credits: 24 },
      dailyBudgetCents: 10_000,
      shootsPerMemberPerDay: 3,
      updatedAt: 0,
    });
  });
  return t.withIdentity({ subject: "test|maker", issuer: "test" });
}

async function finishedBatch(t: T, as: ReturnType<T["withIdentity"]>, instruction: string) {
  const result = await as.mutation(api.studio.generate, { instruction, backgroundColor: "#ffffff", newSession: true });
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  const batchId: Id<"batches"> = result.batchId;
  await t.mutation(internal.studio.markBatchDispatched, { batchId });
  await t.mutation(internal.studio.finishBatch, { batchId, results: [0, 1, 2, 3].map((index) => ({ index, design })) });
  return batchId;
}

async function readings(t: T) {
  return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("spellingCheck"));
}

describe("the studio's spelling check", () => {
  it("reads a batch's designs when it asked for words, and shows the ones drawn a letter or two off", async () => {
    const t = newTest();
    const as = await member(t);
    const batchId = await finishedBatch(t, as, "a raccoon in a crown that says TRASH ROYALTY");
    const generations = await t.run((ctx) => ctx.db.query("generations").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect());
    const [job] = await readings(t);
    expect((job.args[0] as { generationIds: Array<string> }).generationIds.sort()).toEqual(generations.map((g) => g._id).sort());
    const jobs = await t.query(internal.spelling.jobs, { generationIds: generations.map((g) => g._id) });
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ key: design.fullKey, words: ["TRASH ROYALTY"] });

    // One came back misspelled, one read fine, one couldn't be read.
    const [bad, good, unread] = generations;
    await t.mutation(internal.spelling.save, { generationId: bad._id, misses: [{ asked: "TRASH", read: "TRROSH" }], read: ["TRROSH ROYALTY"] });
    await t.mutation(internal.spelling.save, { generationId: good._id, misses: [], read: ["TRASH ROYALTY"] });
    await t.mutation(internal.spelling.save, { generationId: unread._id, error: "timeout" });
    const session = await t.run(async (ctx) => (await ctx.db.get("batches", batchId))!.sessionId);
    const page = await as.query(api.studio.sessionBatches, { sessionId: session, paginationOpts: { numItems: 5, cursor: null } });
    const tiles = new Map(page.page[0].tiles.map((tile) => [tile.generationId, tile]));
    expect(tiles.get(bad._id)?.spelling).toEqual([{ asked: "TRASH", read: "TRROSH" }]);
    expect(tiles.get(good._id)?.spelling).toBeUndefined();
    expect(tiles.get(unread._id)?.spelling).toBeUndefined();
    // A design is read once.
    expect(await t.query(internal.spelling.jobs, { generationIds: [bad._id, good._id, unread._id] })).toEqual([]);
  });

  it("shows on the batch line what each style of the mix did", async () => {
    const t = newTest();
    const as = await member(t);
    const owner = await t.run(async (ctx) => (await ctx.db.query("users").first())!._id);
    const [lead, small] = await t.run(async (ctx) =>
      Promise.all(
        ["users/x/style-a.png", "users/x/style-b.png"].map((key) =>
          ctx.db.insert("userImages", { ownerId: owner, key, analysis: "ready" as const, notes: "Technique: ink.", usedAt: 0 }),
        ),
      ),
    );
    const result = await as.mutation(api.studio.generate, {
      instruction: "A raccoon",
      backgroundColor: "#ffffff",
      newSession: true,
      styles: [
        { imageId: lead, weight: 100 },
        { imageId: small, weight: 40 },
      ],
    });
    if ("refused" in result) throw new Error(result.refused);
    await t.mutation(internal.studio.markBatchDispatched, { batchId: result.batchId });
    await t.mutation(internal.studio.finishBatch, {
      batchId: result.batchId,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      styleJobs: [
        { key: "users/x/style-a.png", job: "lead" },
        { key: "users/x/style-b.png", job: "lettering" },
      ],
    });
    const page = await as.query(api.studio.sessionBatches, { sessionId: result.sessionId, paginationOpts: { numItems: 5, cursor: null } });
    expect(page.page[0].styles.map((style) => [style.share, style.job])).toEqual([
      [71, "lead"],
      [29, "lettering"],
    ]);
  });

  it("doesn't read a batch that asked for no words", async () => {
    const t = newTest();
    const as = await member(t);
    await finishedBatch(t, as, "a fox in a hat");
    expect(await readings(t)).toEqual([]);
  });
});
