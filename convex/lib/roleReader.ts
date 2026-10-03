"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import type { ImageRole } from "./prompts";

// Reads what a request wants from each numbered image: what's in it, only its look, or both.
// Tested 2026-10-02 on 16 tricky requests ("make her look like she belongs in the second
// picture", "a dragon in this style", "swap the lion for my cat"): GPT-6 Luna with reasoning off
// read 14 as expected, and the other two defensibly; namedStyles' phrases read 8. About 1 s.
const MODEL = "openai/gpt-6-luna";
const TIMEOUT_MS = 8_000;

const SYSTEM = [
  "You read a member's request to a t-shirt design studio. The member attached numbered images. Decide what the request wants from each image:",
  "- content: work on what's in it. Its people, characters, objects, words, or layout carry into the design, possibly changed or restyled.",
  "- style: use only its look (technique, colors, line, texture, lettering style, the way it draws people) for other content. Leave out its subjects and words.",
  "- both: keep what's in it and also use its look.",
  "An image the request doesn't mention is content. An image is style only when the request uses it for how it looks, in any wording, such as " +
    '"in the style of image 2", "make it look like the second one", "the poster\'s vibe", "drawn like the lion design", or "a dragon in this style". ' +
    'Asking to keep an image\'s own look makes it both. A negated style ("not the style of image 2") is not a style.',
  'Answer with JSON only: {"roles": [one of "content", "style", "both" for each image, in order]}.',
].join("\n");

const ROLES = new Set<string>(["content", "style", "both"]);

// Null when there's nothing to read or the reader can't answer; callers fall back to namedStyles.
export async function readRoles(args: {
  instruction: string;
  images: Array<{ summary?: string; kind?: "photo" | "art" }>;
  remix: boolean;
}): Promise<Array<ImageRole> | null> {
  if (!args.instruction.trim() || args.images.length === 0 || !process.env.AI_GATEWAY_API_KEY) return null;
  const list = args.images
    .map((image, i) => {
      const kind = image.kind === "photo" ? "a photo" : image.kind === "art" ? "art" : "an image";
      return `${i + 1}. ${kind}${image.summary ? `: ${image.summary}` : ""}`;
    })
    .join("\n");
  const remix = args.remix ? "\nImage 1 is the published design being remixed; it stays content." : "";
  try {
    const started = Date.now();
    const result = await generateText({
      model: gateway(MODEL),
      system: SYSTEM,
      prompt: `Images:\n${list}${remix}\n\nRequest: ${args.instruction}`,
      providerOptions: { openai: { reasoningEffort: "none" } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = result.text;
    const parsed: { roles?: unknown } = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const roles = parsed.roles;
    if (!Array.isArray(roles) || roles.length !== args.images.length || !roles.every((role) => ROLES.has(String(role)))) {
      console.error("readRoles: unexpected answer", text.slice(0, 200));
      return null;
    }
    console.log("readRoles ok", Date.now() - started, "ms", roles.join("/"));
    return roles as Array<ImageRole>;
  } catch (error) {
    console.error("readRoles failed", error instanceof Error ? error.message : error);
    return null;
  }
}
