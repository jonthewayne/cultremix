import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireMember } from "./studio";
import { formatCr, parseCr } from "./lib/r2";
import { pickLook } from "./lib/prompts";
import { publishPlacement } from "./lib/lineage";
import { recordPublishActivity } from "./lib/social";
import {
  BUDGET_RESTING,
  closeReservation,
  hasRoom,
  imageProviderSetting,
  openReservation,
  reservationFor,
  spendValidator,
} from "./lib/budget";
import { photoWorstCaseCents, qualityOf } from "./lib/pricing";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const lookValidator = v.object({ casting: v.string(), pose: v.string(), world: v.string() });

// Castings and settings of the most recently updated shoots, newest first.
async function recentLooks(ctx: MutationCtx) {
  const shoots = await ctx.db.query("shoots").order("desc").take(50);
  return shoots
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10)
    .map((shoot) => ({ casting: shoot.castingNote, world: shoot.world }));
}

// Holds one model photo's worst case against today's budget when photos go through the CultRemix
// Gateway. Returns the attempt's id (null when photos aren't budgeted), or "resting" when the day's
// budget can't take it. The action sends the call right away, so it counts as dispatched.
async function reservePhoto(
  ctx: MutationCtx,
  shootId: Id<"shoots">,
  userId: Id<"users"> | undefined,
  now: number,
): Promise<string | null | "resting"> {
  if (imageProviderSetting() !== "gateway") return null;
  const worstCaseCents = photoWorstCaseCents(qualityOf(process.env.PHOTO_QUALITY, "medium"));
  if (!(await hasRoom(ctx, "gateway", worstCaseCents, now))) return "resting";
  // A shoot can be reshot, so each photo call gets its own attempt id (two in one millisecond too).
  let attemptId = `photo:${shootId}:${now}`;
  for (let n = 2; await reservationFor(ctx, attemptId); n++) attemptId = `photo:${shootId}:${now}:${n}`;
  await openReservation(ctx, {
    attemptKind: "photo",
    attemptId,
    shootId,
    provider: "gateway",
    userId,
    credits: 0,
    worstCaseCents,
    dispatched: true,
  }, now);
  return attemptId;
}

async function nextFamily(ctx: MutationCtx) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "crFamily"))
    .unique();
  if (!counter) {
    await ctx.db.insert("counters", { name: "crFamily", next: 102 });
    return 101;
  }
  await ctx.db.patch("counters", counter._id, { next: counter.next + 1 });
  return counter.next;
}

// Publishes a tile: allocates the CR number (a new family for an original or a
// fork, the family's next expression for a variation), inserts the work, and starts the
// asset copy and model photo. Idempotent by requestId and by generation.
export const quick = mutation({
  args: {
    requestId: v.string(),
    generationId: v.id("generations"),
    title: v.optional(v.string()),
    // For a remix: a variation joins the family (the default); a fork starts a new one.
    remixKind: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
  },
  returns: v.object({ workId: v.id("works"), cr: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const byRequest = await ctx.db
      .query("works")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (byRequest) {
      return { workId: byRequest._id, cr: formatCr(byRequest.crFamily, byRequest.crExpression) };
    }
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id || generation.kind === "shoot") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tile not found." });
    }
    if (generation.status !== "succeeded" || !generation.fullKey) {
      throw new ConvexError({ code: "NOT_READY", message: "That tile is not ready." });
    }
    const mine = await ctx.db
      .query("works")
      .withIndex("by_creator", (q) => q.eq("creatorId", user._id))
      .collect();
    const already = mine.find((work) => work.generationId === generation._id);
    if (already) {
      return { workId: already._id, cr: formatCr(already.crFamily, already.crExpression) };
    }
    const batch = await ctx.db.get("batches", generation.batchId);
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    if (!batch || !session) throw new ConvexError({ code: "NOT_FOUND", message: "Tile not found." });
    const title = args.title?.trim().slice(0, 80) || undefined;

    // A remix is a variation (the parent's family, next expression) or a fork (a new family,
    // expression 1, crediting the parent). The parent must still have its public record.
    const parent = session.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    if (session.remixOfWorkId && (!parent || (parent.status !== "published" && parent.status !== "withdrawn"))) {
      throw new ConvexError({ code: "PARENT_UNAVAILABLE", message: "The design you remixed isn't published anymore." });
    }
    const placement = publishPlacement(
      parent ? { id: parent._id, family: parent.crFamily } : null,
      args.remixKind ?? "variation",
    );
    let crFamily: number;
    let crExpression: number;
    if (placement.family !== "new") {
      crFamily = placement.family;
      const family = await ctx.db
        .query("crFamilies")
        .withIndex("by_family", (q) => q.eq("family", crFamily))
        .unique();
      if (family) {
        crExpression = family.nextExpression;
        await ctx.db.patch("crFamilies", family._id, { nextExpression: crExpression + 1 });
      } else {
        crExpression = parent!.crExpression + 1;
        await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: crExpression + 1 });
      }
    } else {
      crFamily = await nextFamily(ctx);
      crExpression = 1;
    }

    const startsFamily = placement.family === "new";
    const workId = await ctx.db.insert("works", {
      crFamily,
      crExpression,
      creatorId: user._id,
      kind: placement.kind,
      parentWorkId: parent?._id,
      // Direct remixes are listed by effective parent (convex/lineage.ts).
      effectiveParentWorkId: parent?._id,
      familyRootId: startsFamily ? undefined : (parent!.familyRootId ?? parent!._id),
      generationId: generation._id,
      requestId: args.requestId,
      title,
      backgroundColor: batch.backgroundColor,
      status: "preparing",
    });
    if (startsFamily) {
      await ctx.db.patch("works", workId, { familyRootId: workId });
      await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: 2, rootWorkId: workId });
    }
    await ctx.scheduler.runAfter(0, internal.imageGen.publishAssets, { workId });
    return { workId, cr: formatCr(crFamily, crExpression) };
  },
});

export const assetJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({ fullKey: v.string(), backgroundColor: v.string(), crFamily: v.number(), crExpression: v.number() }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    const generation = await ctx.db.get("generations", work.generationId);
    if (!generation?.fullKey) return null;
    return {
      fullKey: generation.fullKey,
      backgroundColor: work.backgroundColor,
      crFamily: work.crFamily,
      crExpression: work.crExpression,
    };
  },
});

export const markPublished = internalMutation({
  args: { workId: v.id("works"), artKey: v.string(), contentHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      shootId: v.id("shoots"),
      look: lookValidator,
      // The photo's reservation; resting when the day's budget can't take it (no photo today).
      attemptId: v.optional(v.string()),
      resting: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    const now = Date.now();
    await ctx.db.patch("works", work._id, {
      status: "published",
      publishedAt: now,
      artKey: args.artKey,
      contentHash: args.contentHash,
    });
    // The Following feed and profiles read this event (convex/lib/social.ts).
    await recordPublishActivity(ctx, { ...work, status: "published", publishedAt: now });
    const look = pickLook(work._id, await recentLooks(ctx));
    const shootId = await ctx.db.insert("shoots", {
      workId: work._id,
      status: "running",
      requestedBy: work.creatorId,
      createdAt: now,
      updatedAt: now,
      castingNote: look.casting,
      pose: look.pose,
      world: look.world,
    });
    await ctx.db.insert("shootPhotos", {
      shootId,
      workId: work._id,
      index: 1,
      state: "pending",
    });
    // Notes on the art for everyone who remixes it (imageNotes.analyzeWork).
    await ctx.scheduler.runAfter(0, internal.imageNotes.analyzeWork, { workId: work._id });
    const attempt = await reservePhoto(ctx, shootId, work.creatorId, now);
    if (attempt === "resting") {
      // The work is published; its model photo waits for a reshoot.
      await failShootPhoto(ctx, shootId, BUDGET_RESTING);
      return { shootId, look, resting: true };
    }
    return { shootId, look, attemptId: attempt ?? undefined };
  },
});

// Starts a new model photo for a published work with a different casting. The
// current photo stays up until the new one is recorded.
export const beginReshoot = internalMutation({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      shootId: v.id("shoots"),
      artKey: v.string(),
      backgroundColor: v.string(),
      look: lookValidator,
      crFamily: v.number(),
      crExpression: v.number(),
      // The photo shown now; the new one takes the next photo number.
      photoKey: v.optional(v.string()),
      attemptId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const parsed = parseCr(args.cr);
    if (!parsed) return null;
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) =>
        q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
      )
      .unique();
    if (!work || work.status !== "published" || !work.artKey) return null;
    const now = Date.now();
    // Checked before anything changes, so a refused reshoot leaves the shoot as it was.
    const photoCents = photoWorstCaseCents(qualityOf(process.env.PHOTO_QUALITY, "medium"));
    if (imageProviderSetting() === "gateway" && !(await hasRoom(ctx, "gateway", photoCents, now))) {
      console.log("reshoot refused: the daily budget is spent", args.cr);
      return null;
    }
    const existing = await ctx.db
      .query("shoots")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .first();
    const look = pickLook(`${work._id}:${now}`, [
      { casting: existing?.castingNote, world: existing?.world },
      ...(await recentLooks(ctx)),
    ]);
    const fields = { castingNote: look.casting, pose: look.pose, world: look.world };
    let shootId = existing?._id;
    if (shootId) {
      await ctx.db.patch("shoots", shootId, { ...fields, updatedAt: now });
    } else {
      shootId = await ctx.db.insert("shoots", {
        workId: work._id,
        status: "running",
        requestedBy: work.creatorId,
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
    }
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_shoot_index", (q) => q.eq("shootId", shootId).eq("index", 1))
      .unique();
    if (!photo) {
      await ctx.db.insert("shootPhotos", { shootId, workId: work._id, index: 1, state: "pending" });
    }
    const attempt = await reservePhoto(ctx, shootId, undefined, now);
    return {
      attemptId: attempt === null || attempt === "resting" ? undefined : attempt,
      shootId,
      artKey: work.artKey,
      backgroundColor: work.backgroundColor,
      look,
      crFamily: work.crFamily,
      crExpression: work.crExpression,
      photoKey: photo?.publicKey,
    };
  },
});

// Reshoots every published work's model photo, a couple of seconds apart:
// bunx convex run publish:reshootAll
export const reshootAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .collect();
    for (const [i, work] of works.entries()) {
      await ctx.scheduler.runAfter(i * 3000, internal.imageGen.reshoot, {
        cr: formatCr(work.crFamily, work.crExpression),
      });
    }
    return works.length;
  },
});

export const markAssetFailed = internalMutation({
  args: { workId: v.id("works"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    await ctx.db.patch("works", work._id, { status: "asset_failed", assetError: args.error });
    return null;
  },
});

export const recordPhoto = internalMutation({
  args: {
    shootId: v.id("shoots"),
    publicKey: v.string(),
    // The photo call's reservation and what it cost (convex/lib/paidAttempts.ts).
    attemptId: v.optional(v.string()),
    spend: v.optional(spendValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.attemptId) await closeReservation(ctx, args.attemptId, args.spend ?? { kind: "settle" });
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_shoot_index", (q) => q.eq("shootId", args.shootId).eq("index", 1))
      .unique();
    if (photo) {
      await ctx.db.patch("shootPhotos", photo._id, { state: "succeeded", publicKey: args.publicKey });
    }
    await ctx.db.patch("shoots", args.shootId, { status: "done", updatedAt: Date.now() });
    return null;
  },
});

export const recordPhotoFailed = internalMutation({
  args: {
    shootId: v.id("shoots"),
    reason: v.string(),
    attemptId: v.optional(v.string()),
    spend: v.optional(spendValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.attemptId) await closeReservation(ctx, args.attemptId, args.spend ?? { kind: "settle" });
    await failShootPhoto(ctx, args.shootId, args.reason);
    return null;
  },
});

export async function failShootPhoto(ctx: MutationCtx, shootId: Id<"shoots">, reason: string) {
  const photo = await ctx.db
    .query("shootPhotos")
    .withIndex("by_shoot_index", (q) => q.eq("shootId", shootId).eq("index", 1))
    .unique();
  if (photo) {
    await ctx.db.patch("shootPhotos", photo._id, { state: "failed", reason });
  }
  await ctx.db.patch("shoots", shootId, {
    status: "failed",
    reason: "photo_failed",
    updatedAt: Date.now(),
  });
}
