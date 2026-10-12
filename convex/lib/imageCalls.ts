"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateImage, generateText } from "ai";
import { NO_IMAGE_REPLY } from "./imageErrors";
import { mimeOf } from "./mime";
import { NANO_BANANA_MODEL, RECRAFT_MODEL, imageModelFor } from "./models";
import { onceMoreIfRateLimited } from "./rateLimitRetry";

// One GPT Image call through the gateway, as production makes it (convex/imageGen.ts) and as the
// image test suite makes it (tests/image-e2e). model defaults to the pinned model for the number
// of images (convex/lib/models.ts).
export const IMAGE_TIMEOUT_MS = 170_000;

export async function gatewayImage(args: {
  text: string;
  images: Array<Uint8Array>;
  size: `${number}x${number}`;
  background: "transparent" | "opaque";
  quality: string;
  model?: string;
}) {
  const model = args.model ?? imageModelFor(args.images.length);
  const result = await onceMoreIfRateLimited(() =>
    generateImage({
      model: gateway.image(model),
      prompt: args.images.length > 0 ? { images: args.images, text: args.text } : args.text,
      size: args.size,
      providerOptions: {
        openai: { background: args.background, output_format: "png", quality: args.quality },
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    }),
  );
  return { bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata, model };
}

// One Nano Banana 2.1 call. It's a chat model that answers with an image (an opaque JPEG), so the
// prompt asks for a key-color background (prompts.ts keyedPrompt). A reply in words alone is
// almost always a refusal.
export async function nanoBananaImage(args: {
  text: string;
  images: Array<Uint8Array>;
  aspectRatio: "1:1" | "2:3";
  imageSize: "1K" | "2K";
}) {
  const result = await onceMoreIfRateLimited(() => generateText({
    model: gateway(NANO_BANANA_MODEL),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: args.text },
          ...args.images.map((bytes) => ({ type: "file" as const, mediaType: mimeOf(bytes), data: bytes })),
        ],
      },
    ],
    providerOptions: {
      google: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: args.aspectRatio, imageSize: args.imageSize } },
    },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  }));
  const file = result.files.find((f) => f.mediaType.startsWith("image/"));
  if (!file) throw new Error(`${NO_IMAGE_REPLY} ${result.text.slice(0, 160)}`.trim());
  return { bytes: file.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata, model: NANO_BANANA_MODEL };
}

// One Recraft V4.1 design from words alone (the gateway sends it no images).
export async function recraftImage(args: { text: string; size: `${number}x${number}` }) {
  const result = await onceMoreIfRateLimited(() =>
    generateImage({
      model: gateway.image(RECRAFT_MODEL),
      prompt: args.text,
      size: args.size,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    }),
  );
  return { bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata, model: RECRAFT_MODEL };
}
