"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import sharp from "sharp";
import { WORD_READER_MODEL } from "./models";
import { gatewayCostCents } from "./pricing";

// Reads a design's lettering letter for letter, for the studio's spelling check
// (convex/spellingCheck.ts). The prompt is the image suite's word reader's (tests/image-e2e/judge.ts),
// calibrated on 2026-10-05: it asks for what is drawn, not what was probably meant.
const TIMEOUT_MS = 60_000;

export const WORDS_SYSTEM = [
  "You read the lettering on one t-shirt design made by an image generator. Gray around it is a transparent background, not part of it.",
  "List every separate piece of text in the design exactly as written, letter for letter, one entry per piece; an empty list if there is none. Misspellings matter: write what is drawn, not what was probably meant.",
  'Answer with JSON only: {"words": ["..."]}',
].join("\n");

// The design on flat gray, at most 1536 px on a side: vision models read clear pixels as black.
async function forReading(bytes: Uint8Array) {
  const png = await sharp(bytes, { failOn: "none" })
    .flatten({ background: "#808080" })
    .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(png.buffer, png.byteOffset, png.length);
}

// Throws when the model doesn't answer in JSON; callers retry or give up quietly.
export async function readDesignWords(design: Uint8Array, model: string = WORD_READER_MODEL) {
  const image = await forReading(design);
  const result = await generateText({
    model: gateway(model),
    system: WORDS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: image, mediaType: "image/png" },
          { type: "text", text: "Read the lettering slowly, letter by letter, and list its words." },
        ],
      },
    ],
    providerOptions: model.startsWith("google/")
      ? { google: { thinkingConfig: { thinkingLevel: "low" } } }
      : { openai: { reasoningEffort: "low" } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = result.text;
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { words?: unknown };
  const words = Array.isArray(parsed.words) ? parsed.words.filter((word): word is string => typeof word === "string") : [];
  return { words, model, costCents: gatewayCostCents(result.providerMetadata) };
}
