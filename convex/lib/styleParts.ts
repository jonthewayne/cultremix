"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { VISION_MODEL } from "./models";
import { noteSections } from "./prompts";
import type { MixStyle, StylePart } from "./prompts";

// Places each smaller style of a mix in the part of the design where its signature traits show
// best (convex/lib/prompts.ts styleMixSection): a style known for its lettering on the lettering, one
// known for its color and shading on the subject, one known for scenery or texture around it.
// GPT-6 Luna, low reasoning, text only, about 2 s. Without an answer, smaller styles take parts in
// size order.
//
// Tested 2026-10-06 (.tmp/blend, medium quality, three grids each, the raccoon TRASH ROYALTY request):
// with the pop-art portrait leading and the psychedelic GROW SLOW lettering second, size order put
// the lettering style on the raccoon and its letters showed in 4 of 12 designs; Luna put it on the
// lettering and they showed in 12 of 12. With GROW SLOW leading, Luna chose the same parts as size
// order. A single blended description of all three styles lost the pop-art coloring entirely (0 of
// 12), and four designs that each lean on one style blended in only the fourth.
const TIMEOUT_MS = 10_000;
const PARTS = new Set<StylePart>(["subject", "around", "lettering", "accents"]);

const SYSTEM = [
  "You place each smaller style of a t-shirt design's style mix in the part of the design where its signature traits show best.",
  "Parts: subject (the main subject's coloring, shading, and face), around (a backdrop, frame, or ornaments, and the print texture), " +
    "lettering (the words' letterforms, outlines, colors, and effects), accents (small accents).",
  "The leading style sets the overall technique. Give each smaller style a different part when you can, choosing by what the style is " +
    "known for: a style known for its lettering goes on the lettering, one known for its color and shading on the subject, one known " +
    "for its scenery or texture around it. With no words in the request, don't use lettering.",
  'Answer with JSON only: {"parts": {"<image number>": "subject" | "around" | "lettering" | "accents", ...}}, one entry per smaller style.',
].join("\n");

function styleNotes(notes: string | undefined) {
  if (!notes) return "(no notes)";
  const keep = ["Technique", "Color", "Line and shading", "Lettering", "Signature traits"];
  const sections = noteSections(notes).filter((s) => keep.includes(s.name) && s.text);
  return sections.length > 0 ? sections.map((s) => `${s.name}:\n${s.text}`).join("\n\n") : notes;
}

// Each smaller style's part by image number, or null when the reader can't answer for all of them.
export async function chooseStyleParts(args: {
  request: string;
  lead: MixStyle;
  smaller: ReadonlyArray<MixStyle>;
}): Promise<Record<number, StylePart> | null> {
  if (args.smaller.length === 0 || !process.env.AI_GATEWAY_API_KEY) return null;
  const prompt =
    `Request: ${args.request.trim() || "(none)"}\n\nLeading style, image ${args.lead.n} (${args.lead.share}%):\n${styleNotes(args.lead.notes)}\n\n` +
    args.smaller.map((style) => `Smaller style, image ${style.n} (${style.share}%):\n${styleNotes(style.notes)}`).join("\n\n");
  try {
    const started = Date.now();
    const result = await generateText({
      model: gateway(VISION_MODEL),
      system: SYSTEM,
      prompt,
      providerOptions: { openai: { reasoningEffort: "low" } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = result.text;
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { parts?: Record<string, unknown> };
    const out: Record<number, StylePart> = {};
    for (const style of args.smaller) {
      const part = parsed.parts?.[String(style.n)];
      if (typeof part !== "string" || !PARTS.has(part as StylePart)) {
        console.error("chooseStyleParts: no part for image", style.n, text.slice(0, 160));
        return null;
      }
      out[style.n] = part as StylePart;
    }
    console.log("chooseStyleParts ok", Date.now() - started, "ms", JSON.stringify(out));
    return out;
  } catch (error) {
    console.error("chooseStyleParts failed", error instanceof Error ? error.message : error);
    return null;
  }
}

