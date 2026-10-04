import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";

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

describe("placement and the print file", () => {
  const FILE = {
    key: "works/101/001/print-aaaaaaaaaaaaaaaaaaaaaaaaaa/print.png",
    sha256: "b".repeat(64),
    widthPx: 4500,
    heightPx: 5100,
    placement: { xIn: 1.5, yIn: 0.5, widthIn: 12, heightIn: 12 },
    rect: { left: 450, top: 150, width: 3600, height: 3600 },
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
    expect(await alice.mutation(api.print.savePlacement, { cr: CR, versionId: v1, xIn: -5, yIn: 40, widthIn: 30, color: "Black" })).toEqual({
      xIn: 0,
      yIn: 2,
      widthIn: 15,
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
