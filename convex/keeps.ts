import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getViewerUser } from "./identity";
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
