import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { DAILY_LIMIT, DAILY_LIMIT_MESSAGE, shootsLeftToday, startPhotoShoot } from "./lib/photoShoots";
import { formatCr, parseCr } from "./lib/r2";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// A creator's own view of a work's model photo, and the way to try it again when it
// didn't come (a failed photo, or one waiting on the daily photo shoots setting).

async function photoOf(ctx: QueryCtx | MutationCtx, cr: string) {
  const parsed = parseCr(cr);
  if (!parsed) return null;
  const work = await ctx.db
    .query("works")
    .withIndex("by_family_expression", (q) =>
      q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
    )
    .unique();
  if (!work || work.status !== "published") return null;
  const shoot = await ctx.db
    .query("shoots")
    .withIndex("by_work", (q) => q.eq("workId", work._id))
    .first();
  const photo = shoot
    ? await ctx.db
        .query("shootPhotos")
        .withIndex("by_shoot_index", (q) => q.eq("shootId", shoot._id).eq("index", 1))
        .unique()
    : null;
  return { work, photo };
}

// Only for the work's creator; null for everyone else, signed out included.
export const mine = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      // True when the photo didn't come and can be tried again.
      canRetry: v.boolean(),
      // True when it's waiting for tomorrow's photo shoots.
      waiting: v.boolean(),
      // Photo shoots left today; null means no limit.
      shootsLeft: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return null;
    const found = await photoOf(ctx, args.cr);
    if (!found || found.work.creatorId !== viewer._id) return null;
    const canRetry = !found.photo || found.photo.state === "failed";
    return {
      canRetry,
      waiting: canRetry && found.photo?.reason === DAILY_LIMIT,
      shootsLeft: await shootsLeftToday(ctx, viewer._id, Date.now()),
    };
  },
});

// Starts the photo again for its creator, counting it against today's photo shoots.
export const retry = mutation({
  args: { cr: v.string() },
  returns: v.object({ started: v.boolean(), message: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
    const found = await photoOf(ctx, args.cr);
    if (!found || found.work.creatorId !== viewer._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Design not found." });
    }
    const { work, photo } = found;
    if (photo && photo.state !== "failed") return { started: false };
    if (!(await startPhotoShoot(ctx, viewer._id, work._id, Date.now()))) {
      if (photo) await ctx.db.patch("shootPhotos", photo._id, { reason: DAILY_LIMIT });
      return { started: false, message: DAILY_LIMIT_MESSAGE };
    }
    // Counted here, so the reshoot doesn't count it again.
    await ctx.scheduler.runAfter(0, internal.imageGen.reshoot, {
      cr: formatCr(work.crFamily, work.crExpression),
      skipLimit: true,
    });
    if (photo) await ctx.db.patch("shootPhotos", photo._id, { state: "pending", reason: undefined });
    return { started: true };
  },
});
