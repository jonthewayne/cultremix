import { defineTable } from "convex/server";
import { v } from "convex/values";

export const workKindValidator = v.union(
  v.literal("original"),
  v.literal("variation"),
  v.literal("fork"),
);

export const amendmentStatusValidator = v.union(
  v.literal("requested"),
  v.literal("submitted"),
  v.literal("confirmed"),
  v.literal("rejected"),
);

// Lineage corrections (V1 plan "Lineage amendments", R19, INV-21). Append-only: a work's original
// parentWorkId and kind never change; a confirmed amendment updates works.effectiveParentWorkId and
// works.effectiveKind. Rows move requested -> submitted -> confirmed, or to rejected.
export const lineageTables = {
  lineageAmendments: defineTable({
    workId: v.id("works"),
    // Position in this work's history, 1..n, counting every row (rejected ones too).
    sequence: v.number(),
    // The registry's amendLineage sequence: confirmed onchain amendments before this one + 1.
    chainSequence: v.number(),
    // The effective lineage this amendment replaces, for the history shown on the work page.
    fromParentId: v.optional(v.id("works")),
    fromKind: workKindValidator,
    newParentId: v.optional(v.id("works")),
    newKind: workKindValidator,
    // Written by the admin; shown on the work page.
    reason: v.string(),
    adminId: v.id("users"),
    status: amendmentStatusValidator,
    requestedAt: v.number(),
    submittedAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    // Set when confirmed: the moment it became effective.
    effectiveFrom: v.optional(v.number()),
    rejectReason: v.optional(v.string()),
    // Confirmed by an admin while chain writes were off; not recorded on Monad.
    offchainOnly: v.optional(v.boolean()),
    // The chain engine's write for this amendment (its own table's ID, kept as a string).
    chainWriteId: v.optional(v.string()),
  })
    .index("by_work_sequence", ["workId", "sequence"])
    .index("by_status", ["status", "requestedAt"]),
};
