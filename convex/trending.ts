import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { addAttention, attentionScore, bumpTrendingScore, windowStartDay } from "./lib/trending";

const EXPIRE_BATCH = 200;

// Hourly (convex/crons.ts): days that have left the 7-day window come off their works' scores.
// Takes a batch at a time and schedules itself until none are left, so a missed run catches up.
export const expire = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const cutoff = windowStartDay(Date.now());
    const buckets = await ctx.db
      .query("workAttentionDays")
      .withIndex("by_day", (q) => q.lt("day", cutoff))
      .take(EXPIRE_BATCH);
    for (const bucket of buckets) {
      await bumpTrendingScore(ctx, bucket.workId, -attentionScore(bucket.hearts, bucket.remixes, bucket.backs));
      await ctx.db.delete("workAttentionDays", bucket._id);
    }
    if (buckets.length === EXPIRE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.trending.expire, {});
    }
    return { expired: buckets.length };
  },
});

// Rebuilds Trending from the last week of hearts, remixes, and confirmed Backs, for a deployment
// whose hearts predate it. Reads one week, in one transaction. Safe to rerun: bunx convex run trending:rebuild
export const rebuild = internalMutation({
  args: {},
  returns: v.object({ hearts: v.number(), remixes: v.number(), backs: v.number() }),
  handler: async (ctx) => {
    for (const bucket of await ctx.db.query("workAttentionDays").collect()) {
      await ctx.db.delete("workAttentionDays", bucket._id);
    }
    for (const row of await ctx.db.query("trendingWorks").collect()) {
      await ctx.db.delete("trendingWorks", row._id);
    }
    const since = windowStartDay(Date.now()) * 24 * 60 * 60 * 1000;
    let hearts = 0;
    let remixes = 0;
    const recentHearts = await ctx.db
      .query("hearts")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .collect();
    for (const heart of recentHearts) {
      const work = await ctx.db.get("works", heart.workId);
      if (!work || work.status !== "published" || work.creatorId === heart.userId) continue;
      await addAttention(ctx, work._id, heart.createdAt, { hearts: 1 });
      hearts += 1;
    }
    const recentWorks = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published").gte("publishedAt", since))
      .collect();
    for (const work of recentWorks) {
      if (work.kind === "original" || !work.parentWorkId || work.publishedAt === undefined) continue;
      const parent = await ctx.db.get("works", work.parentWorkId);
      if (!parent || parent.status !== "published" || parent.creatorId === work.creatorId) continue;
      await addAttention(ctx, parent._id, work.publishedAt, { remixes: 1 });
      remixes += 1;
    }
    // Confirmed Backs, from their activity events (written at confirmation, so createdAt is when).
    let backs = 0;
    const recentEvents = await ctx.db
      .query("activityEvents")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .collect();
    for (const event of recentEvents) {
      if (event.verb !== "back") continue;
      const back = await ctx.db
        .query("backs")
        .withIndex("by_work_and_backer", (q) => q.eq("workId", event.workId).eq("backerId", event.actorId))
        .unique();
      if (back?.status !== "confirmed") continue;
      const work = await ctx.db.get("works", event.workId);
      if (!work || work.status !== "published" || work.creatorId === event.actorId) continue;
      await addAttention(ctx, work._id, event.createdAt, { backs: 1 });
      backs += 1;
    }
    return { hearts, remixes, backs };
  },
});
