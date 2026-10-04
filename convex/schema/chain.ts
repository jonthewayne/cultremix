import { defineTable } from "convex/server";
import { v } from "convex/values";

// Onchain provenance (convex/chain.ts): the relayer's write queue, its nonce lease, and Backs.

export const chainWriteKindValidator = v.union(
  v.literal("registerWork"),
  v.literal("back"),
  v.literal("amendLineage"),
  v.literal("registerEconomicConfig"),
);

// waiting_wallet  the member's wallet isn't ready yet
// waiting_parent  the parent work's registration hasn't confirmed yet
// pending         ready to sign and send (held while the relayer is stalled or writes are off)
// submitted       a transaction with this write's nonce is persisted and broadcast
// confirmed       a successful receipt in a finalized, canonical block (or matching finalized state)
// rejected        a registry rule refused it (final)
// failed          anything else (final; an admin can enqueue it again)
export const chainWriteStatusValidator = v.union(
  v.literal("waiting_wallet"),
  v.literal("waiting_parent"),
  v.literal("pending"),
  v.literal("submitted"),
  v.literal("confirmed"),
  v.literal("rejected"),
  v.literal("failed"),
);

export const chainTxValidator = v.object({
  hash: v.string(),
  rawTx: v.string(),
  gas: v.string(),
  maxFeePerGas: v.string(),
  maxPriorityFeePerGas: v.string(),
  // Latest block number when it was signed; inclusion is timed from here.
  sentBlock: v.number(),
  sentAt: v.number(),
});

export const provenanceStatusValidator = v.union(
  v.literal("pending"),
  v.literal("submitted"),
  v.literal("confirmed"),
  v.literal("failed"),
);

export const backStatusValidator = v.union(
  v.literal("reserved"),
  v.literal("submitted"),
  v.literal("confirmed"),
  v.literal("rejected"),
  v.literal("failed"),
);

export const chainTables = {
  chainWrites: defineTable({
    kind: chainWriteKindValidator,
    // work:<workId> | back:<workId>:<userId> | amend:<workId>:<sequence> | config:<version>
    subjectKey: v.string(),
    status: chainWriteStatusValidator,
    // Bound when the write is first signed or sent. A pending write bound to another chain or
    // registry than the deployment's fails closed.
    chainId: v.optional(v.number()),
    registryAddress: v.optional(v.string()),
    workId: v.optional(v.id("works")),
    // The member who signs: the creator for registerWork, the backer for back.
    userId: v.optional(v.id("users")),
    backId: v.optional(v.id("backs")),
    // registerWork of a remix: the parent's write, which must confirm first.
    dependsOnWriteId: v.optional(v.id("chainWrites")),
    // amendLineage: the new parent work (none for an original), for walking effective lineage.
    newParentWorkId: v.optional(v.id("works")),
    // amendLineage: the correction it records (convex/lineage.ts), which follows its outcome.
    amendmentId: v.optional(v.id("lineageAmendments")),
    // The record being written, JSON with bigints as decimal strings. Amendments and configs
    // carry it from the start; registerWork and back fill it in when first signed and keep it
    // for every re-sign (only the deadline changes).
    payload: v.optional(v.string()),
    signature: v.optional(v.string()),
    signatureDeadline: v.optional(v.number()),
    signer: v.optional(v.string()),
    nonce: v.optional(v.number()),
    // Every transaction sent for the current nonce: the first, then fee replacements.
    txs: v.array(chainTxValidator),
    replacements: v.number(),
    lastBroadcastError: v.optional(v.string()),
    txHash: v.optional(v.string()),
    blockNumber: v.optional(v.number()),
    // Backed event data from the finalized receipt.
    result: v.optional(v.object({ ordinal: v.number(), week: v.number() })),
    revertReason: v.optional(v.string()),
    error: v.optional(v.string()),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_subjectKey", ["subjectKey"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_dependsOn_and_status", ["dependsOnWriteId", "status"]),

  // One row per (chain, relayer). The lease serializes nonce use across concurrent actions.
  relayerState: defineTable({
    key: v.string(),
    chainId: v.number(),
    relayerAddress: v.string(),
    nextNonce: v.optional(v.number()),
    leaseOwner: v.optional(v.string()),
    leaseGeneration: v.number(),
    leaseExpiresAt: v.number(),
    // A nonce that would not go through: later writes are signed but held until an admin clears it.
    stalled: v.optional(
      v.object({
        nonce: v.number(),
        writeId: v.optional(v.id("chainWrites")),
        since: v.number(),
        reason: v.string(),
      }),
    ),
    // The zero-value self-transfer sent to clear a stalled nonce, until it is included.
    clearTx: v.optional(
      v.object({ nonce: v.number(), hash: v.string(), rawTx: v.string(), sentAt: v.number(), sentBlock: v.number() }),
    ),
    lastTickAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // R28/R29. A member Backs a work at most once and at most 3 times per registry week (counting
  // reserved, submitted, and confirmed). The ordinal comes from the chain's Backed event.
  backs: defineTable({
    workId: v.id("works"),
    backerId: v.id("users"),
    status: backStatusValidator,
    // Registry week: floor((t − 2026-09-28T00:00Z) / 7 days). Admission uses the request time;
    // a confirmed Back takes the chain's week.
    week: v.number(),
    ordinal: v.optional(v.number()),
    chainWriteId: v.optional(v.id("chainWrites")),
    txHash: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_backer_and_week", ["backerId", "week"])
    .index("by_work_and_backer", ["workId", "backerId"])
    .index("by_work_and_ordinal", ["workId", "ordinal"]),
};
