import { getAppSettings, isOwner } from "../identity";
import { dayRange, utcDay } from "./metricsDays";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// The reason a model photo waits for tomorrow: its creator has had today's photo shoots
// (the admin "Photo shoots per member a day" setting).
export const DAILY_LIMIT = "daily_limit";
export const DAILY_LIMIT_MESSAGE = "You’ve had your photo shoots for today. Try again tomorrow.";

// How many more model photos the member can start today (UTC); null means no limit (the owner).
export async function shootsLeftToday(ctx: QueryCtx | MutationCtx, userId: Id<"users">, now: number) {
  const user = await ctx.db.get("users", userId);
  if (user && isOwner(user)) return null;
  const limit = (await getAppSettings(ctx)).shootsPerMemberPerDay;
  if (limit <= 0) return 0;
  const started = await ctx.db
    .query("photoShootStarts")
    .withIndex("by_user_started", (q) => q.eq("userId", userId).gte("startedAt", dayRange(utcDay(now)).start))
    .take(limit);
  return Math.max(0, limit - started.length);
}

// Counts a model photo against the member's day. False (and nothing counted) when the
// member has had today's photo shoots; the owner is never limited.
export async function startPhotoShoot(
  ctx: MutationCtx,
  userId: Id<"users">,
  workId: Id<"works">,
  now: number,
) {
  const left = await shootsLeftToday(ctx, userId, now);
  if (left === 0) return false;
  await ctx.db.insert("photoShootStarts", { userId, workId, startedAt: now });
  return true;
}
