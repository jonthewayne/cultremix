import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { imageUrlReader } from "./lib/imageUrls";
import { formatCr, parseCr } from "./lib/r2";
import {
  FOLLOWING_FANOUT_LIMIT,
  MAX_PAGE_SIZE,
  clampPageSize,
  compareFeedPositions,
  decodeFeedCursor,
  encodeFeedCursor,
  workHeartCount,
} from "./lib/social";
import type { FeedPosition } from "./lib/social";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { PaginationOptions } from "convex/server";

const photoState = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);

// Everything a feed row, work page, or profile card shows. Public fields only (INV-24).
export const feedItem = v.object({
  workId: v.id("works"),
  cr: v.string(),
  kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
  title: v.optional(v.string()),
  creator: v.object({ username: v.string(), creatorNumber: v.optional(v.number()) }),
  backgroundColor: v.string(),
  // The originals, and the medium copies pages show (convex/lib/sizes.ts).
  artUrl: v.optional(v.string()),
  artMediumUrl: v.optional(v.string()),
  artThumbUrl: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  photoMediumUrl: v.optional(v.string()),
  photoState,
  parentCr: v.optional(v.string()),
  publishedAt: v.number(),
  hearts: v.number(),
});

export const feedPage = paginationResultValidator(feedItem);

type Urls = ReturnType<typeof imageUrlReader>;

export async function toFeedItem(ctx: QueryCtx, work: Doc<"works">, urls: Urls = imageUrlReader(ctx)) {
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
  const art = await urls(work.artKey);
  const shot = photo?.state === "succeeded" ? await urls(photo.publicKey) : {};
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
    artUrl: art.url,
    artMediumUrl: art.mediumUrl,
    artThumbUrl: art.thumbUrl,
    photoUrl: shot.url,
    photoMediumUrl: shot.mediumUrl,
    photoState: photo ? photo.state : ("none" as const),
    parentCr: parent ? formatCr(parent.crFamily, parent.crExpression) : undefined,
    publishedAt: work.publishedAt ?? work._creationTime,
    hearts: await workHeartCount(ctx, work._id),
  };
}

// Feed items for works that are still published, in the order given; others drop out.
export async function publishedItems(ctx: QueryCtx, workIds: Array<Id<"works">>) {
  const urls = imageUrlReader(ctx);
  const items = await Promise.all(
    workIds.map(async (workId) => {
      const work = await ctx.db.get("works", workId);
      if (!work || work.status !== "published") return null;
      return await toFeedItem(ctx, work, urls);
    }),
  );
  return items.filter((item) => item !== null);
}

function boundedOpts(opts: PaginationOptions): PaginationOptions {
  return { ...opts, numItems: clampPageSize(opts.numItems) };
}

// Latest: every published work, newest first.
export const latest = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: feedPage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate(boundedOpts(args.paginationOpts));
    const urls = imageUrlReader(ctx);
    return {
      page: await Promise.all(result.page.map((work) => toFeedItem(ctx, work, urls))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Following: works by the people the viewer follows, newest first (KTD-13: fan-out on read over
// the latest 200 followed accounts). Signed out, it's empty.
export const following = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: feedPage,
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return { page: [], isDone: true, continueCursor: "" };
    const follows = await ctx.db
      .query("follows")
      .withIndex("by_follower_created", (q) => q.eq("followerId", viewer._id))
      .order("desc")
      .take(FOLLOWING_FANOUT_LIMIT);
    const window = await followingWindow(
      ctx,
      follows.map((follow) => follow.followeeId),
      args.paginationOpts,
    );
    return {
      page: await publishedItems(ctx, window.events.map((event) => event.workId)),
      isDone: window.isDone,
      continueCursor: window.continueCursor,
    };
  },
});

// One page of the merged activity of several members. The cursor is the (createdAt,
// _creationTime) of the last event returned; endCursor pins a page's far edge, as Convex's own
// paginate does, so pages stay contiguous while new events arrive.
export async function followingWindow(
  ctx: QueryCtx,
  actorIds: Array<Id<"users">>,
  opts: PaginationOptions,
) {
  const empty = { events: [] as Array<Doc<"activityEvents">>, isDone: true, continueCursor: "" };
  const start = opts.cursor ? decodeFeedCursor(opts.cursor) : null;
  if (opts.cursor && !start) return empty;
  const end = opts.endCursor ? decodeFeedCursor(opts.endCursor) : null;
  if (opts.endCursor && !end) return empty;
  // A pinned page grows only when events land inside it, so allow a little more than a page.
  const limit = end ? MAX_PAGE_SIZE * 2 : clampPageSize(opts.numItems);
  const perActor = limit + 1;

  const batches = await Promise.all(
    actorIds.map(async (actorId) => {
      if (!start) {
        return await ctx.db
          .query("activityEvents")
          .withIndex("by_actor_created", (q) => q.eq("actorId", actorId))
          .order("desc")
          .take(perActor);
      }
      const ties = await ctx.db
        .query("activityEvents")
        .withIndex("by_actor_created", (q) =>
          q
            .eq("actorId", actorId)
            .eq("createdAt", start.createdAt)
            .lt("_creationTime", start.creationTime),
        )
        .order("desc")
        .take(perActor);
      const older = await ctx.db
        .query("activityEvents")
        .withIndex("by_actor_created", (q) =>
          q.eq("actorId", actorId).lt("createdAt", start.createdAt),
        )
        .order("desc")
        .take(perActor);
      return [...ties, ...older];
    }),
  );

  const position = (event: Doc<"activityEvents">): FeedPosition => ({
    createdAt: event.createdAt,
    creationTime: event._creationTime,
  });
  let merged = batches.flat().sort((a, b) => compareFeedPositions(position(b), position(a)));
  if (end) {
    merged = merged.filter((event) => compareFeedPositions(position(event), end) >= 0);
    const events = merged.slice(0, limit);
    return { events, isDone: false, continueCursor: opts.endCursor ?? "" };
  }
  const events = merged.slice(0, limit);
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  return {
    events,
    isDone: merged.length <= limit,
    continueCursor: last ? encodeFeedCursor(position(last)) : (opts.cursor ?? ""),
  };
}

export const byCr = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      item: feedItem,
      contentHash: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await publishedWorkByCr(ctx, args.cr);
    if (!work) return null;
    return {
      item: await toFeedItem(ctx, work),
      contentHash: work.contentHash,
    };
  },
});

// A work's direct remixes, oldest first (so they read in number order), a page at a time.
export const remixes = query({
  args: { cr: v.string(), paginationOpts: paginationOptsValidator },
  returns: feedPage,
  handler: async (ctx, args) => {
    const work = await publishedWorkByCr(ctx, args.cr);
    if (!work) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("works")
      .withIndex("by_parent", (q) => q.eq("parentWorkId", work._id))
      .paginate(boundedOpts(args.paginationOpts));
    const urls = imageUrlReader(ctx);
    const published = result.page.filter((child) => child.status === "published");
    return {
      page: await Promise.all(published.map((child) => toFeedItem(ctx, child, urls))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

async function publishedWorkByCr(ctx: QueryCtx, cr: string) {
  const parsed = parseCr(cr);
  if (!parsed) return null;
  const work = await ctx.db
    .query("works")
    .withIndex("by_family_expression", (q) =>
      q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
    )
    .unique();
  if (!work || work.status !== "published") return null;
  return work;
}
