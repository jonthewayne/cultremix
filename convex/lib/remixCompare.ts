"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import sharp from "sharp";
import { VISION_MODEL } from "./models";
import { gatewayCostCents } from "./pricing";
import { REMIX_JUDGE_SYSTEM, parseRemixVerdict } from "./remixJudge";

// Compares a remix with its original (convex/lib/remixJudge.ts). Both images go to the model at
// most 768 px on a side, on flat gray, since vision models read clear pixels as black. Throws when
// the model doesn't answer usefully; callers retry or fall back.
const TIMEOUT_MS = 45_000;

async function forVision(bytes: Uint8Array) {
  const png = await sharp(bytes, { failOn: "none" })
    .flatten({ background: "#808080" })
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(png.buffer, png.byteOffset, png.length);
}

// allowed: the parts the original's creator lets remixes change (convex/lib/remixParts.ts
// allowedChangesNote), so a remix that used them isn't read as a new design for that.
export async function compareRemix(original: Uint8Array, remix: Uint8Array, model: string = VISION_MODEL, allowed?: string) {
  const [first, second] = await Promise.all([forVision(original), forVision(remix)]);
  const result = await generateText({
    model: gateway(model),
    system: REMIX_JUDGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1, the original:" },
          { type: "file", data: first, mediaType: "image/png" },
          { type: "text", text: "Image 2, the remix:" },
          { type: "file", data: second, mediaType: "image/png" },
          ...(allowed ? [{ type: "text" as const, text: allowed }] : []),
        ],
      },
    ],
    providerOptions: { openai: { reasoningEffort: "low" } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const verdict = parseRemixVerdict(result.text);
  if (!verdict) throw new Error(`The comparison gave no verdict: ${result.text.slice(0, 120)}`);
  return { ...verdict, model, costCents: gatewayCostCents(result.providerMetadata) };
}
