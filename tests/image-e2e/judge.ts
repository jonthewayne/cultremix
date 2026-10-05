import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import sharp from "sharp";
import { gatewayCostCents } from "../../convex/lib/pricing";
import type { Ask, WordsCheck } from "./cases";

// The suite's checker: a vision model answers a case's yes/no questions about one design and reads
// its words. Questions that name a reference image ("the original", "the style image") are asked
// with the references; everything else, words included, is asked about the design alone, because
// with a reference in view the model answered about the reference instead (2026-10-05 run 1: it
// read SLOW on designs that said LOUD, and saw a night sky on sunny beaches).

type Content = Array<{ type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string }>;

const ALONE = [
  "You check one t-shirt design for an automated test of an image generator. Gray around it is a transparent background, not part of it.",
  "Answer each question with true or false, judging only what you see; when it's unclear, answer false.",
  "When asked, list every separate piece of text in the design exactly as written, letter for letter, one entry per piece; an empty list if there's none.",
  'Answer with JSON only: {"answers": {"<question id>": true or false}, "words": ["..."]}',
].join("\n");

const COMPARED = [
  "You check a t-shirt design for an automated test of an image generator. The first image is the design to check. The images after it are named references, shown only for comparison.",
  "Every question is about the design, the first image; use the references only to compare. The design's words may differ from the references' words on purpose; judge only what each question asks.",
  "Gray around an image is a transparent background, not part of it. Answer each question with true or false; when it's unclear, answer false.",
  'Answer with JSON only: {"answers": {"<question id>": true or false}}',
].join("\n");

// An image as the vision model gets it: on flat gray, at most size px on a side.
export async function forVision(bytes: Uint8Array, size = 1024) {
  const png = await sharp(bytes, { failOn: "none" })
    .flatten({ background: "#808080" })
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return new Uint8Array(png.buffer, png.byteOffset, png.length);
}

export type Answers = { answers: Record<string, boolean | null>; words: Array<string>; costCents?: number };

async function ask(model: string, system: string, content: Content, asks: Array<Ask>) {
  let lastError = "no answer";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await generateText({
        model: gateway(model),
        system,
        messages: [{ role: "user", content }],
        providerOptions: { openai: { reasoningEffort: "low" } },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const text = result.text;
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answers?: Record<string, unknown>; words?: unknown };
      const answers: Record<string, boolean | null> = {};
      for (const a of asks) {
        const value = parsed.answers?.[a.id];
        answers[a.id] = typeof value === "boolean" ? value : null;
      }
      const words = Array.isArray(parsed.words) ? parsed.words.filter((w): w is string => typeof w === "string") : [];
      return { answers, words, costCents: gatewayCostCents(result.providerMetadata) ?? 0 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`The checker failed: ${lastError.slice(0, 160)}`);
}

const questions = (asks: Array<Ask>) => asks.map((a) => `${a.id}: ${a.ask}`).join("\n");

// A question compares when it names one of the references.
export function namesReference(question: string, refs: Array<{ as: string }>) {
  const lower = question.toLowerCase();
  return refs.some((ref) => lower.includes(ref.as.toLowerCase()));
}

export async function checkImage(args: {
  model: string;
  design: Uint8Array;
  refs: Array<{ as: string; bytes: Uint8Array }>;
  asks: Array<Ask>;
  readWords: boolean;
}): Promise<Answers> {
  const compared = args.asks.filter((a) => namesReference(a.ask, args.refs));
  const alone = args.asks.filter((a) => !compared.includes(a));
  const design = await forVision(args.design);
  const calls: Array<Promise<{ answers: Record<string, boolean | null>; words: Array<string>; costCents: number }>> = [];
  if (alone.length > 0 || args.readWords) {
    const text = (alone.length ? `Questions:\n${questions(alone)}` : "No questions; answer with an empty answers object.") + (args.readWords ? "\nAlso list the design's words." : "");
    calls.push(ask(args.model, ALONE, [{ type: "file", data: design, mediaType: "image/png" }, { type: "text", text }], alone));
  }
  if (compared.length > 0) {
    const refs = await Promise.all(args.refs.map((ref) => forVision(ref.bytes, 640)));
    const content: Content = [{ type: "text", text: "The design to check:" }, { type: "file", data: design, mediaType: "image/png" }];
    args.refs.forEach((ref, i) => {
      content.push({ type: "text", text: `Reference, "${ref.as}":` });
      content.push({ type: "file", data: refs[i], mediaType: "image/png" });
    });
    content.push({ type: "text", text: `Questions about the design:\n${questions(compared)}` });
    calls.push(ask(args.model, COMPARED, content, compared));
  }
  const parts = await Promise.all(calls);
  return {
    answers: Object.assign({}, ...parts.map((p) => p.answers)) as Record<string, boolean | null>,
    words: parts.flatMap((p) => p.words),
    costCents: parts.reduce((sum, p) => sum + p.costCents, 0),
  };
}

// Words as compared: capitals, letters and digits only, single spaces.
export function normalizeWords(text: string) {
  return text
    .toUpperCase()
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Whether a design's words have every word in has and none in not.
export function wordsMatch(read: Array<string>, check: WordsCheck) {
  const text = ` ${normalizeWords(read.join(" "))} `;
  // Lettering read in pieces ("NIGH T SHIFT") still counts: compare without spaces too.
  const joined = normalizeWords(read.join(" ")).replace(/ /gu, "");
  const tokens = (list: Array<string>) => list.flatMap((item) => normalizeWords(item).split(" ").filter(Boolean));
  const missing = tokens(check.has).filter((word) => !text.includes(` ${word} `) && !joined.includes(word));
  const unwanted = tokens(check.not ?? []).filter((word) => text.includes(` ${word} `));
  return { ok: missing.length === 0 && unwanted.length === 0, missing, unwanted };
}

// A second, closer read of a design's words, for when the first read missed some.
export async function rereadWords(model: string, design: Uint8Array) {
  const image = await forVision(design, 1536);
  const result = await ask(
    model,
    ALONE,
    [
      { type: "file", data: image, mediaType: "image/png" },
      { type: "text", text: "No questions; answer with an empty answers object. Read the design's lettering slowly, letter by letter, and list its words." },
    ],
    [],
  );
  return { words: result.words, costCents: result.costCents };
}
