import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { feedPage, publishedItems } from "./feed";
import { getViewerUser } from "./identity";
import { requireMember } from "./studio";
import { shelfValidator } from "./schema/social";
import {
  BIO_MAX_LENGTH,
  bumpUserStats,
  bumpWorkHearts,
  clampPageSize,
  getUserByUsername,
  normalizeBio,
  userStats,
  workHeartCount,
} from "./lib/social";

// A member's public profile (R25). Public fields only (INV-24): never email, ids, or roles.
export const profile = query({
  args: { username: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      username: v.string(),
      creatorNumber: v.optional(v.number()),
      image: v.optional(v.string()),
      bio: v.optional(v.string()),
      followers: v.number(),
      following: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUserByUsername(ctx, args.username);
    if (!user?.username) return null;
    const stats = await userStats(ctx, user._id);
    return {
      username: user.username,
      creatorNumber: user.creatorNumber,
      image: safeImageUrl(user.image),
      bio: user.bio || undefined,
      followers: stats?.followers ?? 0,
      following: stats?.following ?? 0,
    };
  },
});

// A profile's published originals ("works") or remixes, newest first.
export const works = query({
  args: { username: v.string(), shelf: shelfValidator, paginationOpts: paginationOptsValidator },
  returns: feedPage,
  handler: async (ctx, args) => {
    const user = await getUserByUsername(ctx, args.username);
    if (!user?.username) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("activityEvents")
      .withIndex("by_actor_shelf_created", (q) =>
        q.eq("actorId", user._id).eq("shelf", args.shelf),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    return {
      page: await publishedItems(ctx, result.page.map((event) => event.workId)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// A row in a list of members. Public fields only (INV-24).
const memberCard = v.object({
  username: v.string(),
  creatorNumber: v.optional(v.number()),
  image: v.optional(v.string()),
  bio: v.optional(v.string()),
});
export const memberPage = paginationResultValidator(memberCard);
const emptyPage = { page: [], isDone: true, continueCursor: "" };

async function memberCards(ctx: QueryCtx, userIds: Array<Id<"users">>) {
  const users = await Promise.all(userIds.map((id) => ctx.db.get("users", id)));
  return users.flatMap((user) =>
    user?.username
      ? [
          {
            username: user.username,
            creatorNumber: user.creatorNumber,
            image: safeImageUrl(user.image),
            bio: user.bio || undefined,
          },
        ]
      : [],
  );
}

// Who follows this member, newest follow first.
export const followers = query({
  args: { username: v.string(), paginationOpts: paginationOptsValidator },
  returns: memberPage,
  handler: async (ctx, args) => {
    const user = await getUserByUsername(ctx, args.username);
    if (!user?.username) return emptyPage;
    const result = await ctx.db
      .query("follows")
      .withIndex("by_followee_created", (q) => q.eq("followeeId", user._id))
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    return {
      page: await memberCards(ctx, result.page.map((row) => row.followerId)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Who this member follows, newest follow first.
export const following = query({
  args: { username: v.string(), paginationOpts: paginationOptsValidator },
  returns: memberPage,
  handler: async (ctx, args) => {
    const user = await getUserByUsername(ctx, args.username);
    if (!user?.username) return emptyPage;
    const result = await ctx.db
      .query("follows")
      .withIndex("by_follower_created", (q) => q.eq("followerId", user._id))
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    return {
      page: await memberCards(ctx, result.page.map((row) => row.followeeId)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Creators who published most recently, one row each, for home's "Who's making things".
export const activeCreators = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: memberPage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("creatorActivity")
      .withIndex("by_lastActive")
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems) });
    return {
      page: await memberCards(ctx, result.page.map((row) => row.userId)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Whether the viewer follows this member. Signed out, never.
export const followState = query({
  args: { username: v.string() },
  returns: v.object({ following: v.boolean(), self: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    const target = await getUserByUsername(ctx, args.username);
    if (!viewer || !target) return { following: false, self: false };
    if (viewer._id === target._id) return { following: false, self: true };
    const row = await ctx.db
      .query("follows")
      .withIndex("by_pair", (q) => q.eq("followerId", viewer._id).eq("followeeId", target._id))
      .unique();
    return { following: row !== null, self: false };
  },
});

// A work's heart count and whether the viewer hearted it.
export const heartState = query({
  args: { workId: v.id("works") },
  returns: v.object({ hearted: v.boolean(), count: v.number() }),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published") return { hearted: false, count: 0 };
    const viewer = await getViewerUser(ctx);
    const row = viewer
      ? await ctx.db
          .query("hearts")
          .withIndex("by_pair", (q) => q.eq("userId", viewer._id).eq("workId", work._id))
          .unique()
      : null;
    return { hearted: row !== null, count: await workHeartCount(ctx, work._id) };
  },
});

// Follows or unfollows (R26). Idempotent: following twice leaves one row and one count.
export const setFollow = mutation({
  args: { username: v.string(), follow: v.boolean() },
  returns: v.object({ following: v.boolean(), followers: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireMember(ctx);
    const target = await getUserByUsername(ctx, args.username);
    if (!target?.username) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No member with that name." });
    }
    if (target._id === viewer._id) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "You can’t follow yourself." });
    }
    const row = await ctx.db
      .query("follows")
      .withIndex("by_pair", (q) => q.eq("followerId", viewer._id).eq("followeeId", target._id))
      .unique();
    if (args.follow && !row) {
      await ctx.db.insert("follows", {
        followerId: viewer._id,
        followeeId: target._id,
        createdAt: Date.now(),
      });
      await bumpUserStats(ctx, viewer._id, { following: 1 });
      const stats = await bumpUserStats(ctx, target._id, { followers: 1 });
      return { following: true, followers: stats.followers };
    }
    if (!args.follow && row) {
      await ctx.db.delete("follows", row._id);
      await bumpUserStats(ctx, viewer._id, { following: -1 });
      const stats = await bumpUserStats(ctx, target._id, { followers: -1 });
      return { following: false, followers: stats.followers };
    }
    const stats = await userStats(ctx, target._id);
    return { following: row !== null, followers: stats?.followers ?? 0 };
  },
});

// Hearts or unhearts a work (R26). Idempotent. Only published works take new hearts; a heart on
// a work that was later withdrawn can still be taken back.
export const setHeart = mutation({
  args: { workId: v.id("works"), heart: v.boolean() },
  returns: v.object({ hearted: v.boolean(), count: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireMember(ctx);
    const work = await ctx.db.get("works", args.workId);
    const row = await ctx.db
      .query("hearts")
      .withIndex("by_pair", (q) => q.eq("userId", viewer._id).eq("workId", args.workId))
      .unique();
    if (args.heart && !row) {
      if (!work || work.status !== "published") {
        throw new ConvexError({ code: "NOT_FOUND", message: "That design isn’t published." });
      }
      await ctx.db.insert("hearts", { userId: viewer._id, workId: work._id, createdAt: Date.now() });
      return { hearted: true, count: await bumpWorkHearts(ctx, work._id, 1) };
    }
    if (!args.heart && row) {
      await ctx.db.delete("hearts", row._id);
      return { hearted: false, count: await bumpWorkHearts(ctx, args.workId, -1) };
    }
    return { hearted: row !== null, count: await workHeartCount(ctx, args.workId) };
  },
});

// Saves the viewer's bio; an empty one clears it.
export const setBio = mutation({
  args: { bio: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const viewer = await requireMember(ctx);
    const bio = normalizeBio(args.bio);
    if (bio.length > BIO_MAX_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Keep it to ${BIO_MAX_LENGTH} characters.`,
      });
    }
    await ctx.db.patch("users", viewer._id, { bio: bio || undefined });
    return bio;
  },
});

// Only web images make it to a public page.
function safeImageUrl(image: string | undefined) {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
