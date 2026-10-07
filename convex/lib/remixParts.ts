// Remixable parts: the characters, people, and groups of a design that a remix may swap, beside its
// remixable words (convex/lib/remixFields.ts). GPT-6 Luna proposes them from the design's notes
// (convex/remixParts.ts); the creator switches them on, names them, and sets their rules, in the
// studio before publishing ("Make it remixable") or on the work page after. A remix fills them in:
// a character takes new words ("a wolf") or a photo, a person takes a photo of someone to become
// that character, and a group takes a photo for each member, so a family of five can be five elves.
// Code turns what was filled in into prompt lines (partChangeInstruction); the browser never sees
// the notes or the prompt. Server only, like convex/lib/prompts.ts.

export type PartKind = "character" | "person" | "group";
// What a person part does when the remix gives it no photo.
export type EmptyRule = "keep" | "omit" | "require";

export type RemixPart = {
  id: string;
  kind: PartKind;
  // What a remixer sees: "The lion", "Santa", "Elves".
  label: string;
  // What the design shows there, from its notes: "a pencil-sketch lion's head". Server only.
  text: string;
  on: boolean;
  // person: what happens without a photo (default keep).
  empty?: EmptyRule;
  // group: how many the design shows, and the most a remix may have.
  count?: number;
  max?: number;
  // The creator's note for the prompt: "the elves wear pointed green hats".
  note?: string;
};

// What a remix asked of one part, as the server checked it. photos are the member's images, in order.
export type PartChange = {
  partId: string;
  kind: PartKind;
  label: string;
  from: string;
  to?: string;
  photos: Array<{ imageId: string; key: string }>;
  // A person left out (no photo, and the creator's rule is to leave them out).
  omit?: boolean;
};

export const MAX_PARTS = 8;
export const MAX_PART_LABEL = 40;
export const MAX_PART_TEXT = 160;
export const MAX_PART_NOTE = 200;
export const MAX_SWAP_LENGTH = 120;
// A group can hold up to this many photos; the creator can set less.
export const MAX_GROUP = 8;
// A remix's part photos plus its own images stay within what one call took in testing (16).
export const MAX_PART_PHOTOS = 8;

const clean = (text: string, limit: number) => [...text.replace(/\s+/gu, " ").trim()].slice(0, limit).join("");

// Parts as a creator saves them: known kinds, labels and texts trimmed, a group's count and limit in
// range, at most MAX_PARTS. Ids stay; a part without one gets the next free one.
export function normalizeParts(parts: ReadonlyArray<Partial<RemixPart>>): Array<RemixPart> {
  const used = new Set(parts.map((p) => p.id).filter(Boolean));
  let next = 1;
  const freshId = () => {
    while (used.has(`p${next}`)) next++;
    used.add(`p${next}`);
    return `p${next}`;
  };
  const out: Array<RemixPart> = [];
  for (const part of parts) {
    if (out.length >= MAX_PARTS) break;
    const kind = part.kind;
    if (kind !== "character" && kind !== "person" && kind !== "group") continue;
    const label = clean(part.label ?? "", MAX_PART_LABEL);
    if (!label) continue;
    const base: RemixPart = {
      id: part.id && /^p\d{1,3}$/u.test(part.id) ? part.id : freshId(),
      kind,
      label,
      text: clean(part.text ?? "", MAX_PART_TEXT) || label.toLowerCase(),
      on: part.on !== false,
    };
    const note = clean(part.note ?? "", MAX_PART_NOTE);
    if (note) base.note = note;
    if (kind === "person") base.empty = part.empty === "omit" || part.empty === "require" ? part.empty : "keep";
    if (kind === "group") {
      const count = Math.max(1, Math.min(MAX_GROUP, Math.round(Number(part.count) || 1)));
      base.count = count;
      base.max = Math.max(count, Math.min(MAX_GROUP, Math.round(Number(part.max) || Math.max(count, 6))));
    }
    out.push(base);
  }
  return out;
}

// Luna's proposal, read from its JSON answer.
export function parseProposedParts(text: string): Array<RemixPart> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { parts?: unknown };
    if (!Array.isArray(parsed.parts)) return null;
    return normalizeParts(parsed.parts as Array<Partial<RemixPart>>);
  } catch {
    return null;
  }
}

// A remix's own parts: the parent's, same ids and rules. A character keeps its new subject as what
// the design now shows; a person or group drawn from photos still reads as that role.
export function inheritParts(parent: Array<RemixPart>, changes: Array<PartChange>) {
  const byId = new Map(changes.map((c) => [c.partId, c]));
  return parent.flatMap((part) => {
    const change = byId.get(part.id);
    if (change?.omit) return [];
    if (part.kind === "character" && change?.to) return [{ ...part, text: change.to }];
    if (part.kind === "group" && change && change.photos.length > 0) {
      const count = change.photos.length;
      return [{ ...part, count, max: Math.max(part.max ?? count, count) }];
    }
    return [part];
  });
}

export type PartProblem = "UNKNOWN_PART" | "PART_LOCKED" | "REPEATED" | "TOO_MANY_PHOTOS" | "NEEDS_PHOTO" | "TOO_LONG";

export type AskedPart = { partId: string; to?: string; photos: Array<{ imageId: string; key: string }> };

// What a remix asks of the parts, checked against the parts as the server stored them. Only
// switched-on parts take changes; a character takes new words (up to MAX_SWAP_LENGTH) and at most
// one photo, a person one photo, a group up to its limit. A person whose rule is "require" needs a
// photo, and one whose rule is "omit" is left out without one. Unchanged entries drop out.
export function checkPartChanges(
  parts: Array<RemixPart>,
  asked: Array<AskedPart>,
): { ok: true; changes: Array<PartChange> } | { ok: false; problem: PartProblem; label?: string; limit?: number } {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const seen = new Set<string>();
  const changes: Array<PartChange> = [];
  for (const entry of asked) {
    if (seen.has(entry.partId)) return { ok: false, problem: "REPEATED" };
    seen.add(entry.partId);
    const part = byId.get(entry.partId);
    if (!part) return { ok: false, problem: "UNKNOWN_PART" };
    if (!part.on) return { ok: false, problem: "PART_LOCKED", label: part.label };
    const to = part.kind === "character" ? clean(entry.to ?? "", MAX_SWAP_LENGTH + 1) : "";
    if ([...to].length > MAX_SWAP_LENGTH) return { ok: false, problem: "TOO_LONG", label: part.label, limit: MAX_SWAP_LENGTH };
    const limit = part.kind === "group" ? (part.max ?? MAX_GROUP) : 1;
    if (entry.photos.length > limit) return { ok: false, problem: "TOO_MANY_PHOTOS", label: part.label, limit };
    if (!to && entry.photos.length === 0) continue;
    changes.push({ partId: part.id, kind: part.kind, label: part.label, from: part.text, ...(to ? { to } : {}), photos: entry.photos });
  }
  for (const part of parts) {
    if (!part.on || part.kind !== "person" || changes.some((c) => c.partId === part.id)) continue;
    if (part.empty === "require") return { ok: false, problem: "NEEDS_PHOTO", label: part.label };
    if (part.empty === "omit") changes.push({ partId: part.id, kind: part.kind, label: part.label, from: part.text, photos: [], omit: true });
  }
  return { ok: true, changes };
}

// "image 3", "images 3 and 4", "images 3, 4, and 5".
function imageList(numbers: Array<number>) {
  if (numbers.length === 1) return `image ${numbers[0]}`;
  if (numbers.length === 2) return `images ${numbers[0]} and ${numbers[1]}`;
  return `images ${numbers.slice(0, -1).join(", ")}, and ${numbers[numbers.length - 1]}`;
}

// Who a photo's person is stays theirs: in the first Santa test (2026-10-06), lines that described
// the role with the original's own looks ("an elderly woman with curled white hair, spectacles")
// kept the original Mrs. Claus in 4 of 4 designs, and "three elves" beside "exactly 4" gave three.
// So people and groups are named by role only, and their looks come from their photos.
const OWN_LOOKS = "their own face, hair, skin tone, glasses, age, and expression from their photo, so someone who knows them would recognize them";

// "elves" from "Elves", "the band" stays.
const plural = (label: string) => label.toLowerCase();

// The remix prompt's part changes (convex/lib/prompts.ts studioPrompt). photoNumbers gives each
// change's photos their image numbers in the call, in order.
export function partChangeInstruction(
  parts: Array<RemixPart>,
  changes: Array<PartChange>,
  photoNumbers: Map<string, Array<number>>,
) {
  if (changes.length === 0) return "";
  const byId = new Map(parts.map((part) => [part.id, part]));
  const counts: Array<string> = [];
  const lines = changes.map((change) => {
    const part = byId.get(change.partId);
    const what = part?.text || change.from;
    const numbers = photoNumbers.get(change.partId) ?? [];
    const note = part?.note ? ` Creator's note: ${part.note}` : "";
    if (change.omit) {
      counts.push(`no ${change.label}`);
      return `- ${change.label}: leave image 1's ${change.label} out of the design, and let the rest of it fill that place so nothing looks missing.`;
    }
    if (change.kind === "character") {
      const swap = change.to && numbers.length > 0
        ? `${change.to}, the one in ${imageList(numbers)}, keeping its recognizable likeness`
        : numbers.length > 0
          ? `the subject in ${imageList(numbers)}, keeping its recognizable likeness`
          : (change.to ?? what);
      return `- ${change.label}: replace ${what} with ${swap}. Draw it the way image 1 draws ${what}, in the same place, size, and pose where it fits.${note}`;
    }
    if (change.kind === "person") {
      counts.push(`1 ${change.label}`);
      return (
        `- ${change.label}: the person in ${imageList(numbers)} becomes image 1's ${change.label}: same place, pose, and outfit, drawn the way image 1 draws people, ` +
        `but with ${OWN_LOOKS}. Don't keep the original ${change.label}'s face or hair.${note}`
      );
    }
    const count = numbers.length;
    const group = plural(change.label);
    const shown = part?.count ? ` (image 1 shows ${part.count})` : "";
    counts.push(`${count} ${group}`);
    const each = numbers.map((n, i) => `${i + 1}: the person in image ${n}`).join("; ");
    return (
      `- ${change.label}: draw exactly ${count} ${group}${shown}, no more and no fewer, one for each photo: ${each}. ` +
      `Each wears image 1's ${group} outfit and is drawn the way image 1 draws them, but with ${OWN_LOOKS}. ` +
      `Make room for all ${count} where image 1's ${group} are, keeping the group's arrangement.${note}`
    );
  });
  const check = counts.length > 0 ? `\nCount check: ${counts.join(", ")}, and every photo appears exactly once, as its own role.` : "";
  return `Changes to image 1's characters (its creator made these remixable):\n${lines.join("\n")}${check}`;
}

// Short line for a batch and a published remix: "Santa from a photo · Elves: 5 from photos".
export function partSummary(changes: ReadonlyArray<Pick<PartChange, "kind" | "label" | "to" | "photos" | "omit">>) {
  return changes
    .map((c) => {
      if (c.omit) return `${c.label} left out`;
      if (c.kind === "group") return `${c.label}: ${c.photos.length} from photos`;
      if (c.kind === "character" && c.to) return `${c.label} to ${c.to}`;
      return `${c.label} from a photo`;
    })
    .join(" · ");
}

// For the variation-or-fork comparison: what the creator lets a remix change, so those changes
// (a different number of elves and the room they take) don't count toward a fork.
export function allowedChangesNote(parts: Array<RemixPart>) {
  const open = parts.filter((part) => part.on);
  if (open.length === 0) return "";
  const items = open.map((part) =>
    part.kind === "group"
      ? `${part.label} (any number of them, drawn from photos, and the room they take)`
      : part.kind === "person"
        ? `${part.label} (drawn as someone from a photo, or left out)`
        : `${part.label} (swapped for another subject)`,
  );
  return `The original's creator lets remixes change these parts: ${items.join("; ")}. Changes to them, including how the layout makes room, don't count toward a fork.`;
}
