import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireMember } from "./studio";
import { formatCr, parseCr } from "./lib/r2";
import { pickLook } from "./lib/prompts";
import { publishPlacement } from "./lib/lineage";
import { recordPublishActivity } from "./lib/social";
import { DAILY_LIMIT, startPhotoShoot } from "./lib/photoShoots";
import type { Doc, Id } from "./_generated/dataModel";
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
  returns: v.union(v.null(), v.object({ shootId: v.id("shoots"), look: lookValidator })),
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
    // Notes on the art for everyone who remixes it (imageNotes.analyzeWork).
    await ctx.scheduler.runAfter(0, internal.imageNotes.analyzeWork, { workId: work._id });
    const look = pickLook(work._id, await recentLooks(ctx));
    // Past the creator's photo shoots for today, the work publishes and its photo waits;
    // the creator can try it again tomorrow (photos.retry).
    const allowed = await startPhotoShoot(ctx, work.creatorId, work._id, now);
    const shootId = await ctx.db.insert("shoots", {
      workId: work._id,
      status: allowed ? "running" : "failed",
      reason: allowed ? undefined : DAILY_LIMIT,
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
      state: allowed ? "pending" : "failed",
      reason: allowed ? undefined : DAILY_LIMIT,
    });
    if (!allowed) return null;
    return { shootId, look };
  },
});

// Starts a new model photo for a published work with a different casting. The
// current photo stays up until the new one is recorded. A reshoot counts against the
// creator's photo shoots for today unless skipLimit is set: photos.retry has already
// counted it, and reshootAll is the operator's own run.
export const beginReshoot = internalMutation({
  args: { cr: v.string(), skipLimit: v.optional(v.boolean()) },
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
    const existing = await ctx.db
      .query("shoots")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .first();
    const current = existing
      ? await ctx.db
          .query("shootPhotos")
          .withIndex("by_shoot_index", (q) => q.eq("shootId", existing._id).eq("index", 1))
          .unique()
      : null;
    if (!args.skipLimit && !(await startPhotoShoot(ctx, work.creatorId, work._id, now))) {
      // A photo that's up stays up; one that never came waits for tomorrow.
      if (current?.state !== "succeeded") await markWaiting(ctx, work, existing?._id ?? null, current?._id ?? null, now);
      return null;
    }
    const look = pickLook(`${work._id}:${now}`, [
      { casting: existing?.castingNote, world: existing?.world },
      ...(await recentLooks(ctx)),
    ]);
    const fields = { castingNote: look.casting, pose: look.pose, world: look.world };
    let shootId = existing?._id;
    if (shootId) {
      const running = current?.state === "succeeded" ? {} : { status: "running" as const, reason: undefined };
      await ctx.db.patch("shoots", shootId, { ...fields, ...running, updatedAt: now });
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
    if (!current) {
      await ctx.db.insert("shootPhotos", { shootId, workId: work._id, index: 1, state: "pending" });
    } else if (current.state === "failed") {
      // Pages show "Developing…" again while the retry runs.
      await ctx.db.patch("shootPhotos", current._id, { state: "pending", reason: undefined });
    }
    return {
      shootId,
      artKey: work.artKey,
      backgroundColor: work.backgroundColor,
      look,
      crFamily: work.crFamily,
      crExpression: work.crExpression,
      photoKey: current?.publicKey,
    };
  },
});

// Records that a work's model photo waits for its creator's next day.
async function markWaiting(
  ctx: MutationCtx,
  work: Doc<"works">,
  shootId: Id<"shoots"> | null,
  photoId: Id<"shootPhotos"> | null,
  now: number,
) {
  const waiting = { status: "failed" as const, reason: DAILY_LIMIT, updatedAt: now };
  const id =
    shootId ??
    (await ctx.db.insert("shoots", { workId: work._id, requestedBy: work.creatorId, createdAt: now, ...waiting }));
  if (shootId) await ctx.db.patch("shoots", shootId, waiting);
  if (photoId) await ctx.db.patch("shootPhotos", photoId, { state: "failed", reason: DAILY_LIMIT });
  else await ctx.db.insert("shootPhotos", { shootId: id, workId: work._id, index: 1, state: "failed", reason: DAILY_LIMIT });
}

// Reshoots every published work's model photo, a couple of seconds apart. An operator's
// run, so it doesn't count against members' photo shoots:
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
        skipLimit: true,
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
  args: { shootId: v.id("shoots"), publicKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
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
  args: { shootId: v.id("shoots"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_shoot_index", (q) => q.eq("shootId", args.shootId).eq("index", 1))
      .unique();
    // A failed reshoot leaves the photo that's up in place.
    if (photo?.state === "succeeded") return null;
    if (photo) {
      await ctx.db.patch("shootPhotos", photo._id, { state: "failed", reason: args.reason });
    }
    await ctx.db.patch("shoots", args.shootId, {
      status: "failed",
      reason: "photo_failed",
      updatedAt: Date.now(),
    });
    return null;
  },
});
