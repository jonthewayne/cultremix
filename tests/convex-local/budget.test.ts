import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { formatCr } from "../../convex/lib/r2";
import { gridWorstCaseCents, photoWorstCaseCents, singleWorstCaseCents } from "../../convex/lib/pricing";
import { newTest } from "./setup";
import { addWork } from "./socialFixtures";
import type { Id } from "../../convex/_generated/dataModel";

// The first call into convex/judges.ts loads Better Auth, which can pass the 5 s default on a
// busy machine.
vi.setConfig({ testTimeout: 30_000 });

type Role = "user" | "super_admin_owner";
type T = ReturnType<typeof newTest>;

const GRID = gridWorstCaseCents(0, "high");
const SINGLE = singleWorstCaseCents(0, "medium");
const PHOTO = photoWorstCaseCents("medium");
const MINUTE = 60_000;

// The studio's provider and layout come from the environment; these tests pin them.
const ENV_KEYS = ["IMAGE_PROVIDER", "STUDIO_LAYOUT", "GRID_QUALITY", "IMAGE_QUALITY", "PHOTO_QUALITY", "CHATGPT_ACCESS_TOKEN", "CHATGPT_ACCOUNT_ID"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.IMAGE_PROVIDER = "gateway";
  // Fake timers keep the scheduled image actions ("use node") from running; tests call their
  // mutations directly.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function addUser(t: T, name: string, role: Role = "user", credits = 10) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      authId: `test|${name}`,
      email: `${name}@example.com`,
      username: name,
      usernameLower: name,
      platformRole: role,
    });
    if (credits > 0) await ctx.db.insert("creditLedger", { userId: id, kind: "grant", amount: credits, reason: "admin" });
    return id;
  });
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

async function setBudget(t: T, cents: number) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (row) await ctx.db.patch("appSettings", row._id, { dailyBudgetCents: cents });
    else {
      await ctx.db.insert("appSettings", {
        key: "main",
        signupGrant: { enabled: true, credits: 24 },
        dailyBudgetCents: cents,
        shootsPerMemberPerDay: 3,
        updatedAt: 0,
      });
    }
  });
}

const BATCH = { instruction: "a fox in a hat", backgroundColor: "#ffffff", newSession: true };

async function balance(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.reduce((sum, row) => sum + row.amount, 0);
  });
}

async function day(t: T, dayUtc = "2026-10-04") {
  return await t.run((ctx) =>
    ctx.db
      .query("budgetDays")
      .withIndex("by_provider_day", (q) => q.eq("provider", "gateway").eq("dayUtc", dayUtc))
      .unique(),
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

async function tiles(t: T, batchId: Id<"batches">) {
  return await t.run((ctx) =>
    ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect(),
  );
}

async function generateBatch(as: ReturnType<T["withIdentity"]>): Promise<Id<"batches">> {
  const result = await as.mutation(api.studio.generate, BATCH);
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result.batchId;
}

const design = { fullKey: "users/x/design.png", width: 1024, height: 1024, hasAlpha: true };

describe("admission", () => {
  it("admits only one of two batches racing for the last of the budget, and leaves the other's credits alone", async () => {
    const t = newTest();
    await setBudget(t, GRID + 3);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");

    const results = await Promise.all([
      alice.as.mutation(api.studio.generate, BATCH),
      bob.as.mutation(api.studio.generate, BATCH),
    ]);
    const admitted = results.filter((r) => "batchId" in r);
    const refused = results.filter((r) => "refused" in r);
    expect(admitted).toHaveLength(1);
    expect(refused).toEqual([{ refused: "BUDGET" }]);

    expect((await day(t))?.openCents).toBe(GRID);
    expect(await t.run((ctx) => ctx.db.query("reservations").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("batches").collect())).toHaveLength(1);
    // The refused member paid nothing; the admitted one paid the usual 2.
    const balances = [await balance(t, alice.userId), await balance(t, bob.userId)].sort((a, b) => a - b);
    expect(balances).toEqual([8, 10]);
  });

  it("holds four single designs' worst case as one all-or-nothing check", async () => {
    process.env.STUDIO_LAYOUT = "single";
    const t = newTest();
    await setBudget(t, SINGLE * 4 - 1);
    const alice = await addUser(t, "alice");
    expect(await alice.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "BUDGET" });
    expect(await t.run((ctx) => ctx.db.query("generations").collect())).toHaveLength(0);
    expect(await balance(t, alice.userId)).toBe(10);

    await setBudget(t, SINGLE * 4);
    const batchId = await generateBatch(alice.as);
    const rows = await t.run((ctx) => ctx.db.query("reservations").collect());
    expect(rows.map((r) => r.attemptKind)).toEqual(["tile", "tile", "tile", "tile"]);
    expect(rows.every((r) => r.batchId === undefined && r.generationId !== undefined)).toBe(true);
    expect((await day(t))?.openCents).toBe(SINGLE * 4);
    expect(await balance(t, alice.userId)).toBe(6);
    expect(await tiles(t, batchId)).toHaveLength(4);
  });

  it("counts the owner toward the budget without charging credits", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const owner = await addUser(t, "jon", "super_admin_owner", 0);
    const batchId = await generateBatch(owner.as);
    expect(await balance(t, owner.userId)).toBe(0);
    expect(await reservation(t, batchId)).toMatchObject({ state: "open", credits: 0, worstCaseCents: GRID, userId: owner.userId });
    expect(await owner.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "BUDGET" });
  });

  it("doesn't hold anything for the ChatGPT path", async () => {
    process.env.IMAGE_PROVIDER = "chatgpt";
    const t = newTest();
    await setBudget(t, 0);
    const alice = await addUser(t, "alice");
    await generateBatch(alice.as);
    expect(await t.run((ctx) => ctx.db.query("reservations").collect())).toHaveLength(0);
    expect(await balance(t, alice.userId)).toBe(6);
  });

  it("starts a fresh budget at midnight UTC and keeps a reservation on the day it was admitted", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    vi.setSystemTime(new Date("2026-10-04T23:59:59Z"));
    const late = await generateBatch(alice.as);
    expect(await alice.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "BUDGET" });

    vi.setSystemTime(new Date("2026-10-05T00:00:01Z"));
    const early = await generateBatch(alice.as);
    expect((await reservation(t, late))?.dayUtc).toBe("2026-10-04");
    expect((await reservation(t, early))?.dayUtc).toBe("2026-10-05");

    // Settling yesterday's batch after midnight books it to yesterday, not today.
    await t.mutation(internal.studio.markBatchDispatched, { batchId: late });
    await t.mutation(internal.studio.finishBatch, {
      batchId: late,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      spend: { kind: "settle", actualCents: 10.4 },
    });
    expect(await day(t, "2026-10-04")).toMatchObject({ openCents: 0, settledCents: 10.4 });
    expect(await day(t, "2026-10-05")).toMatchObject({ openCents: GRID, settledCents: 0 });
  });
});

describe("settlement", () => {
  it("records the reported cost and frees the rest of the hold", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    expect(await t.mutation(internal.studio.markBatchDispatched, { batchId })).toBe(true);
    await t.mutation(internal.studio.finishBatch, {
      batchId,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      spend: { kind: "settle", actualCents: 9.9 },
    });
    expect(await reservation(t, batchId)).toMatchObject({ state: "settled", actualCents: 9.9, costSource: "reported" });
    expect(await day(t)).toMatchObject({ openCents: 0, settledCents: 9.9 });
    // GRID - 9.9 is left, not enough for another worst case.
    expect(await alice.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "BUDGET" });
    expect(await balance(t, alice.userId)).toBe(8);
  });

  it("releases a batch that never went out", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    // runBatch's own failure before the call (an input that won't load, say).
    await t.mutation(internal.studio.finishBatch, {
      batchId,
      results: [0, 1, 2, 3].map((index) => ({ index, error: "That image did not load." })),
      spend: { kind: "release", reason: "not sent" },
    });
    expect(await reservation(t, batchId)).toMatchObject({ state: "released", reason: "not sent" });
    expect(await day(t)).toMatchObject({ openCents: 0, settledCents: 0 });
    expect(await balance(t, alice.userId)).toBe(10);
    // The whole budget is back.
    await generateBatch(alice.as);
  });

  it("releases when generation was paused before dispatch, and won't dispatch a released batch", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    const owner = await addUser(t, "jon", "super_admin_owner", 0);
    const batchId = await generateBatch(alice.as);
    await owner.as.mutation(api.admin.setFlag, { key: "gen.vercel", enabled: false });
    expect(await t.mutation(internal.studio.markBatchDispatched, { batchId })).toBe(false);
    expect(await reservation(t, batchId)).toMatchObject({ state: "released", reason: "paused" });
    expect(await balance(t, alice.userId)).toBe(10);

    // A batch whose hold the sweeper already released isn't sent.
    await owner.as.mutation(api.admin.setFlag, { key: "gen.vercel", enabled: true });
    const second = await generateBatch(alice.as);
    await t.mutation(internal.budget.closeAttempt, { attemptId: second, spend: { kind: "release" } });
    expect(await t.mutation(internal.studio.markBatchDispatched, { batchId: second })).toBe(false);
  });

  it("settles at the worst case when the outcome is unknown, and refunds as a failure", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    await t.mutation(internal.studio.markBatchDispatched, { batchId });
    await t.mutation(internal.studio.finishBatch, {
      batchId,
      results: [0, 1, 2, 3].map((index) => ({ index, error: "The call timed out." })),
      spend: { kind: "settle", reason: "timed out" },
      unknown: true,
    });
    expect(await reservation(t, batchId)).toMatchObject({
      state: "settled",
      actualCents: GRID,
      costSource: "worst_case",
      reason: "timed out",
    });
    expect(await day(t)).toMatchObject({ openCents: 0, settledCents: GRID });
    expect((await tiles(t, batchId)).map((g) => g.status)).toEqual(Array(4).fill("unknown_outcome"));
    expect(await balance(t, alice.userId)).toBe(10);
  });

  it("settles a single design on success and on an unknown failure", async () => {
    process.env.STUDIO_LAYOUT = "single";
    const t = newTest();
    await setBudget(t, SINGLE * 4);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    const [first, second] = await tiles(t, batchId);
    await t.mutation(internal.studio.markDispatched, { generationId: first._id });
    await t.mutation(internal.studio.markSucceeded, {
      generationId: first._id,
      ...design,
      spend: { kind: "settle", actualCents: 1.07 },
    });
    await t.mutation(internal.studio.markDispatched, { generationId: second._id });
    await t.mutation(internal.studio.markFailed, {
      generationId: second._id,
      error: "No answer.",
      spend: { kind: "settle", reason: "no answer" },
      unknown: true,
    });
    expect(await reservation(t, first._id)).toMatchObject({ state: "settled", actualCents: 1.07 });
    expect(await reservation(t, second._id)).toMatchObject({ state: "settled", actualCents: SINGLE });
    expect(await day(t)).toMatchObject({ openCents: SINGLE * 2, settledCents: 1.07 + SINGLE });
    expect(await balance(t, alice.userId)).toBe(7);
  });

  it("records an overage and switches the CultRemix Gateway off until an admin turns it back on", async () => {
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const owner = await addUser(t, "jon", "super_admin_owner", 0);
    const batchId = await generateBatch(alice.as);
    await t.mutation(internal.studio.markBatchDispatched, { batchId });
    await t.mutation(internal.studio.finishBatch, {
      batchId,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      spend: { kind: "settle", actualCents: GRID + 12.5 },
    });
    expect(await reservation(t, batchId)).toMatchObject({ state: "settled", overageCents: 12.5 });
    expect(await day(t)).toMatchObject({ overageCents: 12.5, settledCents: GRID + 12.5 });
    const flag = await t.run((ctx) =>
      ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "gen.vercel"))
        .unique(),
    );
    expect(flag?.enabled).toBe(false);
    expect(await alice.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "GENERATION_OFF" });

    const today = await owner.as.query(api.budget.today, {});
    expect(today.providers[0]).toMatchObject({ provider: "gateway", on: false, overageCents: 12.5, reportedCount: 1 });

    await owner.as.mutation(api.admin.setFlag, { key: "gen.vercel", enabled: true });
    await generateBatch(alice.as);
  });

  it("ignores a second close of the same attempt", async () => {
    const t = newTest();
    await setBudget(t, GRID);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    await t.mutation(internal.budget.closeAttempt, { attemptId: batchId, spend: { kind: "settle", actualCents: 5 } });
    await t.mutation(internal.budget.closeAttempt, { attemptId: batchId, spend: { kind: "settle", actualCents: 5 } });
    await t.mutation(internal.budget.closeAttempt, { attemptId: batchId, spend: { kind: "release" } });
    expect(await day(t)).toMatchObject({ openCents: 0, settledCents: 5 });
  });
});

describe("credits", () => {
  it("charges 2 per grid batch and refunds missing designs exactly as before", async () => {
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const missing = [
      { lost: 0, back: 0 },
      { lost: 1, back: 1 },
      { lost: 3, back: 2 },
      { lost: 4, back: 2 },
    ];
    let expected = 10;
    for (const { lost, back } of missing) {
      const batchId = await generateBatch(alice.as);
      expected -= 2;
      expect(await balance(t, alice.userId)).toBe(expected);
      await t.mutation(internal.studio.markBatchDispatched, { batchId });
      await t.mutation(internal.studio.finishBatch, {
        batchId,
        results: [0, 1, 2, 3].map((index) => (index < lost ? { index, error: "lost" } : { index, design })),
        spend: { kind: "settle", actualCents: 9.9 },
      });
      expected += back;
      expect(await balance(t, alice.userId)).toBe(expected);
    }
  });

  it("charges 1 per single design and refunds each failure", async () => {
    process.env.STUDIO_LAYOUT = "single";
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    expect(await balance(t, alice.userId)).toBe(6);
    const [a, b] = await tiles(t, batchId);
    await t.mutation(internal.studio.markDispatched, { generationId: a._id });
    await t.mutation(internal.studio.markFailed, { generationId: a._id, error: "refused", spend: { kind: "release" } });
    await t.mutation(internal.studio.markDispatched, { generationId: b._id });
    await t.mutation(internal.studio.markSucceeded, { generationId: b._id, ...design });
    expect(await balance(t, alice.userId)).toBe(7);
  });

  it("refuses for credits before the budget", async () => {
    const t = newTest();
    await setBudget(t, 0);
    const alice = await addUser(t, "alice", "user", 1);
    expect(await alice.as.mutation(api.studio.generate, BATCH)).toEqual({ refused: "NO_CREDITS" });
  });
});

describe("sweeper", () => {
  it("releases what never went out and settles what went out and never came back", async () => {
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const queued = await generateBatch(alice.as);
    const sent = await generateBatch(alice.as);
    const fresh = await generateBatch(alice.as);
    await t.mutation(internal.studio.markBatchDispatched, { batchId: sent });
    expect(await balance(t, alice.userId)).toBe(4);

    // Nothing is old enough yet.
    vi.setSystemTime(Date.now() + 9 * MINUTE);
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 0, released: 0 });

    // At 11 minutes, the queued batch expires; the sent one has only been out 11 minutes.
    vi.setSystemTime(new Date("2026-10-04T12:11:00Z"));
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("reservations")
        .withIndex("by_attempt", (q) => q.eq("attemptId", fresh))
        .unique())!;
      await ctx.db.patch("reservations", row._id, { openedAt: Date.now() });
    });
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 0, released: 1 });
    expect(await reservation(t, queued)).toMatchObject({ state: "released", reason: "sweeper" });
    expect((await tiles(t, queued)).map((g) => [g.status, g.error])).toEqual(
      Array(4).fill(["expired", "Timed out before starting."]),
    );
    // A swept batch can't be sent afterward.
    expect(await t.mutation(internal.studio.markBatchDispatched, { batchId: queued })).toBe(false);

    vi.setSystemTime(new Date("2026-10-04T12:16:00Z"));
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 1, released: 0 });
    expect(await reservation(t, sent)).toMatchObject({ state: "settled", costSource: "worst_case", actualCents: GRID });
    expect((await tiles(t, sent)).every((g) => g.status === "unknown_outcome")).toBe(true);
    // A late finish from the dead action changes nothing.
    await t.mutation(internal.studio.finishBatch, {
      batchId: sent,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      spend: { kind: "settle", actualCents: 9.9 },
    });
    expect((await reservation(t, sent))?.actualCents).toBe(GRID);
    expect(await reservation(t, fresh)).toMatchObject({ state: "open" });
    expect(await day(t)).toMatchObject({ openCents: GRID, settledCents: GRID });
    // Both swept batches gave their 2 credits back, as missing designs always have.
    expect(await balance(t, alice.userId)).toBe(8);
  });

  it("refunds an abandoned single design and marks a first model photo failed", async () => {
    process.env.STUDIO_LAYOUT = "single";
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const batchId = await generateBatch(alice.as);
    const [first] = await tiles(t, batchId);
    await t.mutation(internal.studio.markDispatched, { generationId: first._id });
    const workId = await addWork(t, alice.userId, { status: "preparing" });
    const published = await t.mutation(internal.publish.markPublished, { workId, artKey: "works/a.png", contentHash: "abc" });

    vi.setSystemTime(new Date("2026-10-04T12:20:00Z"));
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 2, released: 3 });
    const statuses = (await tiles(t, batchId)).map((g) => g.status);
    expect(statuses).toEqual(["unknown_outcome", "expired", "expired", "expired"]);
    expect(await balance(t, alice.userId)).toBe(10);
    const photo = await t.run((ctx) =>
      ctx.db
        .query("shootPhotos")
        .withIndex("by_shoot_index", (q) => q.eq("shootId", published!.shootId).eq("index", 1))
        .unique(),
    );
    expect(photo).toMatchObject({ state: "failed", reason: "We lost track of this one." });
  });
});

describe("model photos", () => {
  it("holds a photo at publish, settles it when recorded, and rests when the budget is spent", async () => {
    const t = newTest();
    await setBudget(t, PHOTO);
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, { status: "preparing" });
    const first = await t.mutation(internal.publish.markPublished, { workId, artKey: "works/a.png", contentHash: "abc" });
    expect(first?.attemptId).toMatch(/^photo:/);
    expect(await reservation(t, first!.attemptId!)).toMatchObject({ attemptKind: "photo", state: "open", userId: alice.userId });
    expect(first?.attemptId && (await reservation(t, first.attemptId))?.dispatchedAt).toBeDefined();

    // The budget is full: the next work still publishes, without a photo today.
    const second = await addWork(t, alice.userId, { status: "preparing" });
    const resting = await t.mutation(internal.publish.markPublished, { workId: second, artKey: "works/b.png", contentHash: "def" });
    expect(resting).toMatchObject({ resting: true });
    expect((await t.run((ctx) => ctx.db.get("works", second)))?.status).toBe("published");
    const restingPhoto = await t.run((ctx) =>
      ctx.db
        .query("shootPhotos")
        .withIndex("by_shoot_index", (q) => q.eq("shootId", resting!.shootId).eq("index", 1))
        .unique(),
    );
    expect(restingPhoto).toMatchObject({ state: "failed", reason: "The studio is resting until tomorrow." });

    await t.mutation(internal.publish.recordPhoto, {
      shootId: first!.shootId,
      publicKey: "works/a-photo.png",
      attemptId: first!.attemptId,
      spend: { kind: "settle", actualCents: 2.3 },
    });
    expect(await day(t)).toMatchObject({ openCents: 0, settledCents: 2.3 });
  });

  it("refuses a reshoot without changing the shoot when the budget is spent", async () => {
    const t = newTest();
    await setBudget(t, PHOTO);
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, { status: "preparing" });
    const published = await t.mutation(internal.publish.markPublished, { workId, artKey: "works/a.png", contentHash: "abc" });
    const work = (await t.run((ctx) => ctx.db.get("works", workId)))!;
    const cr = formatCr(work.crFamily, work.crExpression);
    const before = await t.run((ctx) => ctx.db.get("shoots", published!.shootId));
    expect(await t.mutation(internal.publish.beginReshoot, { cr })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("shoots", published!.shootId))).toEqual(before);

    await t.mutation(internal.publish.recordPhotoFailed, {
      shootId: published!.shootId,
      reason: "refused",
      attemptId: published!.attemptId,
      spend: { kind: "release" },
    });
    const reshoot = await t.mutation(internal.publish.beginReshoot, { cr });
    expect(reshoot?.attemptId).toMatch(/^photo:/);
    expect((await reservation(t, reshoot!.attemptId!))?.userId).toBeUndefined();
  });
});

describe("admin", () => {
  it("shows today's spend, open holds, and the cap, and each member's images today", async () => {
    const t = newTest();
    await setBudget(t, 10_000);
    const alice = await addUser(t, "alice");
    const owner = await addUser(t, "jon", "super_admin_owner", 0);
    const settled = await generateBatch(alice.as);
    await generateBatch(alice.as);
    await t.mutation(internal.studio.markBatchDispatched, { batchId: settled });
    await t.mutation(internal.studio.finishBatch, {
      batchId: settled,
      results: [0, 1, 2, 3].map((index) => ({ index, design })),
      spend: { kind: "settle", actualCents: 9.9 },
    });

    await expect(alice.as.query(api.budget.today, {})).rejects.toThrow();
    const today = await owner.as.query(api.budget.today, {});
    expect(today.dayUtc).toBe("2026-10-04");
    expect(today.providers[0]).toEqual({
      provider: "gateway",
      on: true,
      capCents: 10_000,
      settledCents: 9.9,
      openCents: GRID,
      openCount: 1,
      leftCents: 10_000 - 9.9 - GRID,
      overageCents: 0,
      reportedCount: 1,
      worstCaseCount: 0,
    });

    const members = await owner.as.query(api.admin.searchMembers, { search: "alice" });
    expect(members.find((m) => m.userId === alice.userId)?.spentTodayCents).toBe(9.9 + GRID);
  });
});
