import { editDistance, normalizeWords } from "./spelling";

// Words a remix must keep: the pieces of the original's lettering its creator didn't make remixable
// (remix fields switched off, convex/lib/remixFields.ts). The remix boxes can't change them, but a
// request typed in words can ask for anything, so before a remix publishes, its lettering is read back
// (convex/lib/wordReader.ts) and checked here. A remix that dropped or replaced a kept word publishes
// as a fork, where anything goes (convex/publish.ts remixRelation). Pure, for tests.

// How far a reading can be off and still be the kept word: the image model's slips and the reader's
// misreads count as kept (TRASH drawn as TrROH is two letters off). One letter for words of up to
// four letters, about a third beyond, and one more when it starts with the same letter.
function allowedSlip(word: string, token: string) {
  const length = [...word].length;
  return (length <= 4 ? 1 : Math.max(2, Math.round(length / 3))) + (token[0] === word[0] ? 1 : 0);
}

// The kept words a design's lettering no longer shows, in the order given, each once. Words of two
// letters or fewer aren't checked: a reader skips them, and they rarely carry a design. Lettering
// read in pieces ("NIGH T SHIFT") still counts.
export function missingKeptWords(kept: ReadonlyArray<string>, read: ReadonlyArray<string>): Array<string> {
  const tokens = read.flatMap((piece) => normalizeWords(piece).split(" ").filter(Boolean));
  const have = new Set(tokens);
  const joined = tokens.join("");
  const missing: Array<string> = [];
  const seen = new Set<string>();
  for (const piece of kept) {
    for (const word of normalizeWords(piece).split(" ")) {
      if ([...word].length < 3 || seen.has(word)) continue;
      seen.add(word);
      if (have.has(word) || joined.includes(word)) continue;
      const close = tokens.some((token) => Math.abs([...token].length - [...word].length) <= allowedSlip(word, token) && editDistance(word, token) <= allowedSlip(word, token));
      if (!close) missing.push(word);
    }
  }
  return missing;
}

// The kept pieces of a design's remixable words: every switched-off field's text.
export function keptPieces(fields: ReadonlyArray<{ on: boolean; text: string }> | undefined): Array<string> {
  return (fields ?? []).filter((field) => !field.on && field.text.trim()).map((field) => field.text.trim());
}
