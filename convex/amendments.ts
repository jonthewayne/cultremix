import { ConvexError, v } from "convex/values";
import type { Hex } from "viem";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { KIND_CODES, type WorkKind } from "./lib/chain/ids";
import { amendmentPayload, enqueueAmendment, writeBySubject } from "./lib/chain/queue";
import { parsePayload } from "./lib/chain/writes";

// Lineage corrections onchain (R19, the registry half). The registry admin appends amendment n to
// a work's lineage; the original record stays. queueLineageAmendment checks a correction against
// the lineage the registry holds now (the original record plus confirmed amendments) with the
// contract's own rules, then queues it for the relayer. There is no UI here: the admin flow, the
// lineageAmendments table, and works.effectiveParentWorkId belong to U11, which calls this.

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
    const last = writes.at(-1);
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
