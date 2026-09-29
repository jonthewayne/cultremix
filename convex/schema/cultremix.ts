import { defineTable } from "convex/server";
import { v } from "convex/values";

// CultRemix tables for the 2026-09-29 sprint. Names follow the Checkpoint 0
// plan's "Settled validators"; fields not needed today are optional.
export const cultremixTables = {
  appSettings: defineTable({
    key: v.string(),
    signupGrant: v.object({ enabled: v.boolean(), credits: v.number() }),
    dailyBudgetCents: v.number(),
    shootsPerMemberPerDay: v.number(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  creditLedger: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("grant"),
      v.literal("settle"),
      v.literal("refund_credit"),
    ),
    amount: v.number(),
    reason: v.optional(
      v.union(v.literal("signup"), v.literal("admin"), v.literal("subscription")),
    ),
    note: v.optional(v.string()),
  }).index("by_user", ["userId"]),
};
