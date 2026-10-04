import { defineTable } from "convex/server";
import { v } from "convex/values";

// The early-access list (V1 amendment A6; Checkpoint 0 KTD-O). Nobody is emailed yet: opening
// checkout emails it. One row per (emailLower, kind, workId); workId is absent for the site-wide
// list. waitlistTotals keeps a running count per work so admin never scans the list to count it.
export const publishTables = {
  waitlist: defineTable({
    emailLower: v.string(),
    kind: v.union(v.literal("buy"), v.literal("creator")),
    workId: v.optional(v.id("works")),
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_email_kind_work", ["emailLower", "kind", "workId"])
    .index("by_kind_created", ["kind", "createdAt"])
    .index("by_work", ["workId"]),

  waitlistTotals: defineTable({
    kind: v.union(v.literal("buy"), v.literal("creator")),
    workId: v.optional(v.id("works")),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_kind_work", ["kind", "workId"])
    .index("by_kind_count", ["kind", "count"]),
};
