import { v } from "convex/values";
import { query } from "./_generated/server";
import { formatCr, parseCr, publicUrl } from "./lib/r2";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const photoState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);

const feedItem = v.object({
  workId: v.id("works"),
  cr: v.string(),
  kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
  title: v.optional(v.string()),
  creator: v.object({ username: v.string(), creatorNumber: v.optional(v.number()) }),
  backgroundColor: v.string(),
  artUrl: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  photoState,
  parentCr: v.optional(v.string()),
  publishedAt: v.number(),
});

async function toFeedItem(ctx: QueryCtx, work: Doc<"works">) {
  const creator = await ctx.db.get("users", work.creatorId);
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
  const parent = work.parentWorkId ? await ctx.db.get("works", work.parentWorkId) : null;
  return {
    workId: work._id,
    cr: formatCr(work.crFamily, work.crExpression),
    kind: work.kind,
    title: work.title,
    creator: {
      username: creator?.username ?? "member",
      creatorNumber: creator?.creatorNumber,
    },
    backgroundColor: work.backgroundColor,
    artUrl: publicUrl(work.artKey),
    photoUrl: photo?.state === "succeeded" ? publicUrl(photo.publicKey) : undefined,
    photoState: photo ? photo.state : ("none" as const),
    parentCr: parent ? formatCr(parent.crFamily, parent.crExpression) : undefined,
    publishedAt: work.publishedAt ?? work._creationTime,
  };
}

export const list = query({
  args: {},
  returns: v.array(feedItem),
  handler: async (ctx) => {
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .order("desc")
      .take(60);
    return await Promise.all(works.map((work) => toFeedItem(ctx, work)));
  },
});

export const byCr = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      item: feedItem,
      contentHash: v.optional(v.string()),
      remixes: v.array(feedItem),
    }),
  ),
  handler: async (ctx, args) => {
    const parsed = parseCr(args.cr);
    if (!parsed) return null;
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) =>
        q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
      )
      .unique();
    if (!work || work.status !== "published") return null;
    const children = await ctx.db
      .query("works")
      .withIndex("by_parent", (q) => q.eq("parentWorkId", work._id))
      .collect();
    const remixes = await Promise.all(
      children.filter((w) => w.status === "published").map((w) => toFeedItem(ctx, w)),
    );
    return {
      item: await toFeedItem(ctx, work),
      contentHash: work.contentHash,
      remixes,
    };
  },
});
