import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { adminAllows, requireAdmin } from "./lib/adminAccess";
import { checkRateLimit } from "./lib/authRateLimit";
import { BURST_COUNT, KEEP_MS, browserName, cleanReport, nextWindow } from "./lib/clientErrors";
import { notifyOpsAlert } from "./lib/notifications";
import type { MutationCtx } from "./_generated/server";

// Errors that happen in members' and visitors' browsers (src/lib/clientErrors.ts sends them): the
// page, the error, and how many times, so a problem someone hits shows up in Admin, Overview. Anyone
// can report, so reports are capped (100 every 10 minutes in all), and the same error on the same
// page counts up instead of adding rows. Ten of one error within an hour tell the owner and ops in
// their bell, at most once an hour. Rows go after 14 days (a daily cron), or when an admin clears them.

const ALERT_KEY = "client-errors";
const ALERT_GAP_MS = 60 * 60 * 1000;
const SHOWN = 20;
const CLEAR_BATCH = 200;

const sourceValidator = v.union(v.literal("window"), v.literal("promise"), v.literal("page"));

async function alertBurst(ctx: MutationCtx, message: string, path: string, now: number) {
  const row = await ctx.db
    .query("opsAlerts")
    .withIndex("by_key", (q) => q.eq("key", ALERT_KEY))
    .unique();
  if (row && now - row.updatedAt < ALERT_GAP_MS) return;
  if (row) await ctx.db.patch("opsAlerts", row._id, { level: "burst", updatedAt: now });
  else await ctx.db.insert("opsAlerts", { key: ALERT_KEY, level: "burst", updatedAt: now });
  const owners = await ctx.db
    .query("users")
    .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_owner"))
    .take(5);
  const ops = await ctx.db
    .query("users")
    .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_ops"))
    .take(20);
  const text = "Browsers hit the same error " + BURST_COUNT + " times in an hour on " + path + ": " + message.slice(0, 160) + " Admin, Overview lists it under Browser errors.";
  for (const person of [...owners, ...ops]) await notifyOpsAlert(ctx, { recipientId: person._id, message: text });
}

export const report = mutation({
  args: {
    message: v.string(),
    stack: v.optional(v.string()),
    path: v.string(),
    userAgent: v.optional(v.string()),
    source: sourceValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const clean = cleanReport(args);
    if (!clean) return null;
    try {
      await checkRateLimit(ctx, "client:error", "all");
    } catch {
      return null;
    }
    const signedIn = (await getViewerUser(ctx)) !== null;
    const now = Date.now();
    const existing = await ctx.db
      .query("clientErrors")
      .withIndex("by_key", (q) => q.eq("key", clean.key))
      .unique();
    const window = nextWindow(existing ? { start: existing.windowStart, count: existing.windowCount } : undefined, now);
    if (existing) {
      await ctx.db.patch("clientErrors", existing._id, {
        count: existing.count + 1,
        lastAt: now,
        windowStart: window.start,
        windowCount: window.count,
        stack: clean.stack ?? existing.stack,
        userAgent: clean.userAgent ?? existing.userAgent,
        signedIn: existing.signedIn || signedIn,
      });
    } else {
      await ctx.db.insert("clientErrors", {
        key: clean.key,
        message: clean.message,
        stack: clean.stack,
        path: clean.path,
        userAgent: clean.userAgent,
        source: args.source,
        count: 1,
        firstAt: now,
        lastAt: now,
        windowStart: window.start,
        windowCount: window.count,
        signedIn,
      });
    }
    if (window.burst) await alertBurst(ctx, clean.message, clean.path, now);
    return null;
  },
});

// Admin, Overview: the latest errors, newest first. Any admin can see them; ops and the owner can clear them.
export const recent = query({
  args: {},
  returns: v.object({
    canManage: v.boolean(),
    errors: v.array(
      v.object({
        id: v.id("clientErrors"),
        message: v.string(),
        path: v.string(),
        source: sourceValidator,
        count: v.number(),
        firstAt: v.number(),
        lastAt: v.number(),
        signedIn: v.boolean(),
        browser: v.string(),
        stack: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const viewer = await requireAdmin(ctx, "view");
    const rows = await ctx.db.query("clientErrors").withIndex("by_lastAt").order("desc").take(SHOWN);
    return {
      canManage: adminAllows(viewer.platformRole, "manage"),
      errors: rows.map((row) => ({
        id: row._id,
        message: row.message,
        path: row.path,
        source: row.source,
        count: row.count,
        firstAt: row.firstAt,
        lastAt: row.lastAt,
        signedIn: row.signedIn,
        browser: browserName(row.userAgent),
        stack: row.stack,
      })),
    };
  },
});

// "Clear the list", once the errors are fixed.
export const clear = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx, "manage");
    const rows = await ctx.db.query("clientErrors").take(CLEAR_BATCH);
    for (const row of rows) await ctx.db.delete("clientErrors", row._id);
    return rows.length;
  },
});

// Daily: rows last seen over 14 days ago.
export const cleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - KEEP_MS;
    const rows = await ctx.db
      .query("clientErrors")
      .withIndex("by_lastAt", (q) => q.lt("lastAt", cutoff))
      .take(CLEAR_BATCH);
    for (const row of rows) await ctx.db.delete("clientErrors", row._id);
    return rows.length;
  },
});
