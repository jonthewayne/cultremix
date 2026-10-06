"use node";

import { readRoles } from "./roleReader";
import { rolesFromWords, studioPrompt } from "./prompts";
import type { ImageRole } from "./prompts";

// The prompt for a grid batch, exactly as convex/imageGen.ts runBatch sends it: GPT-6 Luna reads
// what the request wants from each numbered image (convex/lib/roleReader.ts, about 2.5 s; told what
// the style mixer holds, so "in the style" means the mixer's style), and studioPrompt assembles the
// parts. tests/image-e2e builds its prompts with this same function.

export type BatchAttachment = {
  analysis?: "pending" | "ready" | "failed";
  summary?: string;
  kind?: "photo" | "art";
  notes?: string;
  styleOnly: boolean;
};

export async function batchPrompt(job: {
  instruction: string;
  presets: Array<string>;
  // Every image sent with the call, in order: the numbered images, then mixer-only styles.
  attachments: Array<BatchAttachment>;
  // position: the style's row in the mixer ("Style 1", "Style 2", …), when known.
  styles: Array<{ attachment: number; weight: number; position?: number }>;
  // Image 1 is the published design being remixed.
  remixOfParent: boolean;
  wordChanges?: string;
}): Promise<{ text: string; roles: Array<ImageRole>; read: boolean; styleHair: boolean }> {
  // Style words from the previous studio's buttons, on batches it started.
  const instruction = job.presets.length > 0 ? `${job.instruction} Style: ${job.presets.join(", ")}.` : job.instruction;
  const attachments = job.attachments;
  const summaryOf = (a: BatchAttachment) => (a.analysis === "ready" ? a.summary : undefined);
  const numbered = attachments.filter((a) => !a.styleOnly);
  const mixerStyles = job.styles.filter((style) => style.weight > 0 && attachments[style.attachment - 1]);
  const read = await readRoles({
    instruction: job.instruction,
    images: numbered.map((a) => ({ summary: summaryOf(a), kind: a.kind })),
    mixer: mixerStyles.map((style): number | { summary?: string; kind?: "photo" | "art" } => {
      const a = attachments[style.attachment - 1];
      return a.styleOnly ? { summary: summaryOf(a), kind: a.kind } : style.attachment;
    }),
    mixerPositions: mixerStyles.map((style, i) => style.position ?? i + 1),
    remix: job.remixOfParent,
  });
  const roles = read?.roles ?? rolesFromWords(job.instruction, numbered.length, job.remixOfParent);
  const styleHair = read?.styleHair ?? false;
  const text = studioPrompt({
    layout: "grid",
    instruction,
    attachments: attachments.map((a) => ({
      summary: summaryOf(a),
      kind: a.kind,
      notes: a.analysis === "ready" ? a.notes : undefined,
      styleOnly: a.styleOnly,
    })),
    styles: job.styles,
    remix: job.remixOfParent,
    roles,
    styleHair,
    wordChanges: job.wordChanges,
  });
  return { text, roles, read: Boolean(read), styleHair };
}
