"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { mimeOf } from "./imageGen";
import { decodeRgba, encodeRgba } from "./lib/gridCut";
import { STYLE_NOTES_PROMPT, parseStyleNotes } from "./lib/prompts";
import { fetchPublicImage } from "./lib/storage";

// Writes an image's notes once, when it first comes into the studio: what it shows (the people
// and their likeness, the words) and how it looks (technique, color, line, lettering, signature
// traits). Prompts reuse them; see docs/image-generation/README.md.
// GPT-6 Luna read stylized lettering correctly in 9 of 9 tries; pricier models misread it.
const DEFAULT_MODEL = "openai/gpt-6-luna";
const TIMEOUT_MS = 90_000;

// Vision models see clear pixels as black, so a transparent PNG goes on flat gray first.
function onGray(bytes: Uint8Array) {
  if (mimeOf(bytes) !== "image/png") return { bytes, transparent: false };
  try {
    const image = decodeRgba(bytes);
    const { data } = image;
    let clear = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        clear = true;
        break;
      }
    }
    if (!clear) return { bytes, transparent: false };
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      out[i] = Math.round(data[i] * a + 128 * (1 - a));
      out[i + 1] = Math.round(data[i + 1] * a + 128 * (1 - a));
      out[i + 2] = Math.round(data[i + 2] * a + 128 * (1 - a));
      out[i + 3] = 255;
    }
    return { bytes: encodeRgba({ width: image.width, height: image.height, data: out }), transparent: true };
  } catch {
    return { bytes, transparent: false };
  }
}

// One image's notes from the vision model (STYLE_NOTES_PROMPT), tried twice.
async function writeNotes(original: Uint8Array, model: string) {
  let lastError = "Style capture failed.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { bytes, transparent } = onGray(original);
      const ask = transparent
        ? "Write the notes for this image. The flat gray around the design is a transparent background, not part of the design."
        : "Write the notes for this image.";
      const result = await generateText({
        model: gateway(model),
        system: STYLE_NOTES_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: bytes, mediaType: mimeOf(bytes) },
              { type: "text", text: ask },
            ],
          },
        ],
        providerOptions: { openai: { reasoningEffort: "low" } },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: true as const, ...parseStyleNotes(result.text) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("imageNotes attempt failed", attempt, lastError);
    }
  }
  return { ok: false as const, error: lastError };
}

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
