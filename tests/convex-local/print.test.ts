import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { PRINT_PRODUCT } from "../../shared/config/print-products";
import { toInches } from "../../src/lib/print/shirtPlacement";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

// Scheduled actions (sharp, fal) never run here: timers stay fake and are never advanced.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ALICE = { subject: "test|alice", issuer: "test" };
const BOB = { subject: "test|bob", issuer: "test" };
const OWNER = { subject: "test|owner", issuer: "test" };
const CR = "101-001";

const METRICS = { hasAlpha: true, solid: 600_000, visible: 620_000, haze: 1_000 };

async function setup() {
  const t = newTest();
  const ids = await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { authId: ALICE.subject, username: "alice", usernameLower: "alice" });
    const bob = await ctx.db.insert("users", { authId: BOB.subject, username: "bob", usernameLower: "bob" });
    const owner = await ctx.db.insert("users", {
      authId: OWNER.subject,
      username: "owner",
      usernameLower: "owner",
      platformRole: "super_admin_owner",
    });
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: alice,
      updatedAt: 0,
      phrase: "",
      styleDirection: "",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: alice,
      instruction: "a red sun",
      presets: [],
      backgroundColor: "#ffffff",
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
      backgroundColor: "#ffffff",
      status: "published",
      publishedAt: 0,
      contentHash: "a".repeat(64),
      artKey: "fake:art.png",
    });
    await ctx.db.insert("creditLedger", { userId: alice, kind: "grant", amount: 10, reason: "admin" });
    // Upscaling is off until an admin turns it on (convex/lib/flags.ts).
    await ctx.db.insert("featureFlags", { key: "gen.upscale", enabled: true });
    return { alice, bob, owner, workId };
  });
  return { t, ...ids };
}

// Version 1, measured as if the action had run: 1024 px square, transparent.
async function openAndMeasure(t: T, identity = ALICE, size = 1024) {
  const versionId = await t.withIdentity(identity).mutation(api.print.open, { cr: CR });
  await t.mutation(internal.print.recordVersion, {
    versionId,
    key: "fake:art.png",
    width: size,
    height: size,
    metrics: METRICS,
  });
  return versionId;
}

async function balance(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("creditLedger").collect();
    return rows.filter((row) => row.userId === userId).reduce((sum, row) => sum + row.amount, 0);
  });
}

describe("who can prepare a work for print", () => {
  it("the creator and the owner see Print Studio; another member and signed-out visitors don't", async () => {
    const { t } = await setup();
    expect(await t.withIdentity(ALICE).query(api.print.studio, { cr: CR })).not.toBeNull();
    expect(await t.withIdentity(OWNER).query(api.print.studio, { cr: CR })).not.toBeNull();
    expect(await t.withIdentity(BOB).query(api.print.studio, { cr: CR })).toBeNull();
    expect(await t.query(api.print.studio, { cr: CR })).toBeNull();
  });

  it("the work page entry works signed out and shows only public facts", async () => {
    const { t } = await setup();
    expect(await t.query(api.print.entry, { cr: CR })).toEqual({ canPrepare: false, ready: null });
    expect(await t.withIdentity(BOB).query(api.print.entry, { cr: CR })).toEqual({ canPrepare: false, ready: null });
    expect(await t.withIdentity(ALICE).query(api.print.entry, { cr: CR })).toEqual({ canPrepare: true, ready: null });
    expect(await t.query(api.print.entry, { cr: "999-999" })).toEqual({ canPrepare: false, ready: null });
  });

  it("another member can't open, edit, place, or render", async () => {
    const { t } = await setup();
    const versionId = await openAndMeasure(t);
    const bob = t.withIdentity(BOB);
    await expect(bob.mutation(api.print.open, { cr: CR })).rejects.toThrow(/creator/u);
    await expect(bob.mutation(api.print.trim, { cr: CR, versionId })).rejects.toThrow(/creator/u);
    await expect(bob.mutation(api.print.upscale, { cr: CR, versionId })).rejects.toThrow(/creator/u);
    await expect(
      bob.mutation(api.print.savePlacement, { cr: CR, versionId, xIn: 1.5, yIn: 0.5, widthIn: 12, color: "Black" }),
    ).rejects.toThrow(/creator/u);
    await expect(bob.mutation(api.print.render, { cr: CR })).rejects.toThrow(/creator/u);
    await expect(t.mutation(api.print.render, { cr: CR })).rejects.toThrow(/Sign in/u);
  });
});

describe("versions", () => {
  it("opening twice keeps one version 1, made from the published art", async () => {
    const { t } = await setup();
    const first = await t.withIdentity(ALICE).mutation(api.print.open, { cr: CR });
    expect(await t.withIdentity(ALICE).mutation(api.print.open, { cr: CR })).toBe(first);
    const studio = await t.withIdentity(ALICE).query(api.print.studio, { cr: CR });
    expect(studio?.versions).toHaveLength(1);
    expect(studio?.versions[0]).toMatchObject({ number: 1, op: "published", status: "pending", url: "fake:art.png" });
  });

  it("starts from where the creator placed it on the front when publishing", async () => {
    const { t, workId } = await setup();
    // Published before placement existed: the default, Large near the top, on the launch tee.
    const opened = await t.withIdentity(ALICE).query(api.print.studio, { cr: CR });
    expect(opened?.publishPlacement).toEqual({ side: "front", size: 0.85, drop: 0.08 });
    expect(opened?.product.kind).toBe("tee");
    await t.run(async (ctx) => ctx.db.patch("works", workId, { printPlacement: { side: "front", size: 0.4, drop: 0.3 } }));
    expect((await t.withIdentity(ALICE).query(api.print.studio, { cr: CR }))?.publishPlacement).toEqual({ side: "front", size: 0.4, drop: 0.3 });
    // The Print Studio places the front; a back print starts from its own default.
    await t.run(async (ctx) => ctx.db.patch("works", workId, { printPlacement: { side: "back", size: 0.4, drop: 0.3 } }));
    const back = await t.withIdentity(ALICE).query(api.print.studio, { cr: CR });
    expect(back?.publishPlacement).toBeNull();
    // The page says the back print's placement is set on the work page.
    expect(back?.publishSide).toBe("back");
  });

  it("a placement saved here becomes the work's, so the work page says what prints", async () => {
    const { t, workId } = await setup();
    const alice = t.withIdentity(ALICE);
    const v1 = await openAndMeasure(t);
    const area = (await alice.query(api.print.studio, { cr: CR }))!.product.printArea;
    await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: 3, yIn: 2, widthIn: 6, color: "Black" });
    const placed = await t.run(async (ctx) => (await ctx.db.get("works", workId))?.printPlacement);
    expect(placed?.side).toBe("front");
    // Back in inches on the same print area (a 1024 px square), it's what was saved.
    expect(toInches(placed!, 1, area).widthIn).toBeCloseTo(6, 1);
    expect(toInches(placed!, 1, area).yIn).toBeCloseTo(2, 1);
  });

  it("a save that only changes the color leaves the work's placement alone", async () => {
    const { t, workId } = await setup();
    const alice = t.withIdentity(ALICE);
    const v1 = await openAndMeasure(t);
    const studio = await alice.query(api.print.studio, { cr: CR });
    // Where it opens: the default placement (Large near the top) in inches, a 1024 px square.
    const start = toInches(studio!.publishPlacement!, 1, studio!.product.printArea);
    const xIn = (studio!.product.printArea.widthIn - start.widthIn) / 2;
    await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn, yIn: start.yIn, widthIn: start.widthIn, color: "Black" });
    expect(await t.run(async (ctx) => (await ctx.db.get("works", workId))?.printPlacement ?? null)).toBeNull();
  });

  it("a placement changed on the work page moves this one, keeping its version and color", async () => {
    const { t, workId } = await setup();
    const alice = t.withIdentity(ALICE);
    const v1 = await openAndMeasure(t);
    await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: 3, yIn: 2, widthIn: 6, color: "Black" });
    const productId = PRINT_PRODUCT.printful.productId;
    const small = { side: "front" as const, size: 0.4, drop: 0 };
    await alice.mutation(api.publish.setPrintSetup, { workId, printPlacement: small, printProducts: [{ productId }] });
    const studio = await alice.query(api.print.studio, { cr: CR });
    const expected = toInches(small, 1, studio!.product.printArea);
    expect(studio?.placement).toMatchObject({ versionId: v1, widthIn: expected.widthIn, yIn: expected.yIn, color: "Black" });
    // A back print leaves it alone: the Print Studio places the front.
    await alice.mutation(api.publish.setPrintSetup, { workId, printPlacement: { side: "back", size: 0.9, drop: 0 }, printProducts: [{ productId }] });
    expect((await alice.query(api.print.studio, { cr: CR }))?.placement).toMatchObject({ widthIn: expected.widthIn, yIn: expected.yIn });
    // Once the Print Studio's own file is made, it still follows: products' print files come from it.
    await t.run(async (ctx) => ctx.db.patch("works", workId, { printKey: "fake:print.png", printSha256: "b".repeat(64) }));
    const medium = { side: "front" as const, size: 0.65, drop: 0 };
    await alice.mutation(api.publish.setPrintSetup, { workId, printPlacement: medium, printProducts: [{ productId }] });
    expect((await alice.query(api.print.studio, { cr: CR }))?.placement).toMatchObject({
      versionId: v1,
      widthIn: toInches(medium, 1, studio!.product.printArea).widthIn,
    });
  });

  it("offers the work's published colors first, as the print product's names", async () => {
    const { t, workId } = await setup();
    expect((await t.withIdentity(ALICE).query(api.print.studio, { cr: CR }))?.offeredColors).toEqual([]);
    await t.run(async (ctx) => ctx.db.patch("works", workId, { offeredColors: ["true-navy", "moss", "black"] }));
    expect((await t.withIdentity(ALICE).query(api.print.studio, { cr: CR }))?.offeredColors).toEqual(["True Navy", "Sage", "Black"]);
  });

  it("trim and knockout start from a ready version and number on", async () => {
    const { t } = await setup();
    const v1 = await openAndMeasure(t);
    const alice = t.withIdentity(ALICE);
    const v2 = await alice.mutation(api.print.knockout, { cr: CR, versionId: v1, color: "#FFFFFF", tolerance: 140, fromEdges: true });
    const row = await t.run((ctx) => ctx.db.get("printVersions", v2));
    expect(row).toMatchObject({ number: 2, op: "knockout", status: "pending", params: { color: "#ffffff", tolerance: 100 } });
    // Still pending: nothing can start from it yet.
    await expect(alice.mutation(api.print.trim, { cr: CR, versionId: v2 })).rejects.toThrow(/being made/u);
    await expect(
      alice.mutation(api.print.knockout, { cr: CR, versionId: v1, color: "white", tolerance: 10, fromEdges: true }),
    ).rejects.toThrow(/color/u);
  });
});

describe("upscale for print", () => {
  it("charges the creator 2 credits and gives them back once if it fails", async () => {
    const { t, alice } = await setup();
    const v1 = await openAndMeasure(t);
    const result = await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: v1 });
    expect("versionId" in result).toBe(true);
    const versionId = (result as { versionId: Id<"printVersions"> }).versionId;
    expect(await balance(t, alice)).toBe(8);
    const row = await t.run((ctx) => ctx.db.get("printVersions", versionId));
    expect(row).toMatchObject({ op: "upscale", upscaled: true, remixSourceId: v1, charged: 2, fal: { state: "queued", polls: 0 } });

    // A second upscale while one runs is refused.
    await expect(t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: v1 })).rejects.toThrow(/already running/u);

    expect(await t.mutation(internal.print.failVersion, { versionId, error: "fal said no" })).toBe(true);
    expect(await t.mutation(internal.print.failVersion, { versionId, error: "again" })).toBe(false);
    expect(await balance(t, alice)).toBe(10);
  });

  it("the owner upscales without credits", async () => {
    const { t, owner } = await setup();
    const v1 = await openAndMeasure(t, OWNER);
    const result = await t.withIdentity(OWNER).mutation(api.print.upscale, { cr: CR, versionId: v1 });
    expect("versionId" in result).toBe(true);
    expect(await balance(t, owner)).toBe(0);
  });

  it("refuses without credits, without transparency, too large, or already upscaled", async () => {
    const { t, alice } = await setup();
    const v1 = await openAndMeasure(t);
    const alice_ = t.withIdentity(ALICE);
    await t.run((ctx) => ctx.db.insert("creditLedger", { userId: alice, kind: "settle", amount: -9 }));
    expect(await alice_.mutation(api.print.upscale, { cr: CR, versionId: v1 })).toEqual({ refused: "NO_CREDITS" });
    await t.run((ctx) => ctx.db.insert("creditLedger", { userId: alice, kind: "grant", amount: 9, reason: "admin" }));

    await t.run((ctx) => ctx.db.patch("printVersions", v1, { metrics: { ...METRICS, hasAlpha: false } }));
    await expect(alice_.mutation(api.print.upscale, { cr: CR, versionId: v1 })).rejects.toThrow(/transparency/u);
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { metrics: METRICS, width: 2048, height: 2048 }));
    await expect(alice_.mutation(api.print.upscale, { cr: CR, versionId: v1 })).rejects.toThrow(/1536/u);
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { width: 1024, height: 1024, upscaled: true }));
    await expect(alice_.mutation(api.print.upscale, { cr: CR, versionId: v1 })).rejects.toThrow(/already upscaled/u);
  });

  it("claims the submission once, and records one request ID", async () => {
    const { t } = await setup();
    const v1 = await openAndMeasure(t);
    const { versionId } = (await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: v1 })) as {
      versionId: Id<"printVersions">;
    };
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(true);
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(false);
    const submission = { requestId: "req-1", statusUrl: "https://queue.fal.run/s", responseUrl: "https://queue.fal.run/r" };
    await t.mutation(internal.print.recordSubmission, { versionId, ...submission });
    await expect(t.mutation(internal.print.recordSubmission, { versionId, ...submission, requestId: "req-2" })).rejects.toThrow();
    const row = await t.run((ctx) => ctx.db.get("printVersions", versionId));
    expect(row?.fal).toMatchObject({ state: "submitted", requestId: "req-1" });
  });
});

// The daily budget (convex/lib/budget.ts): every upscale holds its worst-case fal cost from the
// moment it's admitted until it settles or is released. The 2-credit charge and refund don't change.
describe("upscales and the fal budget", () => {
  const MINUTE = 60_000;

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  });

  async function setBudget(t: T, cents: number) {
    await t.run(async (ctx) => {
      await ctx.db.insert("appSettings", {
        key: "main",
        signupGrant: { enabled: true, credits: 24 },
        dailyBudgetCents: cents,
        shootsPerMemberPerDay: 3,
        updatedAt: 0,
      });
    });
  }

  async function startUpscale(t: T, identity = ALICE, size = 1024) {
    const v1 = await openAndMeasure(t, identity, size);
    const result = await t.withIdentity(identity).mutation(api.print.upscale, { cr: CR, versionId: v1 });
    return { v1, versionId: (result as { versionId: Id<"printVersions"> }).versionId };
  }

  async function submit(t: T, versionId: Id<"printVersions">) {
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(true);
    await t.mutation(internal.print.recordSubmission, {
      versionId,
      requestId: "req-1",
      statusUrl: "https://queue.fal.run/s",
      responseUrl: "https://queue.fal.run/r",
    });
  }

  async function finish(t: T, versionId: Id<"printVersions">, width: number, height: number) {
    return await t.mutation(internal.print.recordVersion, { versionId, key: "fake:up.png", width, height, metrics: METRICS });
  }

  async function reservation(t: T, attemptId: string) {
    return await t.run((ctx) =>
      ctx.db
        .query("reservations")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attemptId))
        .unique(),
    );
  }

  async function falDay(t: T) {
    return await t.run((ctx) =>
      ctx.db
        .query("budgetDays")
        .withIndex("by_provider_day", (q) => q.eq("provider", "fal").eq("dayUtc", "2026-10-04"))
        .unique(),
    );
  }

  async function upscaleFlag(t: T) {
    return await t.run(async (ctx) => {
      const row = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "gen.upscale"))
        .unique();
      return row?.enabled;
    });
  }

  it("holds the worst case under fal when admitted, and marks it sent at the claim", async () => {
    const { t, alice } = await setup();
    // 1024 px comes back 4096 px square, 16.8 MP: one 24 MP block, 8 cents.
    const { versionId } = await startUpscale(t);
    expect(await reservation(t, versionId)).toMatchObject({
      attemptKind: "upscale",
      provider: "fal",
      userId: alice,
      credits: 2,
      worstCaseCents: 8,
      state: "open",
      dayUtc: "2026-10-04",
    });
    expect((await reservation(t, versionId))?.dispatchedAt).toBeUndefined();
    expect(await falDay(t)).toMatchObject({ openCents: 8, settledCents: 0 });
    // The gateway's day is untouched.
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("budgetDays")
          .withIndex("by_provider_day", (q) => q.eq("provider", "gateway").eq("dayUtc", "2026-10-04"))
          .unique(),
      ),
    ).toBeNull();

    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(true);
    expect((await reservation(t, versionId))?.dispatchedAt).toBe(Date.now());
  });

  it("holds 16 cents for a 1536 px design, whose output is over 24 MP", async () => {
    const { t, owner } = await setup();
    const { versionId } = await startUpscale(t, OWNER, 1536);
    // The owner pays no credits but counts toward the budget.
    expect(await reservation(t, versionId)).toMatchObject({ userId: owner, credits: 0, worstCaseCents: 16 });
  });

  it("settles at the price of what fal returned, and keeps the credits", async () => {
    const { t, alice } = await setup();
    const { versionId } = await startUpscale(t);
    await submit(t, versionId);
    expect(await finish(t, versionId, 4096, 4096)).toBe(true);
    expect(await reservation(t, versionId)).toMatchObject({ state: "settled", actualCents: 8, costSource: "reported" });
    expect((await reservation(t, versionId))?.overageCents).toBeUndefined();
    expect(await falDay(t)).toMatchObject({ openCents: 0, settledCents: 8 });
    expect(await upscaleFlag(t)).toBe(true);
    expect(await balance(t, alice)).toBe(8);
  });

  it("releases an upscale that never reached fal and refunds it once", async () => {
    const { t, alice } = await setup();
    // Failed before the claim (still queued).
    const first = await startUpscale(t);
    expect(await t.mutation(internal.print.failVersion, { versionId: first.versionId, error: "no key" })).toBe(true);
    expect(await reservation(t, first.versionId)).toMatchObject({ state: "released", reason: "not sent" });
    expect(await balance(t, alice)).toBe(10);

    // Claimed, but fal refused the post outright (the submit action says so).
    const { versionId } = (await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: first.v1 })) as {
      versionId: Id<"printVersions">;
    };
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(true);
    await t.mutation(internal.print.failVersion, { versionId, error: "Bad image", spend: { kind: "release", reason: "refused 422" } });
    expect(await reservation(t, versionId)).toMatchObject({ state: "released", reason: "refused 422" });
    expect(await falDay(t)).toMatchObject({ openCents: 0, settledCents: 0 });
    // The refund is unchanged: once per attempt, whatever closes the reservation.
    expect(await t.mutation(internal.print.failVersion, { versionId, error: "again" })).toBe(false);
    expect(await balance(t, alice)).toBe(10);
    const refunds = await t.run(async (ctx) => (await ctx.db.query("creditLedger").collect()).filter((row) => row.kind === "refund_credit"));
    expect(refunds.map((row) => row.amount)).toEqual([2, 2]);
  });

  it("settles a failure after fal took the job at the worst case, and still refunds the credits", async () => {
    const { t, alice } = await setup();
    const { versionId } = await startUpscale(t);
    await submit(t, versionId);
    await t.mutation(internal.print.failVersion, { versionId, error: "The upscale took too long." });
    expect(await reservation(t, versionId)).toMatchObject({ state: "settled", actualCents: 8, costSource: "worst_case" });
    expect(await falDay(t)).toMatchObject({ openCents: 0, settledCents: 8 });
    expect(await balance(t, alice)).toBe(10);
  });

  it("an overage turns upscaling off", async () => {
    const { t, alice } = await setup();
    const { v1, versionId } = await startUpscale(t);
    await submit(t, versionId);
    // fal returned more than 4x: 6144 px square is 37.7 MP, 16 cents against a hold of 8.
    expect(await finish(t, versionId, 6144, 6144)).toBe(true);
    expect(await reservation(t, versionId)).toMatchObject({ state: "settled", actualCents: 16, overageCents: 8 });
    expect(await falDay(t)).toMatchObject({ openCents: 0, settledCents: 16, overageCents: 8 });
    expect(await upscaleFlag(t)).toBe(false);
    // The upscale itself succeeded, so its credits stay spent; the next one is refused.
    expect(await balance(t, alice)).toBe(8);
    expect(await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: v1 })).toEqual({ refused: "DISABLED" });
  });

  it("refuses when the day's budget can't hold the worst case, before charging anything", async () => {
    const { t, alice } = await setup();
    await setBudget(t, 7);
    const v1 = await openAndMeasure(t);
    expect(await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId: v1 })).toEqual({ refused: "BUDGET" });
    expect(await balance(t, alice)).toBe(10);
    const rows = await t.run(async (ctx) => ({
      versions: (await ctx.db.query("printVersions").collect()).length,
      reservations: (await ctx.db.query("reservations").collect()).length,
    }));
    expect(rows).toEqual({ versions: 1, reservations: 0 });
  });

  it("the sweeper fails and refunds an upscale that never started, and it can't be sent after", async () => {
    const { t, alice } = await setup();
    const { versionId } = await startUpscale(t);
    vi.setSystemTime(Date.now() + 11 * MINUTE);
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 0, released: 1 });
    expect(await reservation(t, versionId)).toMatchObject({ state: "released", reason: "sweeper" });
    expect(await t.run((ctx) => ctx.db.get("printVersions", versionId))).toMatchObject({ status: "failed", error: "Timed out before starting." });
    expect(await balance(t, alice)).toBe(10);
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(false);
  });

  it("the sweeper settles an upscale sent and never finished, and refunds it", async () => {
    const { t, alice } = await setup();
    const { versionId } = await startUpscale(t);
    await submit(t, versionId);
    vi.setSystemTime(Date.now() + 16 * MINUTE);
    expect(await t.mutation(internal.budget.sweep, {})).toEqual({ settled: 1, released: 0 });
    expect(await reservation(t, versionId)).toMatchObject({ state: "settled", costSource: "worst_case", actualCents: 8 });
    expect(await t.run((ctx) => ctx.db.get("printVersions", versionId))).toMatchObject({ status: "failed" });
    expect(await balance(t, alice)).toBe(10);
    // A late result from the dead poll changes nothing.
    expect(await finish(t, versionId, 4096, 4096)).toBe(false);
    expect(await falDay(t)).toMatchObject({ openCents: 0, settledCents: 8 });
  });

  it("a claim whose reservation is already closed fails and refunds instead of posting", async () => {
    const { t, alice } = await setup();
    const { versionId } = await startUpscale(t);
    await t.mutation(internal.budget.closeAttempt, { attemptId: versionId, spend: { kind: "release" } });
    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(false);
    expect(await t.run((ctx) => ctx.db.get("printVersions", versionId))).toMatchObject({ status: "failed", fal: { state: "queued" } });
    expect(await balance(t, alice)).toBe(10);
  });
});

// "Remove background" (BiRefNet on fal): a version cut out of any background, for no credits,
// holding two cents of the fal budget until it settles or is released.
describe("removing the background", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  });

  const held = (t: T, attemptId: string) =>
    t.run((ctx) =>
      ctx.db
        .query("reservations")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attemptId))
        .unique(),
    );

  it("makes a transparent version from art with any background, without credits, and settles at two cents", async () => {
    const { t, alice } = await setup();
    const v1 = await openAndMeasure(t);
    // A photo-like background knockout can't clear.
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { metrics: { ...METRICS, hasAlpha: false } }));
    const result = await t.withIdentity(ALICE).mutation(api.print.removeBackground, { cr: CR, versionId: v1 });
    const versionId = (result as { versionId: Id<"printVersions"> }).versionId;
    expect(await t.run((ctx) => ctx.db.get("printVersions", versionId))).toMatchObject({
      op: "cutout",
      status: "pending",
      parentId: v1,
      upscaled: false,
      charged: 0,
      fal: { state: "queued", polls: 0 },
    });
    expect(await balance(t, alice)).toBe(10);
    expect(await held(t, versionId)).toMatchObject({ attemptKind: "upscale", provider: "fal", credits: 0, worstCaseCents: 2, state: "open" });
    const studio = await t.withIdentity(ALICE).query(api.print.studio, { cr: CR });
    expect(studio?.versions.find((version) => version.id === versionId)).toMatchObject({ op: "cutout", removing: true, upscaling: false });
    // One at a time.
    await expect(t.withIdentity(ALICE).mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).rejects.toThrow(/already being removed/u);

    expect(await t.mutation(internal.print.claimSubmission, { versionId })).toBe(true);
    expect(await t.mutation(internal.print.recordVersion, { versionId, key: "fake:cut.png", width: 1024, height: 1024, metrics: METRICS })).toBe(true);
    expect(await held(t, versionId)).toMatchObject({ state: "settled", actualCents: 2 });
    // With its background gone, it can be upscaled.
    expect("versionId" in (await t.withIdentity(ALICE).mutation(api.print.upscale, { cr: CR, versionId }))).toBe(true);
  });

  it("releases one that never reached fal, and refuses transparent or upscaled art, other members, the switch off, and a spent budget", async () => {
    const { t } = await setup();
    const v1 = await openAndMeasure(t);
    const alice = t.withIdentity(ALICE);
    // Art that's already transparent would come back hazy.
    await expect(alice.mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).rejects.toThrow(/already transparent/u);
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { metrics: { ...METRICS, hasAlpha: false } }));
    const { versionId } = (await alice.mutation(api.print.removeBackground, { cr: CR, versionId: v1 })) as { versionId: Id<"printVersions"> };
    expect(await t.mutation(internal.print.failVersion, { versionId, error: "Background removal isn't set up yet." })).toBe(true);
    expect(await held(t, versionId)).toMatchObject({ state: "released", reason: "not sent" });

    await expect(t.withIdentity(BOB).mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { upscaled: true }));
    await expect(alice.mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).rejects.toThrow(/before upscaling/u);
    await t.run((ctx) => ctx.db.patch("printVersions", v1, { upscaled: false }));

    const flag = await t.run((ctx) => ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "gen.upscale")).unique());
    await t.run((ctx) => ctx.db.patch("featureFlags", flag!._id, { enabled: false }));
    expect(await alice.mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).toEqual({ refused: "DISABLED" });
    await t.run((ctx) => ctx.db.patch("featureFlags", flag!._id, { enabled: true }));

    await t.run((ctx) =>
      ctx.db.insert("appSettings", {
        key: "main",
        signupGrant: { enabled: true, credits: 24 },
        dailyBudgetCents: 1,
        shootsPerMemberPerDay: 3,
        updatedAt: 0,
      }),
    );
    expect(await alice.mutation(api.print.removeBackground, { cr: CR, versionId: v1 })).toEqual({ refused: "BUDGET" });
  });
});

describe("placement and the print file", () => {
  const FILE = {
    key: "works/101/001/print-aaaaaaaaaaaaaaaaaaaaaaaaaa/print.png",
    sha256: "b".repeat(64),
    widthPx: 4500,
    heightPx: 5100,
    placement: { xIn: 1.5, yIn: 0.5, widthIn: 12, heightIn: 12 },
    rect: { left: 450, top: 150, width: 3600, height: 3600 },
    product: "printful-586",
    color: "Black",
    dpi: 85.3,
    grade: "good" as const,
    coverage: 0.4,
    haze: 0,
    warnings: [],
  };

  it("clamps and saves the placement, and refuses a color that isn't offered", async () => {
    const { t } = await setup();
    const v1 = await openAndMeasure(t);
    const alice = t.withIdentity(ALICE);
    // The launch shirt's regular 12 x 16 in front.
    expect(await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: -5, yIn: 40, widthIn: 30, color: "Black" })).toEqual({
      xIn: 0,
      yIn: 4,
      widthIn: 12,
    });
    await expect(
      alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: 1, yIn: 1, widthIn: 10, color: "Plaid" }),
    ).rejects.toThrow(/color/u);
  });

  it("refuses to render a placement the print check refuses", async () => {
    const { t } = await setup();
    const v1 = await openAndMeasure(t);
    const alice = t.withIdentity(ALICE);
    // 1024 px across 12 in is 85 DPI.
    await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: 1.5, yIn: 0.5, widthIn: 12, color: "Black" });
    await expect(alice.mutation(api.print.render, { cr: CR })).rejects.toThrow(/DPI/u);
    // 1024 px across 5 in is 204 DPI: it renders.
    await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: 5, yIn: 0.5, widthIn: 5, color: "Black" });
    await alice.mutation(api.print.render, { cr: CR });
    const studio = await alice.query(api.print.studio, { cr: CR });
    expect(studio?.placement?.rendering).toBe(true);
    await expect(alice.mutation(api.print.render, { cr: CR })).rejects.toThrow(/being made/u);
  });

  it("sets the work's print key and hash once, then everything is locked", async () => {
    const { t, workId, alice } = await setup();
    const v1 = await openAndMeasure(t);
    const args = { workId, versionId: v1, createdBy: alice, ...FILE };
    expect(await t.mutation(internal.print.recordRender, args)).toBe(true);
    expect(await t.mutation(internal.print.recordRender, { ...args, key: FILE.key.replace("print.png", "x.png"), sha256: "c".repeat(64) })).toBe(false);
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work).toMatchObject({ printKey: FILE.key, printSha256: FILE.sha256 });

    const alice_ = t.withIdentity(ALICE);
    await expect(alice_.mutation(api.print.trim, { cr: CR, versionId: v1 })).rejects.toThrow(/already made/u);
    await expect(alice_.mutation(api.print.render, { cr: CR })).rejects.toThrow(/already made/u);
    expect(await t.query(api.print.entry, { cr: CR })).toEqual({ canPrepare: false, ready: { dpi: 85, widthIn: 12 } });
    // Bob never sees the print file's address.
    expect(await t.withIdentity(BOB).query(api.print.studio, { cr: CR })).toBeNull();
  });
});
