// Remixable words (plan R11, R16): the parts of a published design a remixer may change. The image
// reader's notes list every piece of text (the "Words" section, STYLE_NOTES_PROMPT); each piece
// becomes a proposed field that the creator switches on or off and labels. A remix changes only
// switched-on fields and keeps everything else as the creator made it.
// Server only, like convex/lib/prompts.ts: the notes and the prompt never reach the browser.

import { noteSections, spellOut } from "./prompts";
import { changeSummary, cleanFieldText, length } from "./remixWords";

export { changeSummary, cleanFieldText, length };

// kind is "text" for now; people and counts ("how many elves") can join as other kinds later
// without changing the stored shape.
export type RemixField = {
  id: string;
  kind: "text";
  label: string;
  text: string;
  maxLength: number;
  on: boolean;
};

// Recorded on a batch: what a remix changed, as the server read it from the parent.
export type WordChange = { fieldId: string; label: string; from: string; to: string };

// Pieces past this many start switched off; the creator can turn them on.
export const FIELDS_ON_AT_FIRST = 8;
// Fields kept per design, so a page of body copy can't bloat the record.
export const MAX_FIELDS = 24;
export const MIN_MAX_LENGTH = 12;
export const MAX_LABEL_LENGTH = 40;

export function maxLengthFor(text: string) {
  return Math.max(MIN_MAX_LENGTH, Math.ceil(length(text) * 1.5));
}

// The role words the notes use, in the order they're checked, and the label each gives.
const ROLES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bbody(?:\s+copy|\s+text)?\b/iu, label: "Body" },
  { pattern: /\bsub-?head(?:line|ing)?\b|\bsubtitle\b/iu, label: "Subhead" },
  { pattern: /\bhead(?:line|ing)\b|\btitle\b/iu, label: "Headline" },
  { pattern: /\btag-?line\b|\bslogan\b/iu, label: "Tagline" },
  { pattern: /\bdates?\b|\byear\b/iu, label: "Date" },
  { pattern: /\bby-?line\b|\bsignature\b|\bname\b/iu, label: "Name" },
  { pattern: /\bcaption\b/iu, label: "Caption" },
  { pattern: /\blabel\b/iu, label: "Label" },
];

// The label for a piece: the role named closest to the start of its description.
function roleLabel(description: string) {
  let best: { at: number; label: string } | null = null;
  for (const role of ROLES) {
    const match = role.pattern.exec(description);
    if (match && (!best || match.index < best.at)) best = { at: match.index, label: role.label };
  }
  return best?.label ?? "Text";
}

const OPEN = new Set(['"', "“", "„", "«"]);
const CLOSE: Record<string, string> = { '"': '"', "“": "”", "„": "“", "«": "»" };
const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/u;

// The quoted text that starts at `start` (an opening quote) and where it ends. A straight quote
// closes at the next straight quote that isn't followed by a letter or digit, so "SAY "HI"" style
// nesting inside curly quotes and apostrophes ("DON'T") both survive.
function readQuote(source: string, start: number): { text: string; end: number } | null {
  const open = source[start];
  const close = CLOSE[open];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] !== close) continue;
    const next = source[i + 1] ?? "";
    if (close === '"' && /[\p{L}\p{N}]/u.test(next)) continue;
    return { text: source.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

// Line breaks as the notes write them: real ones, "\n", or " / " between lines.
function withLineBreaks(text: string) {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/\\n/gu, "\n")
    .replace(/\s+\/\s+/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, lines) => line || (i > 0 && i < lines.length - 1))
    .join("\n")
    .trim();
}

// Every quoted piece in the notes' "Words" section, in order, with the words describing it.
export function wordPieces(notes: string | undefined): Array<{ text: string; description: string }> {
  if (!notes?.trim()) return [];
  const section = noteSections(notes).find((s) => s.name === "Words")?.text ?? "";
  const pieces: Array<{ text: string; description: string }> = [];
  const lines = section.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\*\*/gu, "");
    const quoteAt = [...line].findIndex((ch) => OPEN.has(ch));
    if (quoteAt < 0) continue;
    // Position in UTF-16 units for slicing.
    const at = [...line].slice(0, quoteAt).join("").length;
    const prefix = line.slice(0, at).replace(BULLET, "");
    // A quote can run onto the next lines when the piece has line breaks.
    let joined = line;
    let quote = readQuote(joined, at);
    let extra = 0;
    while (!quote && i + extra + 1 < lines.length && extra < 6) {
      extra++;
      joined += `\n${lines[i + extra].replace(/\*\*/gu, "")}`;
      quote = readQuote(joined, at);
    }
    if (!quote) continue;
    i += extra;
    const text = withLineBreaks(quote.text);
    if (!text) continue;
    const rest = joined.slice(quote.end).split("\n")[0];
    pieces.push({ text, description: `${prefix} ${rest}`.trim() });
  }
  return pieces;
}

// The fields CultRemix proposes for a design from its notes: one per piece of text, in the notes'
// order. Body copy and anything past the first eight pieces start switched off. No words, no fields.
export function proposeRemixFields(notes: string | undefined): Array<RemixField> {
  const seen = new Map<string, number>();
  return wordPieces(notes)
    .slice(0, MAX_FIELDS)
    .map((piece, i) => {
      const role = roleLabel(piece.description);
      const count = (seen.get(role) ?? 0) + 1;
      seen.set(role, count);
      return {
        id: `t${i + 1}`,
        kind: "text" as const,
        label: count > 1 ? `${role} ${count}` : role,
        text: piece.text,
        maxLength: maxLengthFor(piece.text),
        on: i < FIELDS_ON_AT_FIRST && role !== "Body",
      };
    });
}

// A remix's own fields: the parent's, same ids, labels, and switches, with the new text.
export function inheritRemixFields(parent: Array<RemixField>, changes: Array<{ fieldId: string; to: string }>) {
  const changed = new Map(changes.map((c) => [c.fieldId, c.to]));
  return parent.map((field) => {
    const text = changed.get(field.id) ?? field.text;
    return { ...field, text, maxLength: Math.max(field.maxLength, length(text)) };
  });
}

export type WordChangeProblem = "UNKNOWN_FIELD" | "FIELD_LOCKED" | "TOO_LONG" | "EMPTY" | "REPEATED";

// What a remix asks to change, checked against the parent's fields as the server stored them:
// only switched-on fields, within their length, never empty. Unchanged entries drop out.
export function checkWordChanges(
  fields: Array<RemixField>,
  asked: Array<{ fieldId: string; text: string }>,
): { ok: true; changes: Array<WordChange> } | { ok: false; problem: WordChangeProblem; label?: string } {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const ids = new Set<string>();
  const changes: Array<WordChange> = [];
  for (const entry of asked) {
    if (ids.has(entry.fieldId)) return { ok: false, problem: "REPEATED" };
    ids.add(entry.fieldId);
    const field = byId.get(entry.fieldId);
    if (!field) return { ok: false, problem: "UNKNOWN_FIELD" };
    if (!field.on) return { ok: false, problem: "FIELD_LOCKED", label: field.label };
    const to = cleanFieldText(entry.text);
    if (to === field.text) continue;
    if (!to) return { ok: false, problem: "EMPTY", label: field.label };
    if (length(to) > field.maxLength) return { ok: false, problem: "TOO_LONG", label: field.label };
    changes.push({ fieldId: field.id, label: field.label, from: field.text, to });
  }
  return { ok: true, changes };
}

// A piece's text as the prompt quotes it; a slash marks each line break.
function quoted(text: string) {
  return `"${text.split("\n").join(" / ")}"`;
}

// The remix prompt's word changes (convex/lib/prompts.ts studioPrompt): each changed piece
// replaced letter for letter in its own size and place, and every other piece kept exactly. How
// the new words look (image 1's own lettering, or a style from the mixer) is said by studioPrompt,
// the only place that knows whether a style is in play.
export function wordChangeInstruction(fields: Array<RemixField>, changes: Array<WordChange>) {
  if (changes.length === 0) return "";
  const changed = new Set(changes.map((c) => c.fieldId));
  const lines = changes.map(
    (c) =>
      `- ${c.label}: replace ${quoted(c.from)} with ${quoted(c.to)}, spelled letter for letter: ${spellOut(c.to)}. ` +
      "Keep this piece's size and placement.",
  );
  const kept = fields.filter((field) => !changed.has(field.id)).map((field) => `- ${field.label}: ${quoted(field.text)}`);
  const breaks = [...changes.map((c) => c.from + c.to), ...fields.map((f) => f.text)].some((t) => t.includes("\n"));
  const parts = [`Word changes in image 1 (only these words change):\n${lines.join("\n")}`];
  if (kept.length > 0) parts.push(`Keep every other piece of text exactly as it is, letter for letter:\n${kept.join("\n")}`);
  if (breaks) parts.push("A slash in quoted text marks a line break.");
  return parts.join("\n");
}
