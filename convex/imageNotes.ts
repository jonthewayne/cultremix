"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
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
    let lastError = "Style capture failed.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { bytes, transparent } = onGray(await fetchPublicImage(job.key, ctx));
        const ask = transparent
          ? "Write the notes for this image. The flat gray around the design is a transparent background, not part of the design."
          : "Write the notes for this image.";
        const started = Date.now();
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
        const parsed = parseStyleNotes(result.text);
        console.log("imageNotes ok", imageId, Date.now() - started, "ms", parsed.kind, parsed.summary);
        await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, ...parsed });
        return null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error("imageNotes failed", imageId, attempt, lastError);
      }
    }
    await ctx.runMutation(internal.images.saveAnalysis, { imageId, model, error: lastError });
    return null;
  },
});
