import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewerUser } from "./identity";
import { imageUrlReader } from "./lib/imageUrls";
import { formatCr } from "./lib/r2";
import { clampPageSize, safeImageUrl } from "./lib/social";
import { notificationKindValidator } from "./schema/social";

const workRef = v.object({ cr: v.string(), title: v.optional(v.string()), thumbUrl: v.optional(v.string()) });

// One row on the viewer's notifications page. Only about the viewer, so only the viewer sees it.
const notificationItem = v.object({
  id: v.id("notifications"),
  kind: notificationKindValidator,
  createdAt: v.number(),
  // Absent when the member has no username yet.
  actor: v.object({ username: v.optional(v.string()), image: v.optional(v.string()) }),
  // The work it's about (your work, or the new remix), while it's still published.
  work: v.optional(workRef),
  // For a remix: your work it was made from. For a sale of someone's remix: your design it came from.
  parent: v.optional(workRef),
  // For a sale: what you earn from the order (before the return window), and whether it was a test.
  sale: v.optional(v.object({ cents: v.number(), units: v.number(), test: v.boolean(), held: v.optional(v.boolean()) })),
});

// The bell: how many are unread, and when the viewer last opened the list. Signed out, nothing.
export const status = query({
  args: {},
  returns: v.object({ unread: v.number(), lastReadAt: v.number() }),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return { unread: 0, lastReadAt: 0 };
    const state = await notificationState(ctx, viewer._id);
    return { unread: state?.unread ?? 0, lastReadAt: state?.lastReadAt ?? 0 };
  },
});

// The viewer's notifications, newest first.
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(notificationItem),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", viewer._id))
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    const urls = imageUrlReader(ctx);
    const reference = async (work: Doc<"works"> | null) => {
      if (!work || work.status !== "published") return undefined;
      return {
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title,
        thumbUrl: (await urls(work.artKey)).thumbUrl,
      };
    };
    const page = await Promise.all(
      result.page.map(async (row) => {
        const actor = row.actorId ? await ctx.db.get("users", row.actorId) : null;
        const work = row.workId ? await ctx.db.get("works", row.workId) : null;
        const parentId =
          row.kind === "remix" ? work?.parentWorkId : row.kind === "sale" ? row.ownWorkId : undefined;
        const parent = parentId ? await ctx.db.get("works", parentId) : null;
        return {
          id: row._id,
          kind: row.kind,
          createdAt: row.createdAt,
          actor: { username: actor?.username, image: safeImageUrl(actor?.image) },
          work: await reference(work),
          parent: await reference(parent),
          sale: row.sale,
        };
      }),
    );
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

// Opening the list marks everything read.
export const markAllRead = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return null;
    const state = await notificationState(ctx, viewer._id);
    if (state && state.unread > 0) {
      await ctx.db.patch("notificationState", state._id, { unread: 0, lastReadAt: Date.now() });
    }
    return null;
  },
});

async function notificationState(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("notificationState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}
