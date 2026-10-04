"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { cutGrid } from "./lib/gridCut";
import { GRID_EMPTY, GRID_MERGED, NO_IMAGE_REPLY } from "./lib/imageErrors";
import { stripPngMetadata } from "./lib/pngMeta";
import { photoPrompt, pickLook, rolesFromWords, studioPrompt } from "./lib/prompts";
import type { ShootLook } from "./lib/prompts";
import { isDevDeployment, publicUrl, storageMode } from "./lib/r2";
import { readRoles } from "./lib/roleReader";
import { decodeToRgba, encodePng } from "./lib/resize";
import { randomCode } from "./lib/codes";
import { designKey, gridKey as gridFileKey, photoNumberOf, testImageKey, uploadKey, workArtKey, workPhotoKey } from "./lib/sizes";
import { copyImage, fetchPublicImage, makeSizes, sha256Hex, storeNew, storeObject } from "./lib/storage";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const DESIGN_TIMEOUT_MS = 170_000;
// How long a design waits for its images' notes before going without them.
const NOTES_WAIT_MS = 15_000;
const INSPIRATION_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

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

type Provider = "chatgpt" | "gateway";

// Today's order: Jon's ChatGPT login when its token is set, else the AI Gateway.
// IMAGE_PROVIDER=gateway (or chatgpt) overrides it, so dev can test the production models.
export function imageProvider(): Provider | null {
  const forced = process.env.IMAGE_PROVIDER;
  if (forced === "gateway" && process.env.AI_GATEWAY_API_KEY) return "gateway";
  if (forced === "chatgpt" && process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID) return "chatgpt";
  if (process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID) return "chatgpt";
  if (process.env.AI_GATEWAY_API_KEY) return "gateway";
  return null;
}

function liveGeneration() {
  return imageProvider() !== null && storageMode() !== null;
}

export function mimeOf(bytes: Uint8Array) {
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
  // A reply in words with no image is almost always a refusal; keep it for the error.
  let said: string | undefined;
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
      let event: {
        type?: string;
        item?: { type?: string; result?: string };
        response?: { error?: unknown };
        error?: unknown;
        text?: string;
      };
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
      if (event.type === "response.output_text.done" && typeof event.text === "string") {
        said = event.text.slice(0, 160);
      }
    }
  }
  if (failure) throw new Error(`The image service refused: ${failure}`);
  throw new Error(said ? `${NO_IMAGE_REPLY} ${said}` : "The image service returned no image.");
}

// One transparent 1024x1536 design. Gateway: Sunburst edit with images, Flare for text only.
async function designImage(text: string, images: Array<Uint8Array>, provider: Provider | null = imageProvider()) {
  if (provider === "chatgpt") {
    return clean(await chatgptImage({ text, images, background: "transparent", size: "1024x1536" }));
  }
  const model = images.length > 0 ? "openai/gpt-image-2.5-sunburst" : "openai/gpt-image-2.5-flare";
  const result = await generateImage({
    model: gateway.image(model),
    prompt: images.length > 0 ? { images, text } : text,
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
  return clean({ bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata });
}

// The model's PNG without its metadata: the C2PA content credential, text, and timestamps. The
// pixels are untouched. Everything that hashes, cuts, or stores a model image starts from these
// bytes.
function clean<T extends { bytes: Uint8Array }>(out: T): T {
  return { ...out, bytes: stripPngMetadata(out.bytes) };
}

// Four transparent designs in one 2x2 grid, which convex/lib/gridCut.ts cuts apart. 1920x1920 is
// the largest square GPT Image 2.5 makes without experimental sizes. GRID_QUALITY defaults to high,
// which looks clearly better on illustrations (docs/image-generation/README.md).
async function gridImage(text: string, images: Array<Uint8Array>) {
  const model = images.length > 0 ? "openai/gpt-image-2.5-sunburst" : "openai/gpt-image-2.5-flare";
  const result = await generateImage({
    model: gateway.image(model),
    prompt: images.length > 0 ? { images, text } : text,
    size: "1920x1920",
    providerOptions: {
      openai: {
        background: "transparent",
        output_format: "png",
        quality: process.env.GRID_QUALITY ?? "high",
      },
    },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(DESIGN_TIMEOUT_MS),
  });
  return clean({ bytes: result.image.uint8Array });
}

// The model photo: one opaque 1024x1024 edit with the design as input.
async function photoImage(
  art: Uint8Array,
  backgroundColor: string,
  look: ShootLook,
  provider: Provider | null = imageProvider(),
) {
  if (provider === "chatgpt") {
    return clean(await chatgptImage({
      text: photoPrompt(backgroundColor, look),
      images: [art],
      background: "opaque",
      size: "1024x1024",
    }));
  }
  const result = await generateImage({
    model: gateway.image("openai/gpt-image-2.5-sunburst"),
    prompt: { images: [art], text: photoPrompt(backgroundColor, look) },
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
  return clean({ bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata });
}

export const runTile = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, { generationId }): Promise<null> => {
    let job = await ctx.runQuery(internal.studio.tileJob, { generationId });
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

      // Notes still being written: wait a little, then go without them.
      for (let waited = 0; job && job.attachments.some((a) => a.analysis === "pending") && waited < NOTES_WAIT_MS; waited += 2500) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        job = await ctx.runQuery(internal.studio.tileJob, { generationId });
      }
      if (!job) throw new Error("The design was removed.");
      const text = studioPrompt({
        layout: "single",
        // Style words from the previous studio's buttons, on batches it started.
        instruction: job.presets.length > 0 ? `${job.instruction} Style: ${job.presets.join(", ")}.` : job.instruction,
        attachments: job.attachments.map((a) => ({
          summary: a.analysis === "ready" ? a.summary : undefined,
          kind: a.kind,
          notes: a.analysis === "ready" ? a.notes : undefined,
          styleOnly: a.styleOnly,
        })),
        styles: job.styles,
        remix: job.remixOfParent,
      });
      const images = await Promise.all(job.attachments.map((a) => fetchPublicImage(a.key, ctx)));
      const provider = job.provider === "gateway" || job.provider === "chatgpt" ? job.provider : imageProvider();
      const started = Date.now();
      const { bytes } = await designImage(text, images, provider);
      const made = Date.now();
      const info = pngInfo(bytes);
      // Stores the design with its thumbnail and medium, so pages never load the PNG first.
      const place = job.place;
      const designNumber = job.index + 1;
      const { key, sha256 } = await storeNew(ctx, bytes, "image/png", () => designKey(place, designNumber, randomCode()));
      console.log("runTile ok", provider, images.length, "images", text.length, "chars", made - started, "ms, stored and sized in", Date.now() - made, "ms", info);
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

type DesignResult = {
  index: number;
  design?: { fullKey: string; sha256?: string; width: number; height: number; hasAlpha: boolean };
  error?: string;
};

// One batch: four designs from one 2x2 grid call, cut apart and each stored in its own folder with
// its copies. Charged and refunded as a whole (convex/lib/studioRules.ts).
export const runBatch = internalAction({
  args: { batchId: v.id("batches") },
  returns: v.null(),
  handler: async (ctx, { batchId }): Promise<null> => {
    let job = await ctx.runQuery(internal.studio.batchJob, { batchId });
    if (!job || job.tiles.some((tile) => tile.status !== "queued")) return null;
    const claimed = await ctx.runMutation(internal.studio.markBatchDispatched, { batchId });
    if (!claimed) return null;
    const indexes = job.tiles.map((tile) => tile.index);
    try {
      if (!liveGeneration()) {
        if (!isDevDeployment()) throw new Error("Image generation is not configured.");
        // Dev stand-in until the gateway and R2 keys exist.
        await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 3500));
        await ctx.runMutation(internal.studio.finishBatch, {
          batchId,
          results: job.tiles.map((tile) => ({
            index: tile.index,
            design: { fullKey: `fake:${tile.generationId}`, width: 1024, height: 1536, hasAlpha: true },
          })),
        });
        return null;
      }

      // Notes still being written: wait a little, then go without them.
      for (let waited = 0; job && job.attachments.some((a) => a.analysis === "pending") && waited < NOTES_WAIT_MS; waited += 2500) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        job = await ctx.runQuery(internal.studio.batchJob, { batchId });
      }
      if (!job) throw new Error("The batch was removed.");
      const instruction = job.presets.length > 0 ? `${job.instruction} Style: ${job.presets.join(", ")}.` : job.instruction;
      // What the request wants from each numbered image, read by GPT-6 Luna (about 1 s); its
      // phrases decide when the reader can't.
      const numbered = job.attachments.filter((a) => !a.styleOnly);
      const read = await readRoles({
        instruction: job.instruction,
        images: numbered.map((a) => ({ summary: a.analysis === "ready" ? a.summary : undefined, kind: a.kind })),
        remix: job.remixOfParent,
      });
      const roles = read ?? rolesFromWords(job.instruction, numbered.length, job.remixOfParent);
      const text = studioPrompt({
        layout: "grid",
        instruction,
        attachments: job.attachments.map((a) => ({
          summary: a.analysis === "ready" ? a.summary : undefined,
          kind: a.kind,
          notes: a.analysis === "ready" ? a.notes : undefined,
          styleOnly: a.styleOnly,
        })),
        styles: job.styles,
        remix: job.remixOfParent,
        roles,
      });
      const keys = job.attachments.map((a) => a.key);
      const started = Date.now();
      // The inputs are only needed for the call; letting them go keeps memory for the cut.
      const { bytes } = await gridImage(text, await Promise.all(keys.map((key) => fetchPublicImage(key, ctx))));
      const made = Date.now();
      const cpu0 = process.cpuUsage();
      const place = job.place;
      const gridStored = storeObject(ctx, gridFileKey(place, randomCode()), bytes, "image/png");
      const cells = cutGrid(await decodeToRgba(bytes));
      const cut = Date.now();
      const cpu1 = process.cpuUsage(cpu0);
      // Two designs at a time: four at once ran Convex's 512 MB Node runtime short of memory.
      const results: Array<DesignResult> = [];
      for (let i = 0; i < cells.length; i += 2) {
        results.push(
          ...(await Promise.all(
            cells.slice(i, i + 2).map(async (cell): Promise<DesignResult> => {
              if (!cell.tile) return { index: cell.index, error: cell.reason === "merged" ? GRID_MERGED : GRID_EMPTY };
              const { key, sha256 } = await storeNew(
                ctx,
                await encodePng(cell.tile),
                "image/png",
                () => designKey(place, cell.index + 1, randomCode()),
                cell.tile,
              );
              return { index: cell.index, design: { fullKey: key, sha256, width: cell.tile.width, height: cell.tile.height, hasAlpha: true } };
            }),
          )),
        );
      }
      const gridKey = await gridStored;
      const cpu2 = process.cpuUsage(cpu0);
      console.log(
        "runBatch ok", keys.length, "images", text.length, "chars", made - started, "ms; cut in", cut - made, "ms; stored in", Date.now() - cut, "ms;",
        read ? "roles read" : "roles from words", roles.join("/"),
        cells.map((cell) => (cell.tile ? `${cell.tile.width}x${cell.tile.height}` : cell.reason)).join(" "),
        "rss", Math.round(process.memoryUsage().rss / 1048576), "MB",
        "cpu cut", Math.round((cpu1.user + cpu1.system) / 1000), "ms, cpu total", Math.round((cpu2.user + cpu2.system) / 1000), "ms",
      );
      await ctx.runMutation(internal.studio.finishBatch, {
        batchId,
        results,
        gridKey,
        roles: roles.length > 0 ? roles : undefined,
      });
    } catch (error) {
      console.error("runBatch failed", batchId, error);
      const message = readableError(error);
      await ctx.runMutation(internal.studio.finishBatch, { batchId, results: indexes.map((index) => ({ index, error: message })) });
    }
    return null;
  },
});

// The browser downsizes an image (long side <= 1024 px) and sends the bytes here. They're stored
// once per member (content-addressed in R2), and the image joins the member's images, which
// starts its notes. asStyle: added in the style mixer, so the style picker lists it first.
export const uploadInspiration = action({
  args: { bytes: v.bytes(), contentType: v.string(), asStyle: v.optional(v.boolean()) },
  returns: v.object({ key: v.string(), url: v.optional(v.string()), imageId: v.id("userImages") }),
  // Explicit types: recording the upload goes through the generated API, which includes this action.
  handler: async (ctx, args): Promise<{ key: string; url?: string; imageId: Id<"userImages"> }> => {
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
    const sha256 = sha256Hex(bytes);
    const info = pngInfo(bytes);
    const mode = storageMode();
    let key: string;
    if (!mode) {
      if (!isDevDeployment()) {
        throw new ConvexError({ code: "NOT_CONFIGURED", message: "Uploads are not configured." });
      }
      key = `fake:inspo-${sha256.slice(0, 12)}`;
    } else {
      const existing = await ctx.runQuery(internal.images.findUpload, { authId: identity.subject, sha256 });
      if (!existing) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
      if (existing.key) {
        key = existing.key;
      } else {
        // The member's own uploads folder, under a code nobody can guess (convex/lib/sizes.ts).
        key = await storeObject(ctx, uploadKey(existing.userId, Date.now(), randomCode(), ext), bytes, args.contentType);
        // The studio shows its own preview meanwhile; pickers and chips use the thumbnail later.
        await ctx.scheduler.runAfter(0, internal.sizing.ensure, { key });
      }
    }
    const imageId: Id<"userImages"> = await ctx.runMutation(internal.images.recordUpload, {
      authId: identity.subject,
      key,
      sha256,
      width: info.width || undefined,
      height: info.height || undefined,
      asStyle: Boolean(args.asStyle),
    });
    return { key, url: publicUrl(key), imageId };
  },
});

// Publish step: the picked design's file becomes the work's art (same key, same folder), then
// the model photo is shot (one Sunburst edit, opaque 1024x1024) and stored in the design's folder.
export const publishAssets = internalAction({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, { workId }) => {
    const job = await ctx.runQuery(internal.publish.assetJob, { workId });
    if (!job) return null;
    let artKey: string;
    let contentHash: string;
    let art: Uint8Array | null = null;
    try {
      if (job.fullKey.startsWith("fake:")) {
        artKey = job.fullKey;
        contentHash = sha256Hex(new TextEncoder().encode(job.fullKey));
      } else {
        art = await fetchPublicImage(job.fullKey, ctx);
        contentHash = sha256Hex(art);
        // Designs get their copies when they're made; this covers older ones.
        await makeSizes(ctx, job.fullKey, art);
        // The work's own public folder, works/<family>/<expression>/, with the design's copies.
        artKey = await copyImage(ctx, job.fullKey, workArtKey(job.crFamily, job.crExpression), art);
      }
    } catch (error) {
      console.error("publishAssets failed", workId, error);
      await ctx.runMutation(internal.publish.markAssetFailed, {
        workId,
        error: readableError(error),
      });
      return null;
    }
    const shoot = await ctx.runMutation(internal.publish.markPublished, {
      workId,
      artKey,
      contentHash,
    });
    if (!shoot) return null;
    const { shootId, look } = shoot;

    try {
      let publicKey: string;
      if (!liveGeneration() || artKey.startsWith("fake:")) {
        if (!isDevDeployment()) throw new Error("Image generation is not configured.");
        await new Promise((resolve) => setTimeout(resolve, 4000));
        publicKey = `fake:photo-${workId}`;
      } else {
        const source = art ?? (await fetchPublicImage(artKey, ctx));
        const { bytes } = await photoImage(source, job.backgroundColor, look);
        // The work's first model photo: works/<family>/<expression>/photos/1/.
        publicKey = (await storeNew(ctx, bytes, "image/png", () => workPhotoKey(job.crFamily, job.crExpression, 1))).key;
      }
      await ctx.runMutation(internal.publish.recordPhoto, { shootId, publicKey });
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
    // edit only: use the remix prompt (the image is the design being remixed).
    remix: v.optional(v.boolean()),
    // false: call the provider only (no R2), to check the provider from Convex.
    store: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!imageProvider()) return { error: "No image provider: set CHATGPT_ACCESS_TOKEN or AI_GATEWAY_API_KEY." };
    if (args.store !== false && !storageMode()) return { error: "No image storage: R2 keys are missing and IMAGE_STORE is not convex." };
    const started = Date.now();
    const instruction = args.instruction ?? "A psychedelic 70s mushroom graphic that says GROW SLOW";
    try {
      let out;
      if (args.mode === "photo") {
        if (!args.imageKey) return { error: "photo needs imageKey" };
        out = await photoImage(
          await fetchPublicImage(args.imageKey, ctx),
          "#143cc8",
          pickLook(String(Date.now()), []),
          args.provider ?? imageProvider(),
        );
      } else if (args.mode === "edit") {
        if (!args.imageKey) return { error: "edit needs imageKey" };
        out = await designImage(
          studioPrompt({
            layout: "single",
            instruction,
            attachments: [{ styleOnly: false }],
            styles: [],
            remix: args.remix,
          }),
          [await fetchPublicImage(args.imageKey, ctx)],
          args.provider ?? imageProvider(),
        );
      } else {
        out = await designImage(
          studioPrompt({ layout: "single", instruction, attachments: [], styles: [] }),
          [],
          args.provider ?? imageProvider(),
        );
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
      const { key } = await storeNew(ctx, out.bytes, "image/png", () => testImageKey(Date.now(), randomCode()));
      return {
        provider: args.provider ?? imageProvider(),
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

// Gives a published work a new model photo with a different model, pose, and
// setting; the current photo stays up until the new one is recorded.
// It counts against the creator's photo shoots for today unless skipLimit is set.
// bunx convex run imageGen:reshoot '{"cr":"101-001"}'
export const reshoot = internalAction({
  args: { cr: v.string(), skipLimit: v.optional(v.boolean()) },
  returns: v.union(
    v.null(),
    v.object({ cr: v.string(), look: v.object({ casting: v.string(), pose: v.string(), world: v.string() }) }),
  ),
  // Explicit types: publish.reshootAll schedules this action, so inference would be circular.
  handler: async (ctx, args): Promise<{ cr: string; look: ShootLook } | null> => {
    const job: {
      shootId: Id<"shoots">;
      artKey: string;
      backgroundColor: string;
      look: ShootLook;
      crFamily: number;
      crExpression: number;
      photoKey?: string;
    } | null = await ctx.runMutation(internal.publish.beginReshoot, { cr: args.cr, skipLimit: args.skipLimit });
    if (!job) return null;
    try {
      let key: string;
      if (!liveGeneration() || job.artKey.startsWith("fake:")) {
        if (!isDevDeployment()) throw new Error("Image generation is not configured.");
        key = `fake:photo-${job.shootId}-${Date.now()}`;
      } else {
        const art = await fetchPublicImage(job.artKey, ctx);
        const { bytes } = await photoImage(art, job.backgroundColor, job.look);
        // The next photo number, so the photo a page has cached never changes under its link.
        const n = (photoNumberOf(job.photoKey) ?? 0) + 1;
        key = (await storeNew(ctx, bytes, "image/png", () => workPhotoKey(job.crFamily, job.crExpression, n))).key;
      }
      await ctx.runMutation(internal.publish.recordPhoto, { shootId: job.shootId, publicKey: key });
    } catch (error) {
      // A photo that's up stays up (publish.recordPhotoFailed); a retry that fails says so.
      await ctx.runMutation(internal.publish.recordPhotoFailed, { shootId: job.shootId, reason: readableError(error) });
      throw error;
    }
    return { cr: args.cr, look: job.look };
  },
});
