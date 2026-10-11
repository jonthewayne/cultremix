import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { adminAllows, requireAdmin } from "./lib/adminAccess";
import { imageUrlReader } from "./lib/imageUrls";
import { notifyRestored, notifyTakedown } from "./lib/notifications";
import { formatCr } from "./lib/r2";
import { listingsOf } from "./lib/shopProduct";

// Taking a published design down (the plan's admin "withdraw work"; INV-27). Its page, feed rows,
// and shop go, since every public query reads only "published"; its listings pause and Shopify
// drafts its products, so nothing new sells and nothing new goes to print; and its creator is told
// why. Its CR number, lineage, and Monad record stay, so remixes of it still show where they came
// from. An admin can put it back up; selling it again takes an approval in Admin, For sale.

export const REASON_MAX = 280;

export const withdraw = mutation({
  args: { workId: v.id("works"), reason: v.string() },
  returns: v.object({ cr: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Only a published design can be taken down." });
    }
    const reason = args.reason.replace(/\s+/gu, " ").trim().slice(0, REASON_MAX);
    if (!reason) throw new ConvexError({ code: "NO_REASON", message: "Say why it's coming down. Its creator sees this." });
    const now = Date.now();
    await ctx.db.patch("works", work._id, { status: "withdrawn", withdrawnAt: now, withdrawnBy: admin._id, withdrawReason: reason });
    const productIds: Array<string> = [];
    for (const row of await listingsOf(ctx, work._id)) {
      if (row.status !== "paused") {
        await ctx.db.patch("shopProducts", row._id, { status: "paused", nextAttemptAt: undefined, renderStartedAt: undefined, updatedAt: now });
      }
      if (row.shopifyProductId) productIds.push(row.shopifyProductId);
    }
    if (productIds.length > 0) await ctx.scheduler.runAfter(0, internal.shopify.draftProducts, { productIds });
    await notifyTakedown(ctx, { recipientId: work.creatorId, workId: work._id, reason, at: now });
    return { cr: formatCr(work.crFamily, work.crExpression) };
  },
});

// Puts a design back up as it was, and tells its creator. Its listings stay paused until an admin
// approves it for sale again.
export const restore = mutation({
  args: { workId: v.id("works") },
  returns: v.object({ cr: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "withdrawn") throw new ConvexError({ code: "NOT_FOUND", message: "That design isn't taken down." });
    await ctx.db.patch("works", work._id, { status: "published", withdrawnAt: undefined, withdrawnBy: undefined, withdrawReason: undefined });
    await notifyRestored(ctx, { recipientId: work.creatorId, workId: work._id });
    return { cr: formatCr(work.crFamily, work.crExpression) };
  },
});

// Admin, Overview: designs taken down, most recent first.
export const withdrawn = query({
  args: {},
  returns: v.object({
    canManage: v.boolean(),
    works: v.array(
      v.object({
        workId: v.id("works"),
        cr: v.string(),
        title: v.optional(v.string()),
        creator: v.optional(v.string()),
        reason: v.optional(v.string()),
        withdrawnAt: v.optional(v.number()),
        thumbUrl: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const viewer = await requireAdmin(ctx, "view");
    const rows = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "withdrawn"))
      .take(100);
    rows.sort((a, b) => (b.withdrawnAt ?? 0) - (a.withdrawnAt ?? 0));
    const urls = imageUrlReader(ctx);
    const works = [];
    for (const work of rows.slice(0, 50)) {
      const creator = await ctx.db.get("users", work.creatorId);
      works.push({
        workId: work._id,
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title,
        creator: creator?.username,
        reason: work.withdrawReason,
        withdrawnAt: work.withdrawnAt,
        thumbUrl: (await urls(work.artKey)).thumbUrl,
      });
    }
    return { canManage: adminAllows(viewer.platformRole, "manage"), works };
  },
});

