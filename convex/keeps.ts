import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { commerceOpen } from "./lib/shopFlags";
import { listingsOf } from "./lib/shopProduct";
import { colorLookup } from "./merch";
import { imageUrlReader } from "./lib/imageUrls";
import { EMPTY_PAGE, cappedPage } from "./lib/paging";
import { formatCr } from "./lib/r2";

// Kept designs ("Keep it just for you" when publishing): visible only to their creator, on
// /keep/<id>. Every public query reads only status "published", so they stay out of everything else.

const keptView = v.object({
  workId: v.id("works"),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  keptAt: v.optional(v.number()),
  url: v.optional(v.string()),
  mediumUrl: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  backgroundColor: v.string(),
  colors: v.array(v.object({ key: v.string(), name: v.string(), hex: v.string() })),
  // The design it remixes, credited on the page.
  parent: v.optional(v.object({ cr: v.string(), title: v.optional(v.string()), username: v.optional(v.string()) })),
  // Still being saved (its art is being prepared).
  preparing: v.boolean(),
  // Getting it printed: ask (nothing asked yet), requested (waiting for an admin), preparing (its
  // print files and products are being made), ready (it can be ordered once checkout is open).
  ordering: v.union(v.literal("ask"), v.literal("requested"), v.literal("preparing"), v.literal("ready")),
  checkoutOpen: v.boolean(),
});

export const get = query({
  args: { workId: v.id("works") },
  returns: v.union(v.null(), keptView),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!user || !work || work.creatorId !== user._id) return null;
    const preparing = work.status === "preparing" && work.keep === "private";
    if (work.status !== "private" && !preparing) return null;
    const urls = imageUrlReader(ctx);
    const generation = await ctx.db.get("generations", work.generationId);
    const art = await urls(work.artKey ?? generation?.fullKey);
    const parentWork = work.parentWorkId ? await ctx.db.get("works", work.parentWorkId) : null;
    const parentCreator = parentWork ? await ctx.db.get("users", parentWork.creatorId) : null;
    const lookup = await colorLookup(ctx);
    const listings = (await listingsOf(ctx, work._id)).filter((row) => row.listing);
    const ordering = listings.some((row) => row.status === "live")
      ? ("ready" as const)
      : listings.some((row) => row.status !== "paused")
        ? ("preparing" as const)
        : work.printRequestedAt !== undefined
          ? ("requested" as const)
          : ("ask" as const);
    return {
      workId: work._id,
      title: work.title,
      description: work.description,
      keptAt: work.publishedAt,
      ...art,
      backgroundColor: work.backgroundColor,
      colors: (work.offeredColors ?? []).flatMap((key) => {
        const color = lookup.get(key);
        return color ? [{ key: color.key, name: color.name, hex: color.hex }] : [];
      }),
      parent:
        parentWork && (parentWork.status === "published" || parentWork.status === "withdrawn")
          ? { cr: formatCr(parentWork.crFamily, parentWork.crExpression), title: parentWork.title, username: parentCreator?.username }
          : undefined,
      preparing,
      ordering,
      checkoutOpen: await commerceOpen(ctx),
    };
  },
});

// The viewer's kept designs, newest first.
export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ workId: v.id("works"), title: v.optional(v.string()), thumbUrl: v.optional(v.string()), backgroundColor: v.string() }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return EMPTY_PAGE;
    const result = await ctx.db
      .query("works")
      .withIndex("by_creator_status", (q) => q.eq("creatorId", user._id).eq("status", "private"))
      .order("desc")
      .paginate(cappedPage(args.paginationOpts, 48));
    const urls = imageUrlReader(ctx);
    const page = await Promise.all(
      result.page.map(async (work) => ({
        workId: work._id,
        title: work.title,
        thumbUrl: (await urls(work.artKey)).thumbUrl,
        backgroundColor: work.backgroundColor,
      })),
    );
    return { ...result, page };
  },
});

// A kept design's creator asks to have it printed. An admin approves it in Admin, For sale (for
// its creator alone), and then it can be ordered from its page (shopify.keptOffer). Asking again
// changes nothing.
export const requestPrint = mutation({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!user || !work || work.creatorId !== user._id || work.status !== "private") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Only a kept design's creator can ask to print it." });
    }
    if (work.printRequestedAt === undefined) await ctx.db.patch("works", work._id, { printRequestedAt: Date.now() });
    return null;
  },
});
