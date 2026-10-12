import { notify, notifyBacked } from "./notifications";
import { addAttention } from "./trending";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

// KTD-13: the Following feed fans out on read over the latest 200 accounts a member follows.
export const FOLLOWING_FANOUT_LIMIT = 200;
// The most any one page returns, whatever the browser asks for.
export const MAX_PAGE_SIZE = 48;
export const BIO_MAX_LENGTH = 160;

type WorkKind = Doc<"works">["kind"];

export function verbForKind(kind: WorkKind) {
  if (kind === "variation") return "publish_variation" as const;
  if (kind === "fork") return "publish_fork" as const;
  return "publish_original" as const;
}

export function shelfForKind(kind: WorkKind) {
  return kind === "original" ? ("works" as const) : ("remixes" as const);
}

// Writes the activity event for a work that has just been published. Safe to call twice.
export async function recordPublishActivity(ctx: MutationCtx, work: Doc<"works">) {
  if (work.status !== "published") return;
  const createdAt = work.publishedAt ?? work._creationTime;
  await touchCreatorActivity(ctx, work.creatorId, createdAt);
  // The work's own event, not someone's Back of it. It's written at publishing, before any Back,
  // so it's normally the first event the index returns.
  for await (const event of ctx.db.query("activityEvents").withIndex("by_work", (q) => q.eq("workId", work._id))) {
    if (event.verb !== "back") return;
  }
  await ctx.db.insert("activityEvents", {
    actorId: work.creatorId,
    verb: verbForKind(work.kind),
    workId: work._id,
    createdAt,
    shelf: shelfForKind(work.kind),
  });
}

// A remix that has just been published: its parent's creator hears about it, and the parent gains
// trending attention. Remixing your own work does neither. Called once, from markPublished (not
// the backfill, which would notify about old remixes).
export async function recordRemix(ctx: MutationCtx, work: Doc<"works">) {
  if (work.status !== "published" || work.kind === "original" || !work.parentWorkId) return;
  const parent = await ctx.db.get("works", work.parentWorkId);
  if (!parent || parent.creatorId === work.creatorId) return;
  const at = work.publishedAt ?? Date.now();
  await notify(ctx, { recipientId: parent.creatorId, actorId: work.creatorId, kind: "remix", workId: work._id, at });
  if (parent.status === "published") await addAttention(ctx, parent._id, at, { remixes: 1 });
}

// A Back the chain has just confirmed (called from convex/chain.ts with the Back as it was before
// the confirmation): the creator hears about it, the backer's followers see it in Following, it
// joins the backer's Backed list and count, and the work gains trending attention. Once per Back:
// nothing for one that was already confirmed, and nothing at all for a Back that is reserved,
// still being recorded, or didn't go through.
export async function recordBackConfirmed(ctx: MutationCtx, before: Doc<"backs">, at: number) {
  if (before.status === "confirmed") return;
  const work = await ctx.db.get("works", before.workId);
  if (!work || work.creatorId === before.backerId) return;
  await notifyBacked(ctx, { workId: work._id, backerId: before.backerId, at });
  await ctx.db.insert("activityEvents", {
    actorId: before.backerId,
    verb: "back",
    workId: work._id,
    createdAt: at,
    shelf: "backed",
  });
  await bumpUserStats(ctx, before.backerId, { backed: 1 });
  if (work.status === "published") await addAttention(ctx, work._id, at, { backs: 1 });
}

// Moves a creator's last-active time forward, never back, so the backfill can run in any order.
export async function touchCreatorActivity(ctx: MutationCtx, userId: Id<"users">, at: number) {
  const row = await ctx.db
    .query("creatorActivity")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) {
    await ctx.db.insert("creatorActivity", { userId, lastActiveAt: at });
  } else if (at > row.lastActiveAt) {
    await ctx.db.patch("creatorActivity", row._id, { lastActiveAt: at });
  }
}

// A position in a newest-first list ordered by (createdAt, _creationTime). Items "after" the
// cursor are strictly older.
export type FeedPosition = { createdAt: number; creationTime: number };

export function encodeFeedCursor(position: FeedPosition) {
  return `${position.createdAt}:${position.creationTime}`;
}

export function decodeFeedCursor(cursor: string): FeedPosition | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(cursor);
  if (!match) return null;
  const createdAt = Number(match[1]);
  const creationTime = Number(match[2]);
  if (!Number.isFinite(createdAt) || !Number.isFinite(creationTime)) return null;
  return { createdAt, creationTime };
}

// Newest first: positive when a is newer than b.
export function compareFeedPositions(a: FeedPosition, b: FeedPosition) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.creationTime - b.creationTime;
}

export function clampPageSize(numItems: number) {
  if (!Number.isFinite(numItems)) return 12;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(numItems)));
}

// Plain text on one paragraph: control characters and runs of whitespace collapse to spaces.
export function normalizeBio(raw: string) {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export async function getUserByUsername(ctx: Ctx, username: string) {
  const usernameLower = username.trim().replace(/^@/u, "").toLowerCase();
  if (!usernameLower) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
    .first();
}

export async function userStats(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("userSocialStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function workHeartCount(ctx: Ctx, workId: Id<"works">) {
  const stats = await ctx.db
    .query("workSocialStats")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  return stats?.hearts ?? 0;
}

export async function bumpUserStats(
  ctx: MutationCtx,
  userId: Id<"users">,
  change: { followers?: number; following?: number; backed?: number },
) {
  const stats = await userStats(ctx, userId);
  const followers = Math.max(0, (stats?.followers ?? 0) + (change.followers ?? 0));
  const following = Math.max(0, (stats?.following ?? 0) + (change.following ?? 0));
  const backed = Math.max(0, (stats?.backed ?? 0) + (change.backed ?? 0));
  if (stats) {
    await ctx.db.patch("userSocialStats", stats._id, { followers, following, backed });
  } else {
    await ctx.db.insert("userSocialStats", { userId, followers, following, backed });
  }
  return { followers, following };
}

export async function bumpWorkHearts(ctx: MutationCtx, workId: Id<"works">, change: number) {
  const stats = await ctx.db
    .query("workSocialStats")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  const hearts = Math.max(0, (stats?.hearts ?? 0) + change);
  if (stats) {
    await ctx.db.patch("workSocialStats", stats._id, { hearts });
  } else {
    await ctx.db.insert("workSocialStats", { workId, hearts });
  }
  return hearts;
}

// Only web images make it to a public page.
export function safeImageUrl(image: string | undefined) {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
