import { defineTable } from "convex/server";
import { v } from "convex/values";

// CultRemix tables for the 2026-09-29 sprint. Names follow the Checkpoint 0
// plan's "Settled validators"; fields not needed today are optional, and
// today's additions are noted in docs/hackathon/log.md.
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
    generationId: v.optional(v.id("generations")),
  }).index("by_user", ["userId"]),

  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
  }).index("by_key", ["key"]),

  counters: defineTable({
    name: v.string(),
    next: v.number(),
  }).index("by_name", ["name"]),

  crFamilies: defineTable({
    family: v.number(),
    nextExpression: v.number(),
    rootWorkId: v.optional(v.id("works")),
  }).index("by_family", ["family"]),

  creativeSessions: defineTable({
    ownerId: v.id("users"),
    updatedAt: v.number(),
    phrase: v.string(),
    styleDirection: v.string(),
    presets: v.array(v.string()),
    remixOfWorkId: v.optional(v.id("works")),
    remixMode: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
    purpose: v.optional(v.union(v.literal("studio"), v.literal("shoot"))),
  }).index("by_owner_updated", ["ownerId", "updatedAt"]),

  // Today's additions: instruction, inspirationKey, backgroundColor, operation, model.
  batches: defineTable({
    sessionId: v.id("creativeSessions"),
    ownerId: v.id("users"),
    instruction: v.string(),
    presets: v.array(v.string()),
    inspirationKey: v.optional(v.string()),
    backgroundColor: v.string(),
    operation: v.union(v.literal("create"), v.literal("edit"), v.literal("remix")),
    model: v.string(),
    count: v.number(),
  }).index("by_session", ["sessionId"]),

  generations: defineTable({
    sessionId: v.id("creativeSessions"),
    batchId: v.id("batches"),
    ownerId: v.id("users"),
    index: v.number(),
    kind: v.union(
      v.literal("concept"),
      v.literal("branch"),
      v.literal("edit"),
      v.literal("remix"),
      v.literal("tool"),
      v.literal("shoot"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("dispatched"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("needs_provider_choice"),
      v.literal("unknown_outcome"),
      v.literal("refused"),
      v.literal("expired"),
    ),
    provider: v.string(),
    model: v.string(),
    charged: v.boolean(),
    dispatchedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    favorite: v.boolean(),
    favoritedAt: v.optional(v.number()),
    rejected: v.optional(v.boolean()),
    fullKey: v.optional(v.string()),
    sha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    hasAlpha: v.optional(v.boolean()),
    error: v.optional(v.string()),
  })
    .index("by_batch", ["batchId"])
    .index("by_session_favorite", ["sessionId", "favorite", "favoritedAt"]),

  works: defineTable({
    crFamily: v.number(),
    crExpression: v.number(),
    creatorId: v.id("users"),
    kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
    parentWorkId: v.optional(v.id("works")),
    familyRootId: v.optional(v.id("works")),
    generationId: v.id("generations"),
    requestId: v.string(),
    title: v.optional(v.string()),
    backgroundColor: v.string(),
    status: v.union(
      v.literal("preparing"),
      v.literal("published"),
      v.literal("withdrawn"),
      v.literal("asset_failed"),
    ),
    assetError: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    artKey: v.optional(v.string()),
  })
    .index("by_status_publishedAt", ["status", "publishedAt"])
    .index("by_family_expression", ["crFamily", "crExpression"])
    .index("by_parent", ["parentWorkId"])
    .index("by_requestId", ["requestId"])
    .index("by_creator", ["creatorId"]),

  shoots: defineTable({
    workId: v.id("works"),
    status: v.union(
      v.literal("not_started"),
      v.literal("running"),
      v.literal("done"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    reason: v.optional(v.string()),
    requestedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    castingNote: v.optional(v.string()),
    pose: v.optional(v.string()),
    world: v.optional(v.string()),
  }).index("by_work", ["workId"]),

  shootPhotos: defineTable({
    shootId: v.id("shoots"),
    workId: v.id("works"),
    index: v.number(),
    state: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
    reason: v.optional(v.string()),
    publicKey: v.optional(v.string()),
  })
    .index("by_shoot_index", ["shootId", "index"])
    .index("by_work", ["workId"]),
};
