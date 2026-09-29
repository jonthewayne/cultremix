"use node";

import { createHash } from "node:crypto";
import { gateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { designPrompt, photoPrompt } from "./lib/prompts";
import { isDevDeployment, publicUrl, r2, storageMode } from "./lib/r2";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

export async function fetchPublicImage(key: string, ctx?: ActionCtx) {
  if (key.startsWith("cvx:") && ctx) {
    const blob = await ctx.storage.get(key.slice(4) as Id<"_storage">);
    if (!blob) throw new Error("Image unavailable.");
    return new Uint8Array(await blob.arrayBuffer());
  }
  const url = publicUrl(key);
  if (!url || url.startsWith("fake:")) throw new Error("Image unavailable.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

type Provider = "chatgpt" | "gateway";

// Today's order: Jon's ChatGPT login when its token is set, else the AI Gateway.
export function imageProvider(): Provider | null {
  if (process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID) return "chatgpt";
  if (process.env.AI_GATEWAY_API_KEY) return "gateway";
  return null;
}

function liveGeneration() {
  return imageProvider() !== null && storageMode() !== null;
}

function mimeOf(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/png";
}

// The Codex backend's image_generation tool, billed to the ChatGPT login.
// The image is the base64 result of the image_generation_call output item.
async function chatgptImage(args: {
  text: string;
  images: Array<Uint8Array>;
  background: "transparent" | "opaque";
  size: "1024x1536" | "1024x1024";
}) {
  const body = {
    model: process.env.CHATGPT_IMAGE_MODEL ?? "gpt-5.5",
    instructions:
      "You create t-shirt graphics and product photos. Always call the image generation tool exactly once.",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: args.text },
          ...args.images.map((bytes) => ({
            type: "input_image",
            image_url: `data:${mimeOf(bytes)};base64,${Buffer.from(bytes).toString("base64")}`,
          })),
        ],
      },
    ],
    tools: [{ type: "image_generation", background: args.background, size: args.size, output_format: "png" }],
    tool_choice: "auto",
    stream: true,
    store: false,
  };
  const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CHATGPT_ACCESS_TOKEN}`,
      "chatgpt-account-id": process.env.CHATGPT_ACCOUNT_ID ?? "",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DESIGN_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => "")).slice(0, 160);
    throw new Error(`Image service error ${response.status}. ${detail}`.trim());
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      let event: { type?: string; item?: { type?: string; result?: string }; response?: { error?: unknown }; error?: unknown };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (
        event.type === "response.output_item.done" &&
        event.item?.type === "image_generation_call" &&
        event.item.result
      ) {
        await reader.cancel().catch(() => undefined);
        return { bytes: new Uint8Array(Buffer.from(event.item.result, "base64")), warnings: [], providerMetadata: { provider: "chatgpt" } };
      }
      if (event.type === "response.failed" || event.type === "error") {
        failure = JSON.stringify(event.response?.error ?? event.error ?? event).slice(0, 200);
      }
    }
  }
  throw new Error(failure ? `The image service refused: ${failure}` : "The image service returned no image.");
}

// One transparent 1024x1536 design. Gateway: Sunburst edit with an image, Flare for text only.
async function designImage(text: string, image?: Uint8Array, provider: Provider | null = imageProvider()) {
  if (provider === "chatgpt") {
    return await chatgptImage({ text, images: image ? [image] : [], background: "transparent", size: "1024x1536" });
  }
  const model = image ? "openai/gpt-image-2.5-sunburst" : "openai/gpt-image-2.5-flare";
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

// The model photo: one opaque 1024x1024 edit with the design as input.
async function photoImage(art: Uint8Array, backgroundColor: string, provider: Provider | null = imageProvider()) {
  if (provider === "chatgpt") {
    return await chatgptImage({ text: photoPrompt(backgroundColor), images: [art], background: "opaque", size: "1024x1024" });
  }
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

async function storePng(ctx: ActionCtx, prefix: string, bytes: Uint8Array) {
  const sha256 = sha256Hex(bytes);
  if (storageMode() === "convex") {
    const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    return { key: `cvx:${id}`, sha256 };
  }
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
      const image = job.inspirationKey ? await fetchPublicImage(job.inspirationKey, ctx) : undefined;
      const started = Date.now();
      const { bytes } = await designImage(text, image);
      const info = pngInfo(bytes);
      const { key, sha256 } = await storePng(ctx, "gen", bytes);
      console.log("runTile ok", imageProvider(), Date.now() - started, "ms", info);
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
    const mode = storageMode();
    if (!mode) {
      if (isDevDeployment()) return { key: `fake:inspo-${sha256Hex(bytes).slice(0, 12)}` };
      throw new ConvexError({ code: "NOT_CONFIGURED", message: "Uploads are not configured." });
    }
    if (mode === "convex") {
      const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: args.contentType }));
      const key = `cvx:${id}`;
      return { key, url: publicUrl(key) };
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
      } else if (job.fullKey.startsWith("cvx:")) {
        // Convex storage: the generation's file is the art file.
        artKey = job.fullKey;
        contentHash = sha256Hex(await fetchPublicImage(job.fullKey, ctx));
      } else {
        const bytes = await fetchPublicImage(job.fullKey, ctx);
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
        const art = await fetchPublicImage(artKey, ctx);
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
    provider: v.optional(v.union(v.literal("chatgpt"), v.literal("gateway"))),
    imageKey: v.optional(v.string()),
    instruction: v.optional(v.string()),
    // false: call the provider only (no R2), to check the provider from Convex.
    store: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!imageProvider()) return { error: "No image provider: set CHATGPT_ACCESS_TOKEN or AI_GATEWAY_API_KEY." };
    if (args.store !== false && !storageMode()) return { error: "No image storage: R2 keys are missing and IMAGE_STORE is not convex." };
    const started = Date.now();
    const instruction = args.instruction ?? "A neon motel sign that says NO VACANCY FOR BAD VIBES";
    try {
      let out;
      if (args.mode === "photo") {
        if (!args.imageKey) return { error: "photo needs imageKey" };
        out = await photoImage(await fetchPublicImage(args.imageKey, ctx), "#143cc8", args.provider ?? imageProvider());
      } else if (args.mode === "edit") {
        if (!args.imageKey) return { error: "edit needs imageKey" };
        out = await designImage(
          designPrompt({ instruction, presets: [], hasInspiration: true }),
          await fetchPublicImage(args.imageKey, ctx),
          args.provider ?? imageProvider(),
        );
      } else {
        out = await designImage(designPrompt({ instruction, presets: [], hasInspiration: false }), undefined, args.provider ?? imageProvider());
      }
      if (args.store === false) {
        return {
          provider: args.provider ?? imageProvider(),
          ms: Date.now() - started,
          bytes: out.bytes.byteLength,
          png: pngInfo(out.bytes),
          stored: false,
        };
      }
      const { key } = await storePng(ctx, args.mode === "photo" ? "photo" : "gen", out.bytes);
      return {
        provider: imageProvider(),
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
