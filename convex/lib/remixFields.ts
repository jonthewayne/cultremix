// Remixable words (plan R11, R16): the words of a published design that a remix offers as boxes to
// edit. The image reader's notes list every piece of text (the "Words" section, STYLE_NOTES_PROMPT);
// each piece becomes a proposed field that the creator switches on or off and labels. The boxes are
// shortcuts, not limits: a remixer can ask for anything else in words. A remix that changed only
// switched-on words stays a variation (convex/lib/lineage.ts remixChangedOnlyWords).
// Server only, like convex/lib/prompts.ts: the notes and the prompt never reach the browser.

import { noteSections, sectionHeading, spellOut } from "./prompts";
import { MAX_FIELD_LENGTH, changeSummary, cleanFieldText, length } from "./remixWords";

export { MAX_FIELD_LENGTH, changeSummary, cleanFieldText, length };

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
// An empty `to` removes the piece.
export type WordChange = { fieldId: string; label: string; from: string; to: string };

// Pieces past this many start switched off; the creator can turn them on.
export const FIELDS_ON_AT_FIRST = 8;
// Fields kept per design, so a page of body copy can't bloat the record.
export const MAX_FIELDS = 24;
export const MAX_LABEL_LENGTH = 40;

// A box takes up to MAX_FIELD_LENGTH characters, or the piece's own length if that's longer.
export function maxLengthFor(text: string) {
  return Math.max(MAX_FIELD_LENGTH, length(text));
}

// The limit for a stored field. Fields saved before the looser limit kept a tighter maxLength.
export function fieldLimit(field: Pick<RemixField, "text" | "maxLength">) {
  return Math.max(field.maxLength, maxLengthFor(field.text));
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

// ---- Readings checked against the words the design was asked to say ----

// Letters and digits only, in capitals: how two readings of the same words compare.
function letterKey(text: string) {
  return text.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// How many letters a reading may be off and still be the asked words: none under four letters (ART
// and ARM are different words), one up to eight letters, two beyond.
function allowedSlip(letters: number) {
  return letters < 4 ? 0 : letters <= 8 ? 1 : 2;
}

// Levenshtein distance, giving up once it's past `limit`.
function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

// A design made to say FAR OUT whose reader saw "TAROUT": quoted text in the notes' Words section
// that's a letter or two off words the creator asked for (in capitals or quotes in the request, or a
// remix's new words) takes the asked spelling, in the reading's capitals. Stylized lettering is where
// readers slip, and the asked words are what the design was drawn to say. A reading that matches
// letter for letter keeps its own spacing and line breaks; text far from anything asked stays as read.
export function snapWordsToRequest(notes: string, asked: ReadonlyArray<string>): string {
  const targets = asked
    .map((text) => ({ text: text.trim(), key: letterKey(text) }))
    .filter((target) => target.key.length >= 2);
  if (!notes || targets.length === 0) return notes;
  const snap = (reading: string) => {
    const key = letterKey(reading);
    if (key.length < 2 || targets.some((target) => target.key === key)) return reading;
    let best: { distance: number; text: string } | null = null;
    for (const target of targets) {
      const limit = allowedSlip(Math.max(target.key.length, key.length));
      if (limit === 0) continue;
      const distance = editDistance(target.key, key, limit);
      if (distance <= limit && (!best || distance < best.distance)) best = { distance, text: target.text };
    }
    if (!best) return reading;
    const capitals = reading === reading.toUpperCase();
    return capitals ? best.text.toUpperCase() : best.text;
  };
  let inWords = false;
  return notes
    .split("\n")
    .map((line) => {
      const heading = sectionHeading(line);
      if (heading) inWords = heading === "Words";
      if (!inWords) return line;
      let out = "";
      let at = 0;
      for (let i = 0; i < line.length; i++) {
        if (!OPEN.has(line[i])) continue;
        const quote = readQuote(line, i);
        if (!quote) continue;
        out += line.slice(at, i + 1) + snap(quote.text);
        at = quote.end - 1;
        i = quote.end - 1;
      }
      return out + line.slice(at);
    })
    .join("\n");
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

// Whether a remix's inherited fields are still its words: at least half of the fields' words (by
// letters, in any spacing or line breaks) are among the words its notes found. Fields with no
// letters count as found when the notes found no words either.
export function fieldsFoundInNotes(
  fields: ReadonlyArray<Pick<RemixField, "text">>,
  found: ReadonlyArray<Pick<RemixField, "text">>,
) {
  const seen = found.map((field) => letterKey(field.text)).join("");
  const keys = fields.map((field) => letterKey(field.text)).filter((key) => key.length > 0);
  if (keys.length === 0) return seen.length === 0;
  return keys.filter((key) => seen.includes(key)).length * 2 >= keys.length;
}

// A remix's own fields: the parent's, same ids, labels, and switches, with the new text. A piece
// the remix removed isn't one of its fields.
export function inheritRemixFields(parent: Array<RemixField>, changes: Array<{ fieldId: string; to: string }>) {
  const changed = new Map(changes.map((c) => [c.fieldId, c.to]));
  return parent.flatMap((field) => {
    const text = changed.get(field.id) ?? field.text;
    return text ? [{ ...field, text, maxLength: Math.max(fieldLimit(field), length(text)) }] : [];
  });
}

export type WordChangeProblem = "UNKNOWN_FIELD" | "FIELD_LOCKED" | "TOO_LONG" | "REPEATED";

// What a remix asks to change, checked against the parent's fields as the server stored them:
// only the boxes the remix offers (switched-on fields), each within MAX_FIELD_LENGTH. An empty box
// removes its piece. Unchanged entries drop out.
export function checkWordChanges(
  fields: Array<RemixField>,
  asked: Array<{ fieldId: string; text: string }>,
): { ok: true; changes: Array<WordChange> } | { ok: false; problem: WordChangeProblem; label?: string; limit?: number } {
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
    if (length(to) > fieldLimit(field)) return { ok: false, problem: "TOO_LONG", label: field.label, limit: fieldLimit(field) };
    changes.push({ fieldId: field.id, label: field.label, from: field.text, to });
  }
  return { ok: true, changes };
}

// A piece's text as the prompt quotes it; a slash marks each line break.
function quoted(text: string) {
  return `"${text.split("\n").join(" / ")}"`;
}

// New words that fit where the old ones were (the limit before boxes took up to 80 characters).
function fitsSpace(from: string, to: string) {
  return length(to) <= Math.max(12, Math.ceil(length(from) * 1.5));
}

// The remix prompt's word changes (convex/lib/prompts.ts studioPrompt): each changed piece
// replaced letter for letter in its own place (and size, when it fits), each emptied piece
// removed, and every other piece kept exactly. How the new words look (image 1's own lettering,
// or a style from the mixer) is said by studioPrompt, the only place that knows whether a style is
// in play.
export function wordChangeInstruction(fields: Array<RemixField>, changes: Array<WordChange>) {
  if (changes.length === 0) return "";
  const changed = new Set(changes.map((c) => c.fieldId));
  const lines = changes.map((c) => {
    if (!c.to) return `- ${c.label}: remove ${quoted(c.from)} completely, and let the rest of the design fill its place so nothing looks missing.`;
    const fit = fitsSpace(c.from, c.to)
      ? "Keep this piece's size and placement."
      : "Put it where this piece is, in the same lettering; it's longer, so fit it by setting it smaller or over more lines.";
    return `- ${c.label}: replace ${quoted(c.from)} with ${quoted(c.to)}, spelled letter for letter: ${spellOut(c.to)}. ${fit}`;
  });
  const kept = fields.filter((field) => !changed.has(field.id)).map((field) => `- ${field.label}: ${quoted(field.text)}`);
  const breaks = [...changes.map((c) => c.from + c.to), ...fields.map((f) => f.text)].some((t) => t.includes("\n"));
  const parts = [`Word changes in image 1:\n${lines.join("\n")}`];
  if (kept.length > 0) parts.push(`Keep every other piece of text exactly as it is, letter for letter:\n${kept.join("\n")}`);
  if (breaks) parts.push("A slash in quoted text marks a line break.");
  return parts.join("\n");
}
