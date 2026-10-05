"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";
import { imageModelFor } from "./models";

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
  const result = await generateImage({
    model: gateway.image(model),
    prompt: args.images.length > 0 ? { images: args.images, text: args.text } : args.text,
    size: args.size,
    providerOptions: {
      openai: { background: args.background, output_format: "png", quality: args.quality },
    },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  return { bytes: result.image.uint8Array, warnings: result.warnings, providerMetadata: result.providerMetadata, model };
}
