import { v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { colorName } from "./lib/colors";
import { garmentColor } from "./lib/garments";
import { colorLookup } from "./merch";
import { imageUrlReader } from "./lib/imageUrls";
import { DAILY_LIMIT } from "./lib/photoShoots";
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
  // Waiting for its creator's photo shoots tomorrow (convex/lib/photoShoots.ts).
  v.literal("waiting"),
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
  photoThumbUrl: v.optional(v.string()),
  photoState,
  parentCr: v.optional(v.string()),
  publishedAt: v.number(),
  hearts: v.number(),
  // A Back this item is about: in Following, a followed member's; on a profile, the member's own.
  // ordinal is their place among the work's backers.
  backedBy: v.optional(v.object({ username: v.string(), ordinal: v.number() })),
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
    photoThumbUrl: shot.thumbUrl,
    photoState: !photo
      ? ("none" as const)
      : photo.state === "failed" && photo.reason === DAILY_LIMIT
        ? ("waiting" as const)
        : photo.state,
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

// Feed items for activity events, in order: a work's publication, or a confirmed Back of it.
// Works no longer published, and Backs no longer confirmed, drop out.
export async function activityItems(
  ctx: QueryCtx,
  events: Array<Doc<"activityEvents">>,
): Promise<Array<Infer<typeof feedItem>>> {
  const urls = imageUrlReader(ctx);
  const items = await Promise.all(
    events.map(async (event) => {
      const work = await ctx.db.get("works", event.workId);
      if (!work || work.status !== "published") return null;
      if (event.verb !== "back") return await toFeedItem(ctx, work, urls);
      const back = await ctx.db
        .query("backs")
        .withIndex("by_work_and_backer", (q) => q.eq("workId", work._id).eq("backerId", event.actorId))
        .unique();
      const backer = await ctx.db.get("users", event.actorId);
      if (back?.status !== "confirmed" || back.ordinal === undefined || !backer?.username) return null;
      const item = await toFeedItem(ctx, work, urls);
      return { ...item, backedBy: { username: backer.username, ordinal: back.ordinal } };
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

// Trending: published works with the most attention over the last 7 days (convex/lib/trending.ts),
// most first. Signed out too.
export const trending = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: feedPage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("trendingWorks")
      .withIndex("by_score")
      .order("desc")
      .paginate(boundedOpts(args.paginationOpts));
    return {
      page: await publishedItems(ctx, result.page.map((row) => row.workId)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Following: works by the people the viewer follows, and the works they Back, newest first
// (KTD-13: fan-out on read over the latest 200 followed accounts). Signed out, it's empty.
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
      page: await activityItems(ctx, window.events),
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

const shopColor = v.object({ key: v.string(), name: v.string(), hex: v.string() });

// The shirt colors a work is offered in, lead first, by name and swatch from any shirt's colors
// (convex/merch.ts colorLookup). Works published before colors were chosen have one: their
// background.
export function shopColors(work: Doc<"works">, lookup?: Map<string, { key: string; name: string; hex: string }>) {
  const colors = (work.offeredColors ?? []).flatMap((key) => {
    const color = lookup?.get(key) ?? garmentColor(key);
    return color ? [color] : [];
  });
  if (colors.length > 0) return colors;
  const name = colorName(work.backgroundColor);
  return [{ key: "custom", name: name.charAt(0).toUpperCase() + name.slice(1), hex: work.backgroundColor }];
}

export const byCr = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      item: feedItem,
      contentHash: v.optional(v.string()),
      description: v.optional(v.string()),
      colors: v.array(shopColor),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await publishedWorkByCr(ctx, args.cr);
    if (!work) return null;
    return {
      item: await toFeedItem(ctx, work),
      contentHash: work.contentHash,
      description: work.description,
      colors: shopColors(work, await colorLookup(ctx)),
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
