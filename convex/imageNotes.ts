"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { VISION_MODEL } from "./lib/models";
import { writeNotes } from "./lib/notesWriter";
import { fetchPublicImage } from "./lib/storage";
import type { Id } from "./_generated/dataModel";

// Writes an image's notes once, when it first comes into the studio: what it shows (the people
// and their likeness, the words) and how it looks (technique, color, line, lettering, signature
// traits). Prompts reuse them; see docs/image-generation/README.md. The call itself is
// convex/lib/notesWriter.ts, which the image test suite uses too.
// GPT-6 Luna read stylized lettering correctly in 9 of 9 tries; pricier models misread it.
const DEFAULT_MODEL = VISION_MODEL;

export const analyze = internalAction({
  args: { imageId: v.id("userImages") },
  returns: v.null(),
  handler: async (ctx, { imageId }) => {
    const job = await ctx.runQuery(internal.images.analysisJob, { imageId });
    if (!job || job.analysis === "ready") return null;
    const model = process.env.STYLE_NOTES_MODEL ?? DEFAULT_MODEL;
    if (!process.env.AI_GATEWAY_API_KEY || job.key.startsWith("fake:")) {
      await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, error: "Style capture is not configured." });
      return null;
    }
    const started = Date.now();
    let bytes: Uint8Array;
    try {
      bytes = await fetchPublicImage(job.key, ctx);
    } catch (error) {
      await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, error: error instanceof Error ? error.message : "Image unavailable." });
      return null;
    }
    const result = await writeNotes(bytes, model);
    if (!result.ok) {
      await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, error: result.error });
      return null;
    }
    const { ok: _ok, ...parsed } = result;
    console.log("imageNotes ok", imageId, Date.now() - started, "ms", parsed.kind, parsed.summary);
    await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, ...parsed });
    return null;
  },
});

// Notes for a published design, written once and kept on the work, so everyone who remixes it
// starts from them: what it shows, every piece of its text, and how it looks. The creator's own
// notes for the same file are reused when they exist.
// What happened, for the backfill's counts: notes written (or copied from the creator's own),
// notes already there, nothing to do here (no work, no gateway key, or a stand-in image), or a
// failed read (logged, and the work keeps no notes until it's run again).
const workNotesOutcome = v.union(v.literal("written"), v.literal("exists"), v.literal("skipped"), v.literal("failed"));

export const analyzeWork = internalAction({
  args: { workId: v.id("works") },
  returns: workNotesOutcome,
  handler: async (ctx, { workId }): Promise<"written" | "exists" | "skipped" | "failed"> => {
    const job = await ctx.runQuery(internal.images.workNotesJob, { workId });
    if (!job) return "skipped";
    if (job.hasNotes) return "exists";
    if (job.copy) {
      await ctx.runMutation(internal.images.saveWorkNotes, { workId, ...job.copy });
      return "written";
    }
    const model = process.env.STYLE_NOTES_MODEL ?? DEFAULT_MODEL;
    if (!process.env.AI_GATEWAY_API_KEY || job.artKey.startsWith("fake:")) return "skipped";
    let bytes: Uint8Array;
    try {
      bytes = await fetchPublicImage(job.artKey, ctx);
    } catch (error) {
      console.error("analyzeWork failed", workId, error instanceof Error ? error.message : "Image unavailable.");
      return "failed";
    }
    const result = await writeNotes(bytes, model, job.request);
    if (!result.ok) {
      console.error("analyzeWork failed", workId, result.error);
      return "failed";
    }
    const { ok: _ok, ...parsed } = result;
    if (!parsed.notes) {
      console.error("analyzeWork failed", workId, "The notes came back empty.");
      return "failed";
    }
    await ctx.runMutation(internal.images.saveWorkNotes, { workId, model, ...parsed, notes: parsed.notes });
    return "written";
  },
});

// Writes notes for published works that don't have them: bunx convex run imageNotes:backfillWorks
// (production: --prod). Safe to run again. written counts only notes that were saved; a work
// under failed (logged) keeps none until the backfill runs again, and skipped means no gateway key.
export const backfillWorks = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), written: v.number(), failed: v.number(), skipped: v.number() }),
  handler: async (ctx): Promise<{ checked: number; written: number; failed: number; skipped: number }> => {
    const workIds: Array<Id<"works">> = await ctx.runQuery(internal.images.worksWithoutNotes, {});
    const counts = { written: 0, failed: 0, skipped: 0 };
    for (let i = 0; i < workIds.length; i += 4) {
      await Promise.all(
        workIds.slice(i, i + 4).map(async (workId) => {
          const outcome = await ctx.runAction(internal.imageNotes.analyzeWork, { workId });
          if (outcome === "written") counts.written++;
          else if (outcome === "failed") counts.failed++;
          else if (outcome === "skipped") counts.skipped++;
        }),
      );
    }
    console.log("imageNotes.backfillWorks done", { checked: workIds.length, ...counts });
    return { checked: workIds.length, ...counts };
  },
});
