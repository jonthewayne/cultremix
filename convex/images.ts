import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { imageUrlReader } from "./lib/imageUrls";
import { EMPTY_PAGE, cappedPage } from "./lib/paging";
import { isDevDeployment } from "./lib/r2";
import { proposeOnNotes } from "./remixFields";
import { requireMember } from "./studio";
import { isImageKey } from "./lib/sizes";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// A member's images: uploads, their own designs used as images, and remix sources. Each one
// gets a vision model's notes once (convex/imageNotes.ts), which the studio's prompts reuse.

const analysisState = v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"));

// What the browser gets for an image: where it is and whether its notes are ready. The notes,
// summary, and kind stay on the server, where only the prompt builder reads them.
export const imageView = v.object({
  imageId: v.id("userImages"),
  key: v.string(),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  analysis: analysisState,
  styleAt: v.optional(v.number()),
});

async function toViews(ctx: QueryCtx, images: Array<Doc<"userImages">>) {
  const urls = imageUrlReader(ctx);
  const views = [];
  for (const image of images) {
    const { url, thumbUrl } = await urls(image.key);
    views.push({ imageId: image._id, key: image.key, url, thumbUrl, analysis: image.analysis, styleAt: image.styleAt });
  }
  return views;
}

// Saves an image once per owner (by content hash, else by storage key), refreshes when it was
// last used, and starts its notes when there are none yet.
async function saveImage(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  args: { key: string; sha256?: string; width?: number; height?: number; asStyle?: boolean },
) {
  const now = Date.now();
  const bySha = args.sha256
    ? await ctx.db
        .query("userImages")
        .withIndex("by_owner_sha", (q) => q.eq("ownerId", ownerId).eq("sha256", args.sha256))
        .first()
    : null;
  const existing =
    bySha ??
    (await ctx.db
      .query("userImages")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", args.key))
      .first());
  if (existing) {
    const retry = existing.analysis === "failed";
    await ctx.db.patch("userImages", existing._id, {
      usedAt: now,
      ...(args.asStyle ? { styleAt: now } : {}),
      ...(retry ? { analysis: "pending" as const, analysisError: undefined } : {}),
    });
    if (retry) await ctx.scheduler.runAfter(0, internal.imageNotes.analyze, { imageId: existing._id });
    return existing._id;
  }
  // A published design (usually a remix source) brings the notes written when it was published.
  const work = await ctx.db
    .query("works")
    .withIndex("by_artKey", (q) => q.eq("artKey", args.key))
    .first();
  const published = work?.notes
    ? { analysis: "ready" as const, notes: work.notes, summary: work.notesSummary, kind: work.notesKind, analysisModel: work.notesModel }
    : { analysis: "pending" as const };
  const imageId = await ctx.db.insert("userImages", {
    ownerId,
    key: args.key,
    sha256: args.sha256,
    width: args.width,
    height: args.height,
    ...published,
    usedAt: now,
    styleAt: args.asStyle ? now : undefined,
  });
  if (published.analysis === "pending") await ctx.scheduler.runAfter(0, internal.imageNotes.analyze, { imageId });
  return imageId;
}

// imageGen.uploadInspiration stores the bytes, then records the image here.
export const recordUpload = internalMutation({
  args: {
    authId: v.string(),
    key: v.string(),
    sha256: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    asStyle: v.boolean(),
  },
  returns: v.id("userImages"),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", args.authId))
      .unique();
    if (!user?.username) {
      throw new ConvexError({ code: "NEEDS_USERNAME", message: "Pick a username first." });
    }
    return await saveImage(ctx, user._id, args);
  },
});

// The member (whose folder a new upload goes in) and the key of an upload they already have with
// the same SHA-256, so the same file isn't stored twice.
export const findUpload = internalQuery({
  args: { authId: v.string(), sha256: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), key: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", args.authId))
      .unique();
    if (!user) return null;
    const image = await ctx.db
      .query("userImages")
      .withIndex("by_owner_sha", (q) => q.eq("ownerId", user._id).eq("sha256", args.sha256))
      .first();
    return { userId: user._id, key: image?.key };
  },
});

// A design from the studio or a published work's art, brought in as an image.
export const adopt = mutation({
  args: { key: v.string(), asStyle: v.optional(v.boolean()) },
  returns: v.id("userImages"),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    if (!isImageKey(args.key) && !(isDevDeployment() && args.key.startsWith("fake:"))) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "That image is not available." });
    }
    return await saveImage(ctx, user._id, { key: args.key, asStyle: args.asStyle });
  },
});

// Added to the style mix: the style picker lists it with the member's style images.
export const markStyle = mutation({
  args: { imageId: v.id("userImages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const image = await ctx.db.get("userImages", args.imageId);
    if (!image || image.ownerId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Image not found." });
    }
    const now = Date.now();
    await ctx.db.patch("userImages", image._id, { styleAt: now, usedAt: now });
    return null;
  },
});

// The style picker's two lists, each a page at a time: the member's style images (most recently
// added to a mix first), then their other images (most recently used first). An image is in one
// list or the other, so a page of the second can hold fewer images than asked.
export const styleImages = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(imageView),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return EMPTY_PAGE;
    const result = await ctx.db
      .query("userImages")
      .withIndex("by_owner_style", (q) => q.eq("ownerId", user._id).gt("styleAt", 0))
      .order("desc")
      .paginate(cappedPage(args.paginationOpts, 48));
    return { ...result, page: await toViews(ctx, result.page) };
  },
});

export const recentImages = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(imageView),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return EMPTY_PAGE;
    const result = await ctx.db
      .query("userImages")
      .withIndex("by_owner_used", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .paginate(cappedPage(args.paginationOpts, 48));
    return { ...result, page: await toViews(ctx, result.page.filter((image) => !image.styleAt)) };
  },
});

// Live state of the images in the studio (analyzing, captured, or failed).
export const status = query({
  args: { imageIds: v.array(v.id("userImages")) },
  returns: v.array(imageView),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return [];
    const owned = [];
    for (const imageId of args.imageIds.slice(0, 12)) {
      const image = await ctx.db.get("userImages", imageId);
      if (image && image.ownerId === user._id) owned.push(image);
    }
    return await toViews(ctx, owned);
  },
});

// ---- Internal steps used by imageNotes.analyze ----

// Writes an image's notes again, after the notes prompt changes:
// bunx convex run images:reanalyze '{"imageId":"..."}'
export const reanalyze = internalMutation({
  args: { imageId: v.id("userImages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const image = await ctx.db.get("userImages", args.imageId);
    if (!image) return null;
    await ctx.db.patch("userImages", image._id, { analysis: "pending", analysisError: undefined });
    await ctx.scheduler.runAfter(0, internal.imageNotes.analyze, { imageId: image._id });
    return null;
  },
});

// Writes every member image's notes again after the notes prompt changes, 200 images per run, a
// second apart. A failed re-read keeps the notes the image had (saveAnalysis).
// bunx convex run images:reanalyzeAll   (again with '{"cursor":"..."}' while a cursor comes back)
export const reanalyzeAll = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("userImages").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let scheduled = 0;
    for (const image of page.page) {
      if (image.key.startsWith("fake:")) continue;
      await ctx.db.patch("userImages", image._id, { analysis: "pending", analysisError: undefined });
      await ctx.scheduler.runAfter(scheduled * 1000, internal.imageNotes.analyze, { imageId: image._id });
      scheduled++;
    }
    return { scheduled, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const analysisJob = internalQuery({
  args: { imageId: v.id("userImages") },
  returns: v.union(v.null(), v.object({ key: v.string(), analysis: analysisState })),
  handler: async (ctx, args) => {
    const image = await ctx.db.get("userImages", args.imageId);
    return image ? { key: image.key, analysis: image.analysis } : null;
  },
});

// ---- Notes on published works (imageNotes.analyzeWork) ----

const notesKind = v.optional(v.union(v.literal("photo"), v.literal("art")));

export const workNotesJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      artKey: v.string(),
      hasNotes: v.boolean(),
      // The creator's own notes for the same file, when they already wrote them in the studio.
      copy: v.optional(v.object({ model: v.string(), summary: v.optional(v.string()), kind: notesKind, notes: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work?.artKey || work.status !== "published") return null;
    const artKey = work.artKey;
    const own = await ctx.db
      .query("userImages")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", work.creatorId).eq("key", artKey))
      .first();
    const copy = own?.analysis === "ready" && own.notes
      ? { model: own.analysisModel ?? "unknown", summary: own.summary, kind: own.kind, notes: own.notes }
      : undefined;
    return { artKey, hasNotes: Boolean(work.notes), copy };
  },
});

export const saveWorkNotes = internalMutation({
  args: { workId: v.id("works"), model: v.string(), summary: v.optional(v.string()), kind: notesKind, notes: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.notes) return null;
    await ctx.db.patch("works", work._id, {
      notes: args.notes,
      notesSummary: args.summary,
      notesKind: args.kind,
      notesModel: args.model,
    });
    // The remixable words proposed from the notes' words; the creator adjusts them.
    await proposeOnNotes(ctx, work._id, args.notes);
    return null;
  },
});

export const worksWithoutNotes = internalQuery({
  args: {},
  returns: v.array(v.id("works")),
  handler: async (ctx) => {
    const ids = [];
    for await (const work of ctx.db.query("works").withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))) {
      if (!work.notes && work.artKey) ids.push(work._id);
    }
    return ids;
  },
});

export const saveAnalysis = internalMutation({
  args: {
    imageId: v.id("userImages"),
    model: v.string(),
    summary: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("photo"), v.literal("art"))),
    notes: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const image = await ctx.db.get("userImages", args.imageId);
    if (!image) return null;
    if (args.error || !args.notes) {
      // A failed re-read keeps the notes the image already had.
      if (image.notes) {
        await ctx.db.patch("userImages", image._id, { analysis: "ready" });
        return null;
      }
      await ctx.db.patch("userImages", image._id, {
        analysis: "failed",
        analysisModel: args.model,
        analysisError: (args.error ?? "No notes came back.").slice(0, 200),
      });
      return null;
    }
    await ctx.db.patch("userImages", image._id, {
      analysis: "ready",
      analysisModel: args.model,
      analysisError: undefined,
      summary: args.summary,
      kind: args.kind,
      notes: args.notes,
    });
    return null;
  },
});
