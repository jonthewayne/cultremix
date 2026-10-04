import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { recordPublishActivity } from "./lib/social";

// Writes activity events for works published before events existed, 100 at a time, and
// schedules itself until done. Safe to rerun: bunx convex run activity:backfill
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scanned: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    for (const work of result.page) {
      await recordPublishActivity(ctx, work);
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.activity.backfill, { cursor: result.continueCursor });
    }
    return { scanned: result.page.length, isDone: result.isDone };
  },
});
