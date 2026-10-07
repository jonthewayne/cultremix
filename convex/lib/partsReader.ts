"use node";

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { VISION_MODEL } from "./models";
import { noteSections } from "./prompts";
import { normalizeParts, parseProposedParts } from "./remixParts";
import type { RemixPart } from "./remixParts";

// Reads a design's notes and proposes its remixable parts (convex/lib/remixParts.ts), or turns a
// creator's description ("let people change the number of elves") into one. GPT-6 Luna with low
// reasoning, text only: the notes already describe the design in detail.
const TIMEOUT_MS = 30_000;

const KINDS = [
  "- character: a main subject a remix could swap for another: an animal, creature, mascot, or object that's the star of the design (\"The lion\").",
  "- person: one human character a remix could turn into someone from a photo (\"Santa\", \"The bride\").",
  "- group: several similar characters drawn as a set, whose number a remix could change (\"Elves\", \"The band\"); give how many the design shows.",
].join("\n");

const PROPOSE = [
  "You read notes about a t-shirt design and list the parts of it that someone remixing it might want to swap. Kinds:",
  KINDS,
  "Leave out words and lettering (handled separately), backgrounds, small props, and decoration. A design with nothing worth swapping has no parts; most have one to three. At most six.",
  'Label each in two or three plain words a remixer would understand ("The lion", "Santa", "Elves"), and describe what the design shows there in one short phrase ("a pencil-sketch lion\'s head", "elves in green pointed hats"). ' +
    "For a person or a group, describe only their role and outfit: never their face, hair, age, or body, since a remix gives them someone else's looks, and never how many there are.",
  'Answer with JSON only: {"parts": [{"kind": "character" | "person" | "group", "label": "...", "text": "...", "count": number (groups only)}]}',
].join("\n");

const DESCRIBE = [
  "A creator is choosing what people may change when they remix their t-shirt design. From the design's notes and the creator's words, write the one remixable part they mean. Kinds:",
  KINDS,
  'For a group, give how many the design shows as "count" and, if the creator says, the most a remix may have as "max".',
  "For a person or a group, describe only their role and outfit: never their face, hair, age, or body, and never how many there are.",
  'Answer with JSON only: {"parts": [{"kind": "character" | "person" | "group", "label": "...", "text": "...", "count": number, "max": number}]}',
].join("\n");

function designNotes(notes: string) {
  const sections = noteSections(notes).filter((s) => ["Subject and layout", "People and characters", "Figure drawing"].includes(s.name));
  return sections.length > 0 ? sections.map((s) => `${s.name}:\n${s.text}`).join("\n\n") : notes;
}

async function ask(system: string, prompt: string) {
  const result = await generateText({
    model: gateway(VISION_MODEL),
    system,
    prompt,
    providerOptions: { openai: { reasoningEffort: "low" } },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseProposedParts(result.text);
}

// The parts proposed for a design; an empty list when there's nothing to swap, null when the
// reader can't answer.
export async function proposeParts(notes: string): Promise<Array<RemixPart> | null> {
  if (!process.env.AI_GATEWAY_API_KEY || !notes.trim()) return null;
  try {
    return await ask(PROPOSE, `Design notes:\n${designNotes(notes)}`);
  } catch (error) {
    console.error("proposeParts failed", error instanceof Error ? error.message : error);
    return null;
  }
}

// One part from the creator's own words, numbered after the parts already there.
export async function describePart(notes: string, words: string, existing: Array<RemixPart>): Promise<RemixPart | null> {
  if (!process.env.AI_GATEWAY_API_KEY) return null;
  try {
    const parts = await ask(DESCRIBE, `Design notes:\n${designNotes(notes)}\n\nThe creator: ${words}`);
    const part = parts?.[0];
    if (!part) return null;
    const [placed] = normalizeParts([...existing, { ...part, id: undefined }]).slice(existing.length);
    return placed ?? null;
  } catch (error) {
    console.error("describePart failed", error instanceof Error ? error.message : error);
    return null;
  }
}
