// The text rules for remixable words that the browser shares with the server
// (convex/lib/remixFields.ts): how new words are cleaned and counted, and the one-line summary of
// a remix's changes. Pure, with no imports, so the studio and the shop page can load it.

// Characters as people count them (an emoji is one).
export function length(text: string) {
  return [...text].length;
}

// The most one remixable-words box takes. The image model resets longer words smaller or over more
// lines; anything longer goes in the request ("Anything else to change?").
export const MAX_FIELD_LENGTH = 80;

// New text as it's compared and stored: Windows line breaks made plain, ends trimmed.
export function cleanFieldText(text: string) {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// "GROW SLOW to GROW WILD" (or "removed EST. 1992" for an emptied box), for the batch line and the
// published remix.
export function changeSummary(changes: Array<{ from: string; to: string }>) {
  const flat = (text: string) => text.replace(/\s*\n\s*/gu, " ");
  return changes.map((c) => (c.to ? `${flat(c.from)} to ${flat(c.to)}` : `removed ${flat(c.from)}`)).join("; ");
}
