import { defineTable } from "convex/server";
import { v } from "convex/values";

// Launch tables: creator access, judge accounts, and daily metrics.
export const launchTables = {
  // Who may create. Judges get a "comp" row when an admin provisions them (convex/judges.ts).
  creatorAccess: defineTable({
    userId: v.id("users"),
    source: v.union(v.literal("owner"), v.literal("comp"), v.literal("subscription")),
    active: v.boolean(),
    grantedBy: v.optional(v.id("users")),
    activatedAt: v.number(),
    // "judge" for provisioned judge accounts.
    note: v.optional(v.string()),
  }).index("by_user_active", ["userId", "active"]),

  // One row per UTC day, counted by convex/metrics.ts from that day's rows in pages,
  // so the metrics page reads these and never the tables themselves.
  metricsDays: defineTable({
    day: v.string(),
    members: v.number(),
    generators: v.number(),
    batches: v.number(),
    designs: v.number(),
    publishedWorks: v.number(),
    remixes: v.number(),
    families: v.number(),
    creditsUsed: v.number(),
    modelPhotos: v.number(),
    // The count in progress; a newer count replaces an older one mid-way.
    runId: v.string(),
    complete: v.boolean(),
    computedAt: v.number(),
  }).index("by_day", ["day"]),

  // The UTC day each member first generated, so "members who generated" counts each once.
  metricsGenerators: defineTable({
    userId: v.id("users"),
    firstDay: v.string(),
    firstAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_firstDay", ["firstDay"]),
};
