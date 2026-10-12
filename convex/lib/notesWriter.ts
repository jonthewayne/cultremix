"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { decodeRgba, encodeRgba } from "./gridCut";
import { mimeOf } from "./mime";
import { VISION_MODEL } from "./models";
import { STYLE_NOTES_PROMPT, parseStyleNotes } from "./prompts";

// An image's notes from the vision model (STYLE_NOTES_PROMPT): what it shows and how it looks.
// convex/imageNotes.ts writes them once per image; the image test suite writes them the same way.
const TIMEOUT_MS = 90_000;

// Vision models see clear pixels as black, so a transparent PNG goes on flat gray first.
export function onGray(bytes: Uint8Array) {
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

// What a design's maker asked for, when it's known (a published design's request), as a reading
// aid. Heavy script lettering gets misread without it: production's "Sugar Baby Boo" came back
// "Sweet Baby Boo", and "Can you Handle the Randall?" came back "Enjoy Handle the Panda!".
export function requestHint(request: string | undefined) {
  const text = request?.replace(/\s+/gu, " ").trim().slice(0, 600);
  if (!text) return "";
  return (
    "\n\nThe person who made this design asked for: «" +
    text +
    "». Lettering, especially heavy script, can be hard to read. Where the request names the words, use it to tell which words the lettering spells, and write them as the design shows them, with its own capitals, line breaks, and punctuation. Read each row in order and keep every word in it, short ones squeezed between bigger letters too. List only words the design shows; leave out any the request asks for that it doesn't."
  );
}

// One image's notes, tried twice. request: what the design was made from (see requestHint).
export async function writeNotes(original: Uint8Array, model: string = VISION_MODEL, request?: string) {
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
              { type: "text", text: ask + requestHint(request) },
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
