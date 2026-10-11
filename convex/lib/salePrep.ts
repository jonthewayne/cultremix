import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Called by the Print Studio after each version it records or fails for a work (measured, trimmed,
// knocked out, upscaled). When the work is being prepared for sale, convex/sales.ts takes the next
// step. Scheduled, so a problem there never undoes the Print Studio's own write.
export async function nudgeSalePrep(ctx: MutationCtx, workId: Id<"works">) {
  const rows = await ctx.db
    .query("shopProducts")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .take(20);
  if (rows.some((row) => row.status === "preparing")) await ctx.scheduler.runAfter(0, internal.sales.advance, { workId });
}

