import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { KIND_CODES, reasonHashFor } from "./lib/chain/ids";
import { amendmentPayload, chainWritesEnabled, enqueueAmendment, writeBySubject } from "./lib/chain/queue";
import { parsePayload } from "./lib/chain/writes";
import type { WorkKind } from "./lib/chain/ids";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Hex } from "viem";

// Lineage corrections onchain (R19, the registry half). The registry admin appends amendment n to
// a work's lineage; the original record stays. queueLineageAmendment checks a correction against
// the lineage the registry holds now (the original record plus confirmed amendments) with the
// contract's own rules, then queues it for the relayer. The admin flow and the lineageAmendments
// table live in convex/lineage.ts: sendRequestedCorrections (run by the chain kick) sends its
// requested rows through queueLineageAmendment, and the engine's outcome for the write confirms
// or rejects the row (reflect in convex/chain.ts).

// CultRemixRegistry.MAX_AMEND_HOPS.
const MAX_AMEND_HOPS = 64;

const KIND_BY_CODE = Object.fromEntries(Object.entries(KIND_CODES).map(([kind, code]) => [code, kind])) as Record<number, WorkKind>;

function refuse(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** A work's amendment writes in sequence order (1, 2, …). */
async function amendmentWrites(ctx: MutationCtx, workId: Id<"works">) {
  const writes: Array<Doc<"chainWrites">> = [];
  for (let sequence = 1; ; sequence += 1) {
    const write = await writeBySubject(ctx, `amend:${workId}:${sequence}`);
    if (!write) return writes;
    writes.push(write);
  }
}

/** The lineage the registry holds for a work: its original record with confirmed amendments applied. */
async function effectiveLineage(ctx: MutationCtx, work: Doc<"works">) {
  let kind: WorkKind = work.kind;
  let parentWorkId: Id<"works"> | null = work.parentWorkId ?? null;
  let confirmed = 0;
  for (const write of await amendmentWrites(ctx, work._id)) {
    if (write.status !== "confirmed" || !write.payload) continue;
    const payload = parsePayload("amendLineage", write.payload);
    if (payload.kind !== "amendLineage") continue;
    kind = KIND_BY_CODE[payload.record.newKind];
    parentWorkId = write.newParentWorkId ?? null;
    confirmed += 1;
  }
  return { kind, parentWorkId, confirmed };
}

/**
 * Queues amendment `sequence` of a work's lineage. Refuses (ConvexError with a code) anything the
 * registry would revert: an unregistered work or parent, a sequence other than the next one, a
 * kind change other than original ↔ fork, a parent that breaks the family rule, or a cycle.
 * Asking again for an amendment that is still being recorded returns the same write.
 */
export const queueLineageAmendment = internalMutation({
  args: {
    workId: v.id("works"),
    newParentWorkId: v.union(v.null(), v.id("works")),
    newKind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
    // keccak256 of the written reason (reasonHashFor in convex/lib/chain/ids.ts).
    reasonHash: v.string(),
    sequence: v.number(),
  },
  returns: v.id("chainWrites"),
  handler: async (ctx, args) => {
    if (!/^0x[0-9a-f]{64}$/iu.test(args.reasonHash)) refuse("BAD_REASON_HASH", "The reason hash must be 32 bytes of hex.");
    const work = await ctx.db.get("works", args.workId);
    if (!work) refuse("NOT_FOUND", "That work doesn't exist.");
    if (work.provenanceStatus !== "confirmed") refuse("NOT_REGISTERED", "This work isn't registered on Monad yet.");
    const newParent = args.newParentWorkId ? await ctx.db.get("works", args.newParentWorkId) : null;
    if (args.newParentWorkId && !newParent) refuse("NOT_FOUND", "The new parent doesn't exist.");
    const request = { work, newParent, newKind: args.newKind, reasonHash: args.reasonHash as Hex, sequence: args.sequence };

    const writes = await amendmentWrites(ctx, work._id);
    const last = writes[writes.length - 1];
    if (last && last.status !== "confirmed" && last.status !== "failed" && last.status !== "rejected") {
      if (writes.length === args.sequence && last.payload === amendmentPayload(request)) return last._id;
      refuse("IN_FLIGHT", `Amendment ${writes.length} for this work is still being recorded.`);
    }
    const current = await effectiveLineage(ctx, work);
    if (args.sequence !== current.confirmed + 1) refuse("BAD_SEQUENCE", `The next amendment for this work is #${current.confirmed + 1}.`);

    if (args.newKind !== current.kind) {
      const swap = new Set([args.newKind, current.kind]);
      if (!(swap.has("original") && swap.has("fork"))) refuse("KIND_CHANGE_NOT_ALLOWED", "A work's kind changes only between original and fork.");
    }
    if (args.newKind === "original") {
      if (newParent) refuse("PARENT_NOT_ALLOWED", "An original has no parent.");
    } else {
      if (!newParent) refuse("PARENT_REQUIRED", `A ${args.newKind} needs a parent.`);
      if (newParent._id === work._id) refuse("LINEAGE_CYCLE", "A work can't be its own parent.");
      if (newParent.provenanceStatus !== "confirmed") refuse("PARENT_NOT_REGISTERED", "The new parent isn't registered on Monad yet.");
      if (args.newKind === "fork" ? newParent.crFamily === work.crFamily : newParent.crFamily !== work.crFamily) {
        refuse("FAMILY_MISMATCH", args.newKind === "fork" ? "A fork's parent is in another family." : "A variation's parent is in its own family.");
      }
      // The registry walks effective parents from the new parent, up to 64 of them.
      let cursor: Id<"works"> | null = newParent._id;
      for (let visited = 0; cursor; visited += 1) {
        if (visited === MAX_AMEND_HOPS) refuse("LINEAGE_TOO_DEEP", "The new parent's lineage is too long to check.");
        if (cursor === work._id) refuse("LINEAGE_CYCLE", "The new parent descends from this work.");
        const ancestor: Doc<"works"> | null = await ctx.db.get("works", cursor);
        cursor = ancestor ? (await effectiveLineage(ctx, ancestor)).parentWorkId : null;
      }
    }
    return await enqueueAmendment(ctx, request);
  },
});

// Refusals that can clear on their own: the work or new parent is still registering, or the
// work's previous amendment is still being recorded. The correction waits; anything else rejects it.
const WAIT_CODES = new Set(["NOT_REGISTERED", "PARENT_NOT_REGISTERED", "IN_FLIGHT"]);

/**
 * Sends requested lineage corrections to the registry while chain.writes is on: each one goes
 * through queueLineageAmendment (a sub-transaction, so a refusal leaves nothing behind), its write
 * remembers the correction, and the correction becomes submitted. Returns how many were sent.
 */
export async function sendRequestedCorrections(ctx: MutationCtx): Promise<number> {
  if (!(await chainWritesEnabled(ctx))) return 0;
  const rows = await ctx.runQuery(internal.lineage.requestedForChain, { limit: 100 });
  let sent = 0;
  for (const row of rows) {
    let writeId: Id<"chainWrites">;
    try {
      writeId = await ctx.runMutation(internal.amendments.queueLineageAmendment, {
        workId: row.workId,
        newParentWorkId: row.newParentId ?? null,
        newKind: row.newKind,
        reasonHash: reasonHashFor(row.reason),
        sequence: row.chainSequence,
      });
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      const { code, message } = error.data as { code: string; message: string };
      if (!WAIT_CODES.has(code)) await ctx.runMutation(internal.lineage.markRejected, { amendmentId: row.amendmentId, reason: message });
      continue;
    }
    const write = await ctx.db.get("chainWrites", writeId);
    if (!write) continue;
    if (write.amendmentId && write.amendmentId !== row.amendmentId) {
      // Already recording another open correction of the same change; this one waits its turn.
      const other = await ctx.db.get("lineageAmendments", write.amendmentId);
      if (other && (other.status === "requested" || other.status === "submitted")) continue;
    }
    await ctx.db.patch("chainWrites", writeId, { amendmentId: row.amendmentId });
    await ctx.runMutation(internal.lineage.markSubmitted, { amendmentId: row.amendmentId, chainWriteId: writeId });
    sent += 1;
  }
  return sent;
}
