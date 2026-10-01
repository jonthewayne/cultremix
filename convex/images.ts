import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { isDevDeployment, publicUrl } from "./lib/r2";
import { IMAGE_KEY, requireMember } from "./studio";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// A member's images: uploads, their own designs used as images, and remix sources. Each one
// gets a vision model's notes once (convex/imageNotes.ts), which the studio's prompts reuse.

const analysisState = v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"));

// What the browser gets for an image: where it is and whether its notes are ready. The notes,
// summary, and kind stay on the server, where only the prompt builder reads them.
export const imageView = v.object({
  imageId: v.id("userImages"),
  key: v.string(),
  url: v.optional(v.string()),
  analysis: analysisState,
  styleAt: v.optional(v.number()),
});

function toView(image: Doc<"userImages">) {
  return {
    imageId: image._id,
    key: image.key,
    url: publicUrl(image.key),
    analysis: image.analysis,
    styleAt: image.styleAt,
  };
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
  const imageId = await ctx.db.insert("userImages", {
    ownerId,
    key: args.key,
    sha256: args.sha256,
    width: args.width,
    height: args.height,
    analysis: "pending",
    usedAt: now,
    styleAt: args.asStyle ? now : undefined,
  });
  await ctx.scheduler.runAfter(0, internal.imageNotes.analyze, { imageId });
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

// An upload this member already has, so the same file isn't stored twice.
export const findUpload = internalQuery({
  args: { authId: v.string(), sha256: v.string() },
  returns: v.union(v.null(), v.object({ key: v.string() })),
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
    return image ? { key: image.key } : null;
  },
});

// A design from the studio or a published work's art, brought in as an image.
export const adopt = mutation({
  args: { key: v.string(), asStyle: v.optional(v.boolean()) },
  returns: v.id("userImages"),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    if (!IMAGE_KEY.test(args.key) && !(isDevDeployment() && args.key.startsWith("fake:"))) {
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

// The style picker: style images first, then the member's other recent images.
export const library = query({
  args: {},
  returns: v.object({ styles: v.array(imageView), recent: v.array(imageView) }),
  handler: async (ctx) => {
    const user = await getViewerUser(ctx);
    if (!user) return { styles: [], recent: [] };
    const styles = await ctx.db
      .query("userImages")
      .withIndex("by_owner_style", (q) => q.eq("ownerId", user._id).gt("styleAt", 0))
      .order("desc")
      .take(24);
    const styleIds = new Set(styles.map((image) => image._id));
    const recent = await ctx.db
      .query("userImages")
      .withIndex("by_owner_used", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(48);
    return {
      styles: styles.map(toView),
      recent: recent.filter((image) => !styleIds.has(image._id)).map(toView),
    };
  },
});

// Live state of the images in the studio (analyzing, captured, or failed).
export const status = query({
  args: { imageIds: v.array(v.id("userImages")) },
  returns: v.array(imageView),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return [];
    const views = [];
    for (const imageId of args.imageIds.slice(0, 12)) {
      const image = await ctx.db.get("userImages", imageId);
      if (image && image.ownerId === user._id) views.push(toView(image));
    }
    return views;
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

export const analysisJob = internalQuery({
  args: { imageId: v.id("userImages") },
  returns: v.union(v.null(), v.object({ key: v.string(), analysis: analysisState })),
  handler: async (ctx, args) => {
    const image = await ctx.db.get("userImages", args.imageId);
    return image ? { key: image.key, analysis: image.analysis } : null;
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
