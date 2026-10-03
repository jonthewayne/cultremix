import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/adminAccess";
import {
  MAX_METRIC_DAYS,
  METRIC_KEYS,
  addCounts,
  dayRange,
  isDay,
  recentDays,
  utcDay,
  zeroCounts,
} from "./lib/metricsDays";
import type { MetricCounts } from "./lib/metricsDays";
import type { MutationCtx } from "./_generated/server";

// Launch metrics (U14). Each UTC day is counted from that day's rows in pages of PAGE_SIZE,
// one scheduled step per page, into one `metricsDays` row. The metrics page reads only
// those rows. A cron recounts yesterday and today every hour; admins can recount more.
export const PAGE_SIZE = 200;
// Every day since launch fits; the page sums at most this many rows for its totals.
const MAX_STORED_DAYS = 1000;

const STAGES = [
  "users",
  "generations",
  "batches",
  "works",
  "crFamilies",
  "creditLedger",
  "shootPhotos",
  "generators",
] as const;
type Stage = (typeof STAGES)[number];

const countsFields = Object.fromEntries(METRIC_KEYS.map((key) => [key, v.number()])) as {
  [K in keyof MetricCounts]: ReturnType<typeof v.number>;
};
const countsValidator = v.object(countsFields);
const dayValidator = v.object({ day: v.string(), complete: v.boolean(), computedAt: v.number(), ...countsFields });

function countsOf(row: MetricCounts): MetricCounts {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, row[key]])) as MetricCounts;
}

export const summary = query({
  args: { days: v.number() },
  returns: v.object({
    days: v.array(dayValidator),
    totals: countsValidator,
    countedDays: v.number(),
    lastComputedAt: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "view");
    const wanted = Math.min(Math.max(Math.floor(args.days), 1), MAX_METRIC_DAYS);
    const stored = await ctx.db.query("metricsDays").withIndex("by_day").order("desc").take(MAX_STORED_DAYS);
    let totals = zeroCounts();
    let lastComputedAt: number | null = null;
    for (const row of stored) {
      totals = addCounts(totals, row);
      lastComputedAt = Math.max(lastComputedAt ?? 0, row.computedAt);
    }
    const byDay = new Map(stored.map((row) => [row.day, row]));
    const days = recentDays(Date.now(), wanted)
      .reverse()
      .map((day) => {
        const row = byDay.get(day);
        return row
          ? { day, complete: row.complete, computedAt: row.computedAt, ...countsOf(row) }
          : { day, complete: false, computedAt: 0, ...zeroCounts() };
      });
    return { days, totals, countedDays: stored.length, lastComputedAt };
  },
});

// Admin: recount the last `days` days (oldest first).
export const recount = mutation({
  args: { days: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > MAX_METRIC_DAYS) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `Recount 1 to ${MAX_METRIC_DAYS} days.` });
    }
    await startRun(ctx, recentDays(Date.now(), args.days));
    return null;
  },
});

// Cron: yesterday and today.
export const rollupRecent = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await startRun(ctx, recentDays(Date.now(), 2));
    return null;
  },
});

// For `convex run` or a backfill: specific days, oldest first.
export const rollupDays = internalMutation({
  args: { days: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.days.length < 1 || args.days.length > MAX_METRIC_DAYS || !args.days.every(isDay)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Pass 1 to 90 days like 2026-10-13." });
    }
    await startRun(ctx, [...args.days].sort());
    return null;
  },
});

async function startRun(ctx: MutationCtx, days: Array<string>) {
  const runId = crypto.randomUUID();
  await ctx.scheduler.runAfter(0, internal.metrics.rollupStep, {
    runId,
    days,
    dayIndex: 0,
    stage: 0,
    cursor: null,
  });
}

export const rollupStep = internalMutation({
  args: {
    runId: v.string(),
    days: v.array(v.string()),
    dayIndex: v.number(),
    stage: v.number(),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const day = args.days[args.dayIndex];
    if (!day || !isDay(day)) return null;
    let row = await ctx.db
      .query("metricsDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    const now = Date.now();
    if (args.stage === 0 && args.cursor === null) {
      // A new count of this day starts from zero; any older count still running stops.
      const fresh = { ...zeroCounts(), runId: args.runId, complete: false, computedAt: now };
      if (row) await ctx.db.patch("metricsDays", row._id, fresh);
      else await ctx.db.insert("metricsDays", { day, ...fresh });
      row = await ctx.db
        .query("metricsDays")
        .withIndex("by_day", (q) => q.eq("day", day))
        .unique();
    }
    if (!row || row.runId !== args.runId) return null;

    const stage = STAGES[args.stage];
    const { delta, isDone, continueCursor } = await countPage(ctx, stage, day, args.cursor);
    const finished = isDone && args.stage === STAGES.length - 1;
    await ctx.db.patch("metricsDays", row._id, {
      ...addCounts(countsOf(row), delta),
      complete: finished,
      computedAt: now,
    });

    let next: { dayIndex: number; stage: number; cursor: string | null } | null;
    if (!isDone) next = { dayIndex: args.dayIndex, stage: args.stage, cursor: continueCursor };
    else if (!finished) next = { dayIndex: args.dayIndex, stage: args.stage + 1, cursor: null };
    else if (args.dayIndex + 1 < args.days.length) next = { dayIndex: args.dayIndex + 1, stage: 0, cursor: null };
    else next = null;
    if (next) {
      await ctx.scheduler.runAfter(0, internal.metrics.rollupStep, { runId: args.runId, days: args.days, ...next });
    }
    return null;
  },
});

type PageResult = { delta: Partial<MetricCounts>; isDone: boolean; continueCursor: string };

// One page of one table's rows created on `day`.
async function countPage(ctx: MutationCtx, stage: Stage, day: string, cursor: string | null): Promise<PageResult> {
  const { start, end } = dayRange(day);
  const options = { cursor, numItems: PAGE_SIZE };
  switch (stage) {
    case "users": {
      const page = await ctx.db
        .query("users")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      return { delta: { members: page.page.length }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    case "generations": {
      const page = await ctx.db
        .query("generations")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      let designs = 0;
      for (const generation of page.page) {
        if (generation.kind === "shoot") continue;
        if (generation.status === "succeeded") designs++;
        await noteGenerator(ctx, generation.ownerId, generation._creationTime);
      }
      return { delta: { designs }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    case "batches": {
      const page = await ctx.db
        .query("batches")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      return { delta: { batches: page.page.length }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    case "works": {
      const page = await ctx.db
        .query("works")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      const published = page.page.filter((work) => work.status === "published");
      return {
        delta: {
          publishedWorks: published.length,
          remixes: published.filter((work) => work.kind !== "original").length,
        },
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
    case "crFamilies": {
      const page = await ctx.db
        .query("crFamilies")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      return { delta: { families: page.page.length }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    case "creditLedger": {
      const page = await ctx.db
        .query("creditLedger")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      // Charges are negative and refunds positive, so credits used is minus their sum.
      const used = page.page
        .filter((entry) => entry.kind === "settle" || entry.kind === "refund_credit")
        .reduce((sum, entry) => sum - entry.amount, 0);
      return { delta: { creditsUsed: used }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    case "shootPhotos": {
      const page = await ctx.db
        .query("shootPhotos")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", start).lt("_creationTime", end))
        .paginate(options);
      return {
        delta: { modelPhotos: page.page.filter((photo) => photo.state === "succeeded").length },
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }
    case "generators": {
      const page = await ctx.db
        .query("metricsGenerators")
        .withIndex("by_firstDay", (q) => q.eq("firstDay", day))
        .paginate(options);
      return { delta: { generators: page.page.length }, isDone: page.isDone, continueCursor: page.continueCursor };
    }
  }
}

// Remembers the first time a member asked for designs.
async function noteGenerator(ctx: MutationCtx, userId: MetricsUserId, at: number) {
  const row = await ctx.db
    .query("metricsGenerators")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) await ctx.db.insert("metricsGenerators", { userId, firstDay: utcDay(at), firstAt: at });
  else if (at < row.firstAt) await ctx.db.patch("metricsGenerators", row._id, { firstDay: utcDay(at), firstAt: at });
}

type MetricsUserId = import("./_generated/dataModel").Id<"users">;
