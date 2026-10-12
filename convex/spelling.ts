import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { wordsToCheck } from "./lib/spelling";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// The studio's spelling check. Once a batch's designs are in, each one's lettering is read back
// (convex/spellingCheck.ts), and any asked-for word it drew a letter or two off is saved on it, so
// the studio can say "It reads TRROSH where you asked for TRASH" and offer to fix it. Designs whose
// batch asked for no words aren't read. About 0.3¢ a design, which the studio absorbs.

const missValidator = v.object({ asked: v.string(), read: v.string() });

// Starts the check for a batch's finished designs, when the batch asked for words.
export async function scheduleSpellingCheck(ctx: MutationCtx, batch: Doc<"batches">, generationIds: Array<Id<"generations">>) {
  if (generationIds.length === 0 || wordsToCheck(batch).length === 0) return;
  await ctx.scheduler.runAfter(0, internal.spellingCheck.run, { generationIds });
}

// What to read: each finished design not read yet, with its batch's words.
export const jobs = internalQuery({
  args: { generationIds: v.array(v.id("generations")) },
  returns: v.array(v.object({ generationId: v.id("generations"), key: v.string(), words: v.array(v.string()) })),
  handler: async (ctx, args) => {
    const out = [];
    for (const generationId of args.generationIds) {
      const g = await ctx.db.get("generations", generationId);
      if (!g || g.status !== "succeeded" || !g.fullKey || g.spelling || g.kind === "tool" || g.kind === "shoot") continue;
      const batch = await ctx.db.get("batches", g.batchId);
      const words = batch ? wordsToCheck(batch) : [];
      if (words.length > 0) out.push({ generationId, key: g.fullKey, words });
    }
    return out;
  },
});

export const save = internalMutation({
  args: {
    generationId: v.id("generations"),
    misses: v.optional(v.array(missValidator)),
    read: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const g = await ctx.db.get("generations", args.generationId);
    if (!g) return null;
    await ctx.db.patch("generations", g._id, {
      spelling: {
        status: args.misses ? "checked" : "failed",
        misses: args.misses ?? [],
        ...(args.read ? { read: args.read.slice(0, 30).map((word) => word.slice(0, 80)) } : {}),
        ...(args.error ? { error: args.error.slice(0, 200) } : {}),
        checkedAt: Date.now(),
      },
    });
    return null;
  },
});
