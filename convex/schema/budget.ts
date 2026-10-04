import { defineTable } from "convex/server";
import { v } from "convex/values";

export const budgetProvider = v.union(v.literal("gateway"), v.literal("fal"));

// The daily image budget (plan KTD-4): every paid call holds a worst-case reservation from the
// moment it's admitted until it settles at its real cost or is released (convex/budget.ts).
export const budgetTables = {
  // One per paid attempt: a grid batch, a single design, a model photo, or an upscale.
  reservations: defineTable({
    // The attempt's own id (a batch, generation, or shoot), with its kind.
    attemptKind: v.union(v.literal("batch"), v.literal("tile"), v.literal("photo"), v.literal("upscale")),
    attemptId: v.string(),
    // What the sweeper finishes when the attempt's action died (one of these, by kind).
    batchId: v.optional(v.id("batches")),
    generationId: v.optional(v.id("generations")),
    shootId: v.optional(v.id("shoots")),
    provider: budgetProvider,
    // Who asked; the owner counts toward the budget too. Missing for admin reshoots.
    userId: v.optional(v.id("users")),
    // The UTC day it counts against: the day it was admitted, even if it settles after midnight.
    dayUtc: v.string(),
    // The credits the member paid for it (0 for the owner and for model photos).
    credits: v.number(),
    worstCaseCents: v.number(),
    pricingVersion: v.number(),
    state: v.union(v.literal("open"), v.literal("settled"), v.literal("released")),
    openedAt: v.number(),
    // Set when the call is sent; the sweeper settles a dispatched attempt and releases one that wasn't.
    dispatchedAt: v.optional(v.number()),
    // What it cost, in cents (fractions allowed): the gateway's reported cost, else the worst case.
    actualCents: v.optional(v.number()),
    costSource: v.optional(v.union(v.literal("reported"), v.literal("worst_case"))),
    // How much the reported cost went over the reservation.
    overageCents: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    // Why it closed the way it did ("timed out", "refused 400", "sweeper", ...); server only.
    reason: v.optional(v.string()),
  })
    .index("by_attempt", ["attemptId"])
    .index("by_state_openedAt", ["state", "openedAt"])
    .index("by_user_day", ["userId", "dayUtc"])
    .index("by_provider_day_state", ["provider", "dayUtc", "state"]),

  // The running totals for one provider's UTC day, updated in the same mutation as each reservation,
  // so admission reads one row instead of the day's reservations.
  budgetDays: defineTable({
    provider: budgetProvider,
    dayUtc: v.string(),
    // The cap in force at the last admission (appSettings.dailyBudgetCents).
    capCents: v.number(),
    settledCents: v.number(),
    openCents: v.number(),
    // Reported costs above their reservations, summed.
    overageCents: v.optional(v.number()),
  }).index("by_provider_day", ["provider", "dayUtc"]),
};
