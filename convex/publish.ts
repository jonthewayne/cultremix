import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireMember } from "./studio";
import { formatCr } from "./lib/r2";
import type { MutationCtx } from "./_generated/server";

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

// Publishes a tile: allocates the CR number (a new family for an original, the
// family's next expression for a remix), inserts the work, and starts the
// asset copy and model photo. Idempotent by requestId and by generation.
export const quick = mutation({
  args: {
    requestId: v.string(),
    generationId: v.id("generations"),
    title: v.optional(v.string()),
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

    const parent = session.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    let crFamily: number;
    let crExpression: number;
    if (parent && parent.status === "published") {
      crFamily = parent.crFamily;
      const family = await ctx.db
        .query("crFamilies")
        .withIndex("by_family", (q) => q.eq("family", parent.crFamily))
        .unique();
      if (family) {
        crExpression = family.nextExpression;
        await ctx.db.patch("crFamilies", family._id, { nextExpression: crExpression + 1 });
      } else {
        crExpression = parent.crExpression + 1;
        await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: crExpression + 1 });
      }
    } else {
      crFamily = await nextFamily(ctx);
      crExpression = 1;
    }

    const workId = await ctx.db.insert("works", {
      crFamily,
      crExpression,
      creatorId: user._id,
      kind: parent ? "variation" : "original",
      parentWorkId: parent?._id,
      familyRootId: parent ? (parent.familyRootId ?? parent._id) : undefined,
      generationId: generation._id,
      requestId: args.requestId,
      title,
      backgroundColor: batch.backgroundColor,
      status: "preparing",
    });
    if (!parent) {
      await ctx.db.patch("works", workId, { familyRootId: workId });
      await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: 2, rootWorkId: workId });
    }
    await ctx.scheduler.runAfter(0, internal.imageGen.publishAssets, { workId });
    return { workId, cr: formatCr(crFamily, crExpression) };
  },
});

export const assetJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(v.null(), v.object({ fullKey: v.string(), backgroundColor: v.string() })),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    const generation = await ctx.db.get("generations", work.generationId);
    if (!generation?.fullKey) return null;
    return { fullKey: generation.fullKey, backgroundColor: work.backgroundColor };
  },
});

export const markPublished = internalMutation({
  args: { workId: v.id("works"), artKey: v.string(), contentHash: v.string() },
  returns: v.union(v.null(), v.id("shoots")),
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
    const shootId = await ctx.db.insert("shoots", {
      workId: work._id,
      status: "running",
      requestedBy: work.creatorId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("shootPhotos", {
      shootId,
      workId: work._id,
      index: 1,
      state: "pending",
    });
    return shootId;
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
