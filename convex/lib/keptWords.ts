import { editDistance, normalizeWords } from "./spelling";

// Words a remix must keep: the pieces of the original's lettering its creator didn't make remixable
// (remix fields switched off, convex/lib/remixFields.ts). The remix boxes can't change them, but a
// request typed in words can ask for anything, so before a remix publishes, its lettering is read back
// (convex/lib/wordReader.ts) and checked here. A remix that dropped or replaced a kept word publishes
// as a fork, where anything goes (convex/publish.ts remixRelation). Pure, for tests.

// How far a reading can be off and still be the kept word: the image model's slips and the reader's
// misreads count as kept (TRASH drawn as TrROH is two letters off). One letter for words of up to
// four letters, two up to six, about a third beyond. A near reading the remix's request asked for
// (LIFE in "change LOVE to LIFE") is a replacement, not a slip.
function allowedSlip(word: string) {
  const length = [...word].length;
  return length <= 4 ? 1 : length <= 6 ? 2 : Math.round(length / 3);
}

// The kept words a design's lettering no longer shows, in the order given, each once. Words of two
// letters or fewer aren't checked: a reader skips them, and they rarely carry a design. Lettering
// read in pieces ("NIGH T SHIFT") or run together ("NIGHTSHIFT") still counts; a kept word inside
// another word (ART in SMART) doesn't. asked: the remix request's words and new remix-box words.
export function missingKeptWords(
  kept: ReadonlyArray<string>,
  read: ReadonlyArray<string>,
  asked: ReadonlyArray<string> = [],
  // Kept words that must read exactly (or run together with another): no slip allowed. For a
  // remix whose request asked for changes in words, a near reading of a word the original shows
  // exactly is more likely a different word (LOVE as LIVE) than a misdrawn one.
  strict: ReadonlySet<string> = new Set(),
): Array<string> {
  const tokens = read.flatMap((piece) => normalizeWords(piece).split(" ").filter(Boolean));
  const have = new Set(tokens);
  // Neighbouring pieces read together: NIGH + T.
  for (let i = 0; i < tokens.length; i++) {
    for (let k = 2; k <= 3 && i + k <= tokens.length; k++) have.add(tokens.slice(i, i + k).join(""));
  }
  const requested = new Set(asked.flatMap((text) => normalizeWords(text).split(" ").filter(Boolean)));
  const keptWords = new Set(kept.flatMap((piece) => normalizeWords(piece).split(" ").filter(Boolean)));
  const missing: Array<string> = [];
  const seen = new Set<string>();
  for (const piece of kept) {
    for (const word of normalizeWords(piece).split(" ")) {
      if ([...word].length < 3 || seen.has(word)) continue;
      seen.add(word);
      if (have.has(word)) continue;
      // Run together with another kept word or one the remix asked for (NIGHTSHIFT for NIGHT
      // SHIFT, SUNSET for SUN and a new SET). Grown into a different word (EVER into NEVER, KIND
      // into UNKIND) isn't kept.
      const joins = (rest: string) => [...rest].length >= 3 && (keptWords.has(rest) || requested.has(rest));
      const runTogether = tokens.some(
        (token) =>
          !requested.has(token) &&
          ((token.startsWith(word) && joins(token.slice(word.length))) || (token.endsWith(word) && joins(token.slice(0, -word.length)))),
      );
      if (runTogether) continue;
      // A slip changes letters inside the word; letters added at either end make another word
      // (LOVE into GLOVE, RAIN into TRAIN).
      const close = !strict.has(word) && tokens.some(
        (token) => !requested.has(token) && !token.startsWith(word) && !token.endsWith(word) && editDistance(word, token) <= allowedSlip(word),
      );
      if (!close) missing.push(word);
    }
  }
  return missing;
}

// The kept pieces of a design's remixable words: every switched-off field's text.
export function keptPieces(fields: ReadonlyArray<{ on: boolean; text: string }> | undefined): Array<string> {
  return (fields ?? []).filter((field) => !field.on && field.text.trim()).map((field) => field.text.trim());
}

// The kept words a reading shows letter for letter (the original's own lettering, read the same way).
export function exactWords(kept: ReadonlyArray<string>, read: ReadonlyArray<string>): Array<string> {
  const tokens = new Set(read.flatMap((piece) => normalizeWords(piece).split(" ").filter(Boolean)));
  return [...new Set(kept.flatMap((piece) => normalizeWords(piece).split(" ")))].filter((word) => [...word].length >= 3 && tokens.has(word));
}
