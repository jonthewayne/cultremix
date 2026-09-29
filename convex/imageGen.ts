"use node";

import { createHash } from "node:crypto";
import { gateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { designPrompt, photoPrompt } from "./lib/prompts";
import { isDevDeployment, publicUrl, r2, r2Configured } from "./lib/r2";

const DESIGN_TIMEOUT_MS = 170_000;
const INSPIRATION_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// PNG color types 4 and 6 carry an alpha channel; 3 may carry tRNS.
function pngInfo(bytes: Uint8Array) {
  const isPng = bytes.length > 26 && bytes[0] === 0x89 && bytes[1] === 0x50;
  if (!isPng) return { width: 0, height: 0, hasAlpha: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25];
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    hasAlpha: colorType === 4 || colorType === 6 || colorType === 3,
  };
}

function readableError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Timed out.";
    return error.message.slice(0, 200) || "The image service failed.";
  }
  return "The image service failed.";
}

export async function fetchPublicImage(key: string) {
  const url = publicUrl(key);
  if (!url || url.startsWith("fake:")) throw new Error("Image unavailable.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function liveGeneration() {
  return Boolean(process.env.AI_GATEWAY_API_KEY) && r2Configured();
}

// One transparent 1024x1536 design: Sunburst edit with an image, Flare for text only.
async function designImage(model: string, text: string, image?: Uint8Array) {
  const result = await generateImage({
    model: gateway.image(model),
    prompt: image ? { images: [image], text } : text,
    size: "1024x1536",
    providerOptions: {
      openai: {
        background: "transparent",
        output_format: "png",
        quality: process.env.IMAGE_QUALITY ?? "medium",
      },
    },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(DESIGN_TIMEOUT_MS),
  });
  return { bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata };
}

// The model photo: one opaque 1024x1024 Sunburst edit with the design as input.
async function photoImage(art: Uint8Array, backgroundColor: string) {
  const result = await generateImage({
    model: gateway.image("openai/gpt-image-2.5-sunburst"),
    prompt: { images: [art], text: photoPrompt(backgroundColor) },
    size: "1024x1024",
    providerOptions: {
      openai: {
        background: "opaque",
        output_format: "png",
        quality: process.env.PHOTO_QUALITY ?? "medium",
      },
    },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(DESIGN_TIMEOUT_MS),
  });
  return { bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata };
}

async function storePng(ctx: Parameters<typeof r2.store>[0], prefix: string, bytes: Uint8Array) {
  const sha256 = sha256Hex(bytes);
  const key = `${prefix}/${sha256}.png`;
  await r2.store(ctx, bytes, {
    key,
    type: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  });
  return { key, sha256 };
}

export const runTile = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, { generationId }) => {
    const job = await ctx.runQuery(internal.studio.tileJob, { generationId });
    if (!job || job.status !== "queued") return null;
    const claimed = await ctx.runMutation(internal.studio.markDispatched, { generationId });
    if (!claimed) return null;

    try {
      if (!liveGeneration()) {
        if (!isDevDeployment()) throw new Error("Image generation is not configured.");
        // Dev stand-in until the gateway and R2 keys exist.
        await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 3500));
        await ctx.runMutation(internal.studio.markSucceeded, {
          generationId,
          fullKey: `fake:${generationId}`,
          width: 1024,
          height: 1536,
          hasAlpha: true,
        });
        return null;
      }

      const text = designPrompt({
        instruction: job.instruction,
        presets: job.presets,
        hasInspiration: Boolean(job.inspirationKey),
      });
      const image = job.inspirationKey ? await fetchPublicImage(job.inspirationKey) : undefined;
      const started = Date.now();
      const { bytes } = await designImage(job.model, text, image);
      const info = pngInfo(bytes);
      const { key, sha256 } = await storePng(ctx, "gen", bytes);
      console.log("runTile ok", job.model, Date.now() - started, "ms", info);
      await ctx.runMutation(internal.studio.markSucceeded, {
        generationId,
        fullKey: key,
        sha256,
        width: info.width || 1024,
        height: info.height || 1536,
        hasAlpha: info.hasAlpha,
      });
    } catch (error) {
      console.error("runTile failed", generationId, error);
      await ctx.runMutation(internal.studio.markFailed, {
        generationId,
        error: readableError(error),
      });
    }
    return null;
  },
});

// The browser downsizes the inspiration image (long side <= 1024 px) and sends
// the bytes here; they are stored content-addressed in the public bucket.
export const uploadInspiration = action({
  args: { bytes: v.bytes(), contentType: v.string() },
  returns: v.object({ key: v.string(), url: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
    const ext = INSPIRATION_TYPES[args.contentType];
    if (!ext) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Use a PNG, JPEG, or WebP image." });
    }
    if (args.bytes.byteLength > 8 * 1024 * 1024) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "That image is too large." });
    }
    const bytes = new Uint8Array(args.bytes);
    if (!r2Configured()) {
      if (isDevDeployment()) return { key: `fake:inspo-${sha256Hex(bytes).slice(0, 12)}` };
      throw new ConvexError({ code: "NOT_CONFIGURED", message: "Uploads are not configured." });
    }
    const key = `inspo/${sha256Hex(bytes)}.${ext}`;
    await r2.store(ctx, bytes, {
      key,
      type: args.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    return { key, url: publicUrl(key) };
  },
});

// Publish step: copy the picked generation to art/<sha256>.png, record it, then
// shoot the model photo (one Sunburst edit, opaque 1024x1024).
export const publishAssets = internalAction({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, { workId }) => {
    const job = await ctx.runQuery(internal.publish.assetJob, { workId });
    if (!job) return null;
    let artKey: string;
    let contentHash: string;
    try {
      if (job.fullKey.startsWith("fake:")) {
        artKey = job.fullKey;
        contentHash = sha256Hex(new TextEncoder().encode(job.fullKey));
      } else {
        const bytes = await fetchPublicImage(job.fullKey);
        contentHash = sha256Hex(bytes);
        artKey = `art/${contentHash}.png`;
        await r2.store(ctx, bytes, {
          key: artKey,
          type: "image/png",
          cacheControl: "public, max-age=31536000, immutable",
        });
      }
    } catch (error) {
      console.error("publishAssets failed", workId, error);
      await ctx.runMutation(internal.publish.markAssetFailed, {
        workId,
        error: readableError(error),
      });
      return null;
    }
    const shootId = await ctx.runMutation(internal.publish.markPublished, {
      workId,
      artKey,
      contentHash,
    });
    if (!shootId) return null;

    try {
      let photoKey: string;
      if (!liveGeneration() || artKey.startsWith("fake:")) {
        if (!isDevDeployment()) throw new Error("Image generation is not configured.");
        await new Promise((resolve) => setTimeout(resolve, 4000));
        photoKey = `fake:photo-${workId}`;
      } else {
        const art = await fetchPublicImage(artKey);
        const { bytes } = await photoImage(art, job.backgroundColor);
        photoKey = (await storePng(ctx, "photo", bytes)).key;
      }
      await ctx.runMutation(internal.publish.recordPhoto, { shootId, publicKey: photoKey });
    } catch (error) {
      console.error("model photo failed", workId, error);
      await ctx.runMutation(internal.publish.recordPhotoFailed, {
        shootId,
        reason: readableError(error),
      });
    }
    return null;
  },
});

// Diagnostic for the real image path: `bunx convex run imageGen:selfTest '{"mode":"text"}'`,
// then "edit" or "photo" with the returned key as `imageKey`. Stores the result in R2.
export const selfTest = internalAction({
  args: {
    mode: v.union(v.literal("text"), v.literal("edit"), v.literal("photo")),
    imageKey: v.optional(v.string()),
    instruction: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!liveGeneration()) return { error: "AI_GATEWAY_API_KEY or R2 keys are missing." };
    const started = Date.now();
    const instruction = args.instruction ?? "A neon motel sign that says NO VACANCY FOR BAD VIBES";
    try {
      let out;
      if (args.mode === "photo") {
        if (!args.imageKey) return { error: "photo needs imageKey" };
        out = await photoImage(await fetchPublicImage(args.imageKey), "#143cc8");
      } else if (args.mode === "edit") {
        if (!args.imageKey) return { error: "edit needs imageKey" };
        out = await designImage(
          "openai/gpt-image-2.5-sunburst",
          designPrompt({ instruction, presets: [], hasInspiration: true }),
          await fetchPublicImage(args.imageKey),
        );
      } else {
        out = await designImage(
          "openai/gpt-image-2.5-flare",
          designPrompt({ instruction, presets: [], hasInspiration: false }),
        );
      }
      const { key } = await storePng(ctx, args.mode === "photo" ? "photo" : "gen", out.bytes);
      return {
        ms: Date.now() - started,
        bytes: out.bytes.byteLength,
        png: pngInfo(out.bytes),
        key,
        url: publicUrl(key),
        warnings: JSON.parse(JSON.stringify(out.warnings ?? [])),
        providerMetadata: JSON.parse(JSON.stringify(out.providerMetadata ?? {})),
      };
    } catch (error) {
      return { ms: Date.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
  },
});
