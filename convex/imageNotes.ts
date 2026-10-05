"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { VISION_MODEL } from "./lib/models";
import { writeNotes } from "./lib/notesWriter";
import { fetchPublicImage } from "./lib/storage";

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
export const analyzeWork = internalAction({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, { workId }) => {
    const job = await ctx.runQuery(internal.images.workNotesJob, { workId });
    if (!job || job.hasNotes) return null;
    if (job.copy) {
      await ctx.runMutation(internal.images.saveWorkNotes, { workId, ...job.copy });
      return null;
    }
    const model = process.env.STYLE_NOTES_MODEL ?? DEFAULT_MODEL;
    if (!process.env.AI_GATEWAY_API_KEY || job.artKey.startsWith("fake:")) return null;
    const result = await writeNotes(await fetchPublicImage(job.artKey, ctx), model);
    if (!result.ok) {
      console.error("analyzeWork failed", workId, result.error);
      return null;
    }
    const { ok: _ok, ...parsed } = result;
    if (!parsed.notes) return null;
    await ctx.runMutation(internal.images.saveWorkNotes, { workId, model, ...parsed, notes: parsed.notes });
    return null;
  },
});

// Writes notes for published works that don't have them: bunx convex run imageNotes:backfillWorks
// (production: --prod). Safe to run again.
export const backfillWorks = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), written: v.number() }),
  handler: async (ctx): Promise<{ checked: number; written: number }> => {
    const workIds: Array<Id<"works">> = await ctx.runQuery(internal.images.worksWithoutNotes, {});
    let written = 0;
    for (let i = 0; i < workIds.length; i += 4) {
      await Promise.all(
        workIds.slice(i, i + 4).map(async (workId) => {
          await ctx.runAction(internal.imageNotes.analyzeWork, { workId });
          written++;
        }),
      );
    }
    console.log("imageNotes.backfillWorks done", { checked: workIds.length, written });
    return { checked: workIds.length, written };
  },
});
