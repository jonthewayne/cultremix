import { requestedWords } from "./prompts";

// The studio's spelling check (convex/spelling.ts): once a batch's designs are in, each one's
// lettering is read back letter for letter (convex/lib/wordReader.ts) and compared with the words
// the batch asked for. Pure, so the rules are tested without a model.

export type SpellingMiss = { asked: string; read: string };

// Words as compared: capitals, letters and digits only, single spaces.
export function normalizeWords(text: string) {
  return text
    .toUpperCase()
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// The words a batch asked for: its request's words in capitals or quotes (prompts.ts
// requestedWords), and a remix's new words.
export function wordsToCheck(batch: { instruction: string; wordChanges?: ReadonlyArray<{ to: string }> }): Array<string> {
  const words = [...requestedWords(batch.instruction), ...(batch.wordChanges ?? []).map((change) => change.to)];
  return [...new Set(words.map((word) => word.trim()).filter((word) => normalizeWords(word).length > 0))];
}

// Letters added, dropped, or changed to turn a into b.
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

// How far off a word can read and still be that word misspelled: one letter in a four-letter word,
// two in five to seven letters, about a third beyond, and one more when it starts with the same
// letter. TRASH drawn as TRROSH is two off, and as TRROW three (a style image's GROW leaking in).
function allowedOff(word: Array<string>, token: Array<string>) {
  const length = word.length;
  return (length <= 4 ? 1 : Math.max(2, Math.round(length / 3))) + (token[0] === word[0] ? 1 : 0);
}

// The asked words a design spelled a letter or two off, each with what it reads instead. Words of
// three letters or fewer aren't checked, and neither is a word the design doesn't show at all,
// since a word in capitals can name a style rather than ask for lettering. Lettering read in pieces
// ("NIGH T SHIFT") still counts as spelled right.
export function spellingMisses(asked: ReadonlyArray<string>, read: ReadonlyArray<string>): Array<SpellingMiss> {
  const tokens = read.flatMap((piece) => normalizeWords(piece).split(" ").filter(Boolean));
  const have = new Set(tokens);
  const joined = tokens.join("");
  const seen = new Set<string>();
  const misses: Array<SpellingMiss> = [];
  for (const phrase of asked) {
    for (const word of normalizeWords(phrase).split(" ")) {
      if ([...word].length < 4 || seen.has(word)) continue;
      seen.add(word);
      if (have.has(word) || joined.includes(word)) continue;
      let best: { token: string; off: number } | null = null;
      for (const token of tokens) {
        const limit = allowedOff([...word], [...token]);
        if (Math.abs([...token].length - [...word].length) > limit) continue;
        const off = editDistance(word, token);
        if (off <= limit && (!best || off < best.off)) best = { token, off };
      }
      if (best) misses.push({ asked: word, read: best.token });
    }
  }
  return misses;
}
