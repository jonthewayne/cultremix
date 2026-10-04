import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { PRINT_PRODUCT, shirtColor } from "../shared/config/print-products";
import { printCheck } from "../src/lib/print/check";
import { clampTolerance, parseHex } from "../src/lib/print/knockout";
import { aspectOf, clampPlacement } from "../src/lib/print/placement";
import { creditBalance, getViewerUser, isOwner } from "./identity";
import { authorizeDispatch, closeReservation, hasRoom, openReservation, spendValidator } from "./lib/budget";
import { imageUrlReader } from "./lib/imageUrls";
import { EXPIRED_MESSAGE } from "./lib/paidAttempts";
import type { Spend } from "./lib/paidAttempts";
import { topazCents, topazWorstCaseCents } from "./lib/pricing";
import { formatCr, parseCr, publicUrl } from "./lib/r2";
import { flagEnabled } from "./studio";

// Print Studio (V1 U6): a published work's creator, or the owner, turns its art into a print file.
// Version 1 is the published art; trim, knockout and "Upscale for print" make more versions
// (convex/printTools.ts, convex/upscale.ts). The placement is saved per work, and the print file
// is made once (works.printKey and works.printSha256 never change after).

type Ctx = QueryCtx | MutationCtx;

export const UPSCALE_CREDITS = 2;
// Topaz takes up to 1536 px on the long side (KTD-20).
export const UPSCALE_MAX_SIDE = 1536;
export const MAX_VERSIONS = 24;
// A render that hasn't finished in this long can be started again.
const RENDER_STALE_MS = 5 * 60_000;

async function workByCr(ctx: Ctx, cr: string) {
  const parsed = parseCr(cr);
  if (!parsed) return null;
  const work = await ctx.db
    .query("works")
    .withIndex("by_family_expression", (q) => q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression))
    .unique();
  return work && work.status === "published" ? work : null;
}

export function canPrint(user: Doc<"users"> | null, work: Doc<"works">) {
  return Boolean(user && (user._id === work.creatorId || isOwner(user)));
}

// The signed-in creator (or owner) and their published work, or an error.
async function requirePrinter(ctx: MutationCtx, cr: string) {
  const user = await getViewerUser(ctx);
  if (!user) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
  const work = await workByCr(ctx, cr);
  if (!work) throw new ConvexError({ code: "NOT_FOUND", message: "No published work with that number." });
  if (!canPrint(user, work)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only the work's creator can prepare it for print." });
  }
  return { user, work };
}

async function versionsOf(ctx: Ctx, workId: Id<"works">) {
  return await ctx.db
    .query("printVersions")
    .withIndex("by_work_number", (q) => q.eq("workId", workId))
    .collect();
}

async function placementOf(ctx: Ctx, workId: Id<"works">) {
  return await ctx.db
    .query("printPlacements")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
}

async function printFileOf(ctx: Ctx, workId: Id<"works">) {
  return await ctx.db
    .query("printFiles")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
}

// A version of this work that's ready to work from.
async function readyVersion(ctx: MutationCtx, work: Doc<"works">, versionId: Id<"printVersions">) {
  const version = await ctx.db.get("printVersions", versionId);
  if (!version || version.workId !== work._id) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That version isn't part of this work." });
  }
  if (version.status !== "ready" || !version.key || !version.width || !version.height || !version.metrics) {
    throw new ConvexError({ code: "NOT_READY", message: "That version is still being made." });
  }
  return { ...version, key: version.key, width: version.width, height: version.height, metrics: version.metrics };
}

function requireUnlocked(work: Doc<"works">) {
  if (work.printKey) throw new ConvexError({ code: "LOCKED", message: "This work's print file is already made." });
}

async function nextVersion(ctx: MutationCtx, work: Doc<"works">) {
  const versions = await versionsOf(ctx, work._id);
  if (versions.length >= MAX_VERSIONS) {
    throw new ConvexError({ code: "TOO_MANY", message: "That's plenty of versions. Pick one and place it." });
  }
  return versions.reduce((max, version) => Math.max(max, version.number), 0) + 1;
}

const metricsValidator = v.object({ hasAlpha: v.boolean(), solid: v.number(), visible: v.number(), haze: v.number() });
const placementValidator = v.object({
  versionId: v.id("printVersions"),
  xIn: v.number(),
  yIn: v.number(),
  widthIn: v.number(),
  color: v.string(),
  rendering: v.boolean(),
  renderError: v.optional(v.string()),
});
const printFileValidator = v.object({
  url: v.optional(v.string()),
  previewUrl: v.optional(v.string()),
  versionId: v.id("printVersions"),
  sha256: v.string(),
  widthPx: v.number(),
  heightPx: v.number(),
  placement: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number(), heightIn: v.number() }),
  rect: v.object({ left: v.number(), top: v.number(), width: v.number(), height: v.number() }),
  color: v.string(),
  dpi: v.number(),
  grade: v.union(v.literal("good"), v.literal("great")),
  coverage: v.number(),
  haze: v.number(),
  warnings: v.array(v.string()),
});

export const studio = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      workId: v.id("works"),
      cr: v.string(),
      title: v.optional(v.string()),
      backgroundColor: v.string(),
      isOwner: v.boolean(),
      credits: v.number(),
      upscaleCredits: v.number(),
      upscaleEnabled: v.boolean(),
      versions: v.array(
        v.object({
          id: v.id("printVersions"),
          number: v.number(),
          parentNumber: v.optional(v.number()),
          op: v.union(v.literal("published"), v.literal("trim"), v.literal("knockout"), v.literal("upscale")),
          status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
          url: v.optional(v.string()),
          previewUrl: v.optional(v.string()),
          width: v.optional(v.number()),
          height: v.optional(v.number()),
          metrics: v.optional(metricsValidator),
          upscaled: v.boolean(),
          upscaling: v.boolean(),
          error: v.optional(v.string()),
          charged: v.number(),
        }),
      ),
      placement: v.union(v.null(), placementValidator),
      printFile: v.union(v.null(), printFileValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await workByCr(ctx, args.cr);
    if (!user || !work || !canPrint(user, work)) return null;
    const urls = imageUrlReader(ctx);
    const versions = await versionsOf(ctx, work._id);
    const numberOf = new Map(versions.map((version) => [version._id, version.number]));
    const placement = await placementOf(ctx, work._id);
    const file = await printFileOf(ctx, work._id);
    const owner = isOwner(user);
    return {
      workId: work._id,
      cr: formatCr(work.crFamily, work.crExpression),
      title: work.title,
      backgroundColor: work.backgroundColor,
      isOwner: owner,
      credits: await creditBalance(ctx, user._id),
      upscaleCredits: owner ? 0 : UPSCALE_CREDITS,
      upscaleEnabled: await flagEnabled(ctx, "gen.upscale"),
      versions: await Promise.all(
        versions.map(async (version) => {
          // Version 1 is the published art, which already has its medium copy.
          const published = version.op === "published" ? await urls(version.key) : undefined;
          return {
            id: version._id,
            number: version.number,
            parentNumber: version.parentId ? numberOf.get(version.parentId) : undefined,
            op: version.op,
            status: version.status,
            url: publicUrl(version.key),
            previewUrl: published?.mediumUrl ?? publicUrl(version.previewKey) ?? publicUrl(version.key),
            width: version.width,
            height: version.height,
            metrics: version.metrics,
            upscaled: version.upscaled,
            upscaling: version.op === "upscale" && version.status === "pending",
            error: version.error,
            charged: version.charged,
          };
        }),
      ),
      placement: placement && {
        versionId: placement.versionId,
        xIn: placement.xIn,
        yIn: placement.yIn,
        widthIn: placement.widthIn,
        color: placement.color,
        rendering: placement.render?.status === "rendering",
        renderError: placement.render?.status === "failed" ? placement.render.error : undefined,
      },
      printFile: file && {
        url: publicUrl(file.key),
        previewUrl: publicUrl(file.previewKey) ?? publicUrl(file.key),
        versionId: file.versionId,
        sha256: file.sha256,
        widthPx: file.widthPx,
        heightPx: file.heightPx,
        placement: file.placement,
        rect: file.rect,
        color: file.color,
        dpi: file.dpi,
        grade: file.grade,
        coverage: file.coverage,
        haze: file.haze,
        warnings: file.warnings,
      },
    };
  },
});

// For the work page: whether the viewer may prepare it, and the print file's status line. Works
// signed out; only public facts.
export const entry = query({
  args: { cr: v.string() },
  returns: v.object({
    canPrepare: v.boolean(),
    ready: v.union(v.null(), v.object({ dpi: v.number(), widthIn: v.number() })),
  }),
  handler: async (ctx, args) => {
    const work = await workByCr(ctx, args.cr);
    if (!work) return { canPrepare: false, ready: null };
    const user = await getViewerUser(ctx);
    const file = work.printKey ? await printFileOf(ctx, work._id) : null;
    return {
      canPrepare: canPrint(user, work),
      ready: file && { dpi: Math.floor(file.dpi), widthIn: file.placement.widthIn },
    };
  },
});

// Opens Print Studio: makes version 1 from the published art the first time (and measures it).
export const open = mutation({
  args: { cr: v.string() },
  returns: v.id("printVersions"),
  handler: async (ctx, args) => {
    const { user, work } = await requirePrinter(ctx, args.cr);
    if (!work.artKey) throw new ConvexError({ code: "NOT_READY", message: "The art is still being published." });
    const first = await ctx.db
      .query("printVersions")
      .withIndex("by_work_number", (q) => q.eq("workId", work._id).eq("number", 1))
      .unique();
    if (first) {
      // A failed first measure (the art wasn't reachable) is tried again on the next visit.
      if (first.status === "failed") {
        await ctx.db.patch("printVersions", first._id, { status: "pending", error: undefined });
        await ctx.scheduler.runAfter(0, internal.printTools.measure, { versionId: first._id });
      }
      return first._id;
    }
    const versionId = await ctx.db.insert("printVersions", {
      workId: work._id,
      number: 1,
      op: "published",
      status: "pending",
      key: work.artKey,
      sha256: work.contentHash,
      upscaled: false,
      charged: 0,
      createdBy: user._id,
    });
    await ctx.scheduler.runAfter(0, internal.printTools.measure, { versionId });
    return versionId;
  },
});

export const trim = mutation({
  args: { cr: v.string(), versionId: v.id("printVersions") },
  returns: v.id("printVersions"),
  handler: async (ctx, args) => {
    const { user, work } = await requirePrinter(ctx, args.cr);
    requireUnlocked(work);
    const parent = await readyVersion(ctx, work, args.versionId);
    const versionId = await ctx.db.insert("printVersions", {
      workId: work._id,
      number: await nextVersion(ctx, work),
      parentId: parent._id,
      op: "trim",
      status: "pending",
      upscaled: parent.upscaled,
      remixSourceId: parent.remixSourceId,
      charged: 0,
      createdBy: user._id,
    });
    await ctx.scheduler.runAfter(0, internal.printTools.makeVersion, { versionId });
    return versionId;
  },
});

export const knockout = mutation({
  args: {
    cr: v.string(),
    versionId: v.id("printVersions"),
    color: v.string(),
    tolerance: v.number(),
    fromEdges: v.boolean(),
  },
  returns: v.id("printVersions"),
  handler: async (ctx, args) => {
    const { user, work } = await requirePrinter(ctx, args.cr);
    requireUnlocked(work);
    const parent = await readyVersion(ctx, work, args.versionId);
    const rgb = parseHex(args.color);
    if (!rgb) throw new ConvexError({ code: "BAD_COLOR", message: "Pick a color to knock out." });
    const versionId = await ctx.db.insert("printVersions", {
      workId: work._id,
      number: await nextVersion(ctx, work),
      parentId: parent._id,
      op: "knockout",
      status: "pending",
      params: { color: args.color.toLowerCase(), tolerance: clampTolerance(args.tolerance), fromEdges: args.fromEdges },
      upscaled: parent.upscaled,
      remixSourceId: parent.remixSourceId,
      charged: 0,
      createdBy: user._id,
    });
    await ctx.scheduler.runAfter(0, internal.printTools.makeVersion, { versionId });
    return versionId;
  },
});

// "Upscale for print": Topaz Transparent, 4x, 2 credits (the owner is exempt). One fal submission
// per attempt (convex/upscale.ts); a failed attempt gives the credits back. Each attempt holds its
// worst-case fal cost against today's budget (provider "fal", convex/lib/budget.ts) until it
// settles at the price of what fal returned, or is released because nothing reached fal.
export const upscale = mutation({
  args: { cr: v.string(), versionId: v.id("printVersions") },
  returns: v.union(
    v.object({ versionId: v.id("printVersions") }),
    v.object({ refused: v.union(v.literal("NO_CREDITS"), v.literal("DISABLED"), v.literal("BUDGET")) }),
  ),
  handler: async (ctx, args) => {
    const { user, work } = await requirePrinter(ctx, args.cr);
    requireUnlocked(work);
    if (!(await flagEnabled(ctx, "gen.upscale"))) return { refused: "DISABLED" as const };
    const parent = await readyVersion(ctx, work, args.versionId);
    if (parent.upscaled) throw new ConvexError({ code: "ALREADY_UPSCALED", message: "This version is already upscaled." });
    if (Math.max(parent.width, parent.height) > UPSCALE_MAX_SIDE) {
      throw new ConvexError({ code: "TOO_LARGE", message: `Upscaling takes images up to ${UPSCALE_MAX_SIDE} px.` });
    }
    if (!parent.metrics.hasAlpha) {
      throw new ConvexError({ code: "NO_ALPHA", message: "Knock out the background first: the upscale keeps transparency." });
    }
    const versions = await versionsOf(ctx, work._id);
    if (versions.some((version) => version.op === "upscale" && version.status === "pending")) {
      throw new ConvexError({ code: "BUSY", message: "An upscale is already running." });
    }
    const owner = isOwner(user);
    if (!owner && (await creditBalance(ctx, user._id)) < UPSCALE_CREDITS) return { refused: "NO_CREDITS" as const };
    // The owner's upscales count toward the budget too.
    const now = Date.now();
    const worstCaseCents = topazWorstCaseCents(parent.width, parent.height);
    if (!(await hasRoom(ctx, "fal", worstCaseCents, now))) return { refused: "BUDGET" as const };
    const charged = owner ? 0 : UPSCALE_CREDITS;
    const versionId = await ctx.db.insert("printVersions", {
      workId: work._id,
      number: await nextVersion(ctx, work),
      parentId: parent._id,
      op: "upscale",
      status: "pending",
      upscaled: true,
      // A remix of this work starts from the last version before the upscale.
      remixSourceId: parent._id,
      fal: { state: "queued", polls: 0 },
      charged,
      createdBy: user._id,
    });
    await openReservation(
      ctx,
      { attemptKind: "upscale", attemptId: versionId, provider: "fal", userId: user._id, credits: charged, worstCaseCents },
      now,
    );
    if (!owner) {
      await ctx.db.insert("creditLedger", {
        userId: user._id,
        kind: "settle",
        amount: -UPSCALE_CREDITS,
        note: `print upscale ${versionId}`,
      });
    }
    await ctx.scheduler.runAfter(0, internal.upscale.submit, { versionId });
    return { versionId };
  },
});

export const savePlacement = mutation({
  args: {
    cr: v.string(),
    versionId: v.id("printVersions"),
    xIn: v.number(),
    yIn: v.number(),
    widthIn: v.number(),
    color: v.string(),
  },
  returns: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number() }),
  handler: async (ctx, args) => {
    const { user, work } = await requirePrinter(ctx, args.cr);
    requireUnlocked(work);
    const version = await readyVersion(ctx, work, args.versionId);
    if (shirtColor(args.color).name !== args.color) {
      throw new ConvexError({ code: "BAD_COLOR", message: "That shirt color isn't offered." });
    }
    const placed = clampPlacement(
      { xIn: args.xIn, yIn: args.yIn, widthIn: args.widthIn },
      aspectOf(version.width, version.height),
      PRINT_PRODUCT,
    );
    const existing = await placementOf(ctx, work._id);
    const row = { versionId: version._id, ...placed, color: args.color, updatedBy: user._id, updatedAt: Date.now() };
    if (existing) {
      if (existing.render?.status === "rendering") {
        throw new ConvexError({ code: "BUSY", message: "The print file is being made." });
      }
      await ctx.db.patch("printPlacements", existing._id, { ...row, render: undefined });
    } else {
      await ctx.db.insert("printPlacements", { workId: work._id, ...row });
    }
    return placed;
  },
});

// Makes the print file from the saved placement, once the print check passes.
export const render = mutation({
  args: { cr: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { work } = await requirePrinter(ctx, args.cr);
    requireUnlocked(work);
    const placement = await placementOf(ctx, work._id);
    if (!placement) throw new ConvexError({ code: "NO_PLACEMENT", message: "Place the design first." });
    if (placement.render?.status === "rendering" && Date.now() - placement.render.startedAt < RENDER_STALE_MS) {
      throw new ConvexError({ code: "BUSY", message: "The print file is being made." });
    }
    const version = await readyVersion(ctx, work, placement.versionId);
    const check = printCheck({ width: version.width, height: version.height, ...version.metrics }, placement, PRINT_PRODUCT);
    const refusal = check.items.find((item) => item.status === "refuse");
    if (refusal) throw new ConvexError({ code: "NOT_PRINTABLE", message: refusal.label });
    await ctx.db.patch("printPlacements", placement._id, { render: { status: "rendering", startedAt: Date.now() } });
    await ctx.scheduler.runAfter(0, internal.printTools.render, { workId: work._id });
    return null;
  },
});

// ---- For the actions in printTools.ts and upscale.ts ----

const jobValidator = v.union(
  v.null(),
  v.object({
    version: v.any(),
    parent: v.any(),
    family: v.number(),
    expression: v.number(),
  }),
);

export const versionJob = internalQuery({
  args: { versionId: v.id("printVersions") },
  returns: jobValidator,
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version) return null;
    const work = await ctx.db.get("works", version.workId);
    if (!work) return null;
    const parent = version.parentId ? await ctx.db.get("printVersions", version.parentId) : null;
    return { version, parent, family: work.crFamily, expression: work.crExpression };
  },
});

export const recordVersion = internalMutation({
  args: {
    versionId: v.id("printVersions"),
    key: v.string(),
    previewKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    metrics: metricsValidator,
    latencyMs: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version || version.status !== "pending") return false;
    if (version.op === "upscale") {
      // fal bills Topaz by the size of what it returns; a bigger image than reserved for is an
      // overage, and that turns upscaling off until an admin turns it back on.
      await closeReservation(ctx, version._id, { kind: "settle", actualCents: topazCents(args.width, args.height), reason: "done" });
    }
    await ctx.db.patch("printVersions", version._id, {
      status: "ready",
      key: args.key,
      previewKey: args.previewKey,
      sha256: args.sha256 ?? version.sha256,
      width: args.width,
      height: args.height,
      metrics: args.metrics,
      finishedAt: Date.now(),
      ...(version.fal && args.latencyMs !== undefined ? { fal: { ...version.fal, latencyMs: args.latencyMs } } : {}),
    });
    return true;
  },
});

// Marks a version failed, gives back what it was charged, and closes its budget reservation (once:
// only a pending version fails). Without a spend, an upscale still waiting to be claimed is
// released and one that was claimed is settled at its worst case, since fal may have the job.
export async function failPrintVersion(ctx: MutationCtx, version: Doc<"printVersions">, error: string, spend?: Spend) {
  if (version.status !== "pending") return false;
  await ctx.db.patch("printVersions", version._id, {
    status: "failed",
    error: error.slice(0, 300),
    finishedAt: Date.now(),
  });
  if (version.charged > 0) {
    await ctx.db.insert("creditLedger", {
      userId: version.createdBy,
      kind: "refund_credit",
      amount: version.charged,
      note: `print upscale ${version._id} failed`,
    });
  }
  if (version.op === "upscale") {
    const sent = version.fal !== undefined && version.fal.state !== "queued";
    await closeReservation(ctx, version._id, spend ?? (sent ? { kind: "settle", reason: "failed" } : { kind: "release", reason: "not sent" }));
  }
  return true;
}

export const failVersion = internalMutation({
  args: { versionId: v.id("printVersions"), error: v.string(), spend: v.optional(spendValidator) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version) return false;
    return await failPrintVersion(ctx, version, args.error, args.spend);
  },
});

// The one claim on an upscale's fal submission. True exactly once per version, so however often
// the submit action runs, it posts once. It's also the budget's dispatch check: an attempt whose
// reservation is no longer open (the sweeper gave up on it) fails instead of posting.
export const claimSubmission = internalMutation({
  args: { versionId: v.id("printVersions") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version || version.status !== "pending" || version.fal?.state !== "queued") return false;
    if (!(await authorizeDispatch(ctx, version._id, Date.now()))) {
      await failPrintVersion(ctx, version, EXPIRED_MESSAGE, { kind: "release", reason: "not authorized" });
      return false;
    }
    await ctx.db.patch("printVersions", version._id, { fal: { ...version.fal, state: "submitting" } });
    return true;
  },
});

// Saves fal's request ID before any polling starts.
export const recordSubmission = internalMutation({
  args: { versionId: v.id("printVersions"), requestId: v.string(), statusUrl: v.string(), responseUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version?.fal || version.fal.state !== "submitting" || version.fal.requestId) {
      throw new Error("Submission recorded twice.");
    }
    await ctx.db.patch("printVersions", version._id, {
      fal: {
        ...version.fal,
        state: "submitted",
        requestId: args.requestId,
        statusUrl: args.statusUrl,
        responseUrl: args.responseUrl,
        submittedAt: Date.now(),
      },
    });
    return null;
  },
});

export const notePoll = internalMutation({
  args: { versionId: v.id("printVersions") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!version?.fal) return 0;
    const polls = version.fal.polls + 1;
    await ctx.db.patch("printVersions", version._id, { fal: { ...version.fal, polls } });
    return polls;
  },
});

export const renderJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      family: v.number(),
      expression: v.number(),
      locked: v.boolean(),
      placement: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number(), color: v.string() }),
      createdBy: v.id("users"),
      version: v.object({
        id: v.id("printVersions"),
        key: v.string(),
        width: v.number(),
        height: v.number(),
        metrics: metricsValidator,
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work) return null;
    const placement = await placementOf(ctx, work._id);
    if (!placement) return null;
    const version = await ctx.db.get("printVersions", placement.versionId);
    if (!version?.key || !version.width || !version.height || !version.metrics) return null;
    return {
      family: work.crFamily,
      expression: work.crExpression,
      locked: Boolean(work.printKey),
      placement: { xIn: placement.xIn, yIn: placement.yIn, widthIn: placement.widthIn, color: placement.color },
      createdBy: placement.updatedBy,
      version: { id: version._id, key: version.key, width: version.width, height: version.height, metrics: version.metrics },
    };
  },
});

// Records the print file. works.printKey and printSha256 are set here once and never again.
export const recordRender = internalMutation({
  args: {
    workId: v.id("works"),
    versionId: v.id("printVersions"),
    key: v.string(),
    previewKey: v.optional(v.string()),
    sha256: v.string(),
    widthPx: v.number(),
    heightPx: v.number(),
    placement: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number(), heightIn: v.number() }),
    rect: v.object({ left: v.number(), top: v.number(), width: v.number(), height: v.number() }),
    color: v.string(),
    dpi: v.number(),
    grade: v.union(v.literal("good"), v.literal("great")),
    coverage: v.number(),
    haze: v.number(),
    warnings: v.array(v.string()),
    createdBy: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.printKey || work.printSha256) return false;
    if (await printFileOf(ctx, work._id)) return false;
    const { workId, ...file } = args;
    await ctx.db.insert("printFiles", { workId, product: PRINT_PRODUCT.key, ...file });
    await ctx.db.patch("works", work._id, { printKey: args.key, printSha256: args.sha256 });
    const placement = await placementOf(ctx, work._id);
    if (placement) await ctx.db.patch("printPlacements", placement._id, { render: undefined });
    return true;
  },
});

export const failRender = internalMutation({
  args: { workId: v.id("works"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const placement = await placementOf(ctx, args.workId);
    if (placement) {
      await ctx.db.patch("printPlacements", placement._id, {
        render: { status: "failed", error: args.error.slice(0, 300), startedAt: placement.render?.startedAt ?? Date.now() },
      });
    }
    return null;
  },
});
