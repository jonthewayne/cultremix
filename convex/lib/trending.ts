import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Trending ranks published works by the attention they got over the last 7 UTC days: each heart
// counts 1 and each remix counts REMIX_WEIGHT. Hearts and remixes add to a per-day row and to the
// work's score in the same transaction; the hourly expire cron (convex/trending.ts) takes days
// that leave the window back off. A request reads one page of an index, never a table scan.
export const REMIX_WEIGHT = 3;
export const TRENDING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function dayOf(ms: number) {
  return Math.floor(ms / DAY_MS);
}

// The first day still inside the window.
export function windowStartDay(now: number) {
  return dayOf(now) - (TRENDING_DAYS - 1);
}

export function attentionScore(hearts: number, remixes: number) {
  return hearts + REMIX_WEIGHT * remixes;
}

// Adds (or, with negative counts, takes back) attention a work got at `at`. Attention from a day
// that has already left the window changes nothing.
export async function addAttention(
  ctx: MutationCtx,
  workId: Id<"works">,
  at: number,
  change: { hearts?: number; remixes?: number },
) {
  const day = dayOf(at);
  if (day < windowStartDay(Date.now())) return;
  const bucket = await ctx.db
    .query("workAttentionDays")
    .withIndex("by_work_day", (q) => q.eq("workId", workId).eq("day", day))
    .unique();
  const before = { hearts: bucket?.hearts ?? 0, remixes: bucket?.remixes ?? 0 };
  const hearts = Math.max(0, before.hearts + (change.hearts ?? 0));
  const remixes = Math.max(0, before.remixes + (change.remixes ?? 0));
  if (bucket && hearts === 0 && remixes === 0) {
    await ctx.db.delete("workAttentionDays", bucket._id);
  } else if (bucket) {
    await ctx.db.patch("workAttentionDays", bucket._id, { hearts, remixes });
  } else if (hearts > 0 || remixes > 0) {
    await ctx.db.insert("workAttentionDays", { workId, day, hearts, remixes });
  }
  const delta = attentionScore(hearts, remixes) - attentionScore(before.hearts, before.remixes);
  await bumpTrendingScore(ctx, workId, delta, delta > 0 ? at : undefined);
}

export async function bumpTrendingScore(
  ctx: MutationCtx,
  workId: Id<"works">,
  delta: number,
  at?: number,
) {
  if (delta === 0) return;
  const row = await ctx.db
    .query("trendingWorks")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  const score = Math.max(0, (row?.score ?? 0) + delta);
  if (score === 0) {
    if (row) await ctx.db.delete("trendingWorks", row._id);
    return;
  }
  const lastAttentionAt = Math.max(row?.lastAttentionAt ?? 0, at ?? 0);
  if (row) {
    await ctx.db.patch("trendingWorks", row._id, { score, lastAttentionAt });
  } else {
    await ctx.db.insert("trendingWorks", { workId, score, lastAttentionAt });
  }
}
