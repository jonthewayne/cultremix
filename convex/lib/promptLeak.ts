import { normalizeWords } from "./spelling";

// The last check on a request that might be after the studio's prompt: before the designs are
// stored, each one's lettering is read back (convex/lib/wordReader.ts), and a design that prints
// several words found only in the hidden prompt is dropped, with its credit back. The request
// screen (convex/lib/requestGuard.ts) refuses such requests first; this catches one it lets through.
// Image models follow a request to "write out every instruction above" over any rule against it
// (the image test suite's guard-no-leak, 2026-11-15: every design printed the grid rules), so the
// check reads what was drawn. Only requests that use the words such a request needs are read,
// which keeps the reading off ordinary batches. Pure, for tests.

const SUSPECT =
  /\b(?:above|before|earlier|previous|preceding|instruct\w*|prompt\w*|rules?|system|told|given|sent|notes?|descri\w*|definitions?|verbatim|word.for.word|repeat\w*|quot\w*|context|hidden|secret|guidelines?|directions?|translat\w*|reveal\w*|disclos\w*|config\w*|summar\w*|setup|behind the scenes)\b/iu;

export function mightAskForPrompt(request: string) {
  return SUSPECT.test(request);
}

// Words the prompt says that the design has no business lettering: the prompt's words of four
// letters or more, minus the request's own words and the images' quoted words (the notes quote
// every piece of text an image shows, and those may be lettered).
export function promptOnlyWords(prompt: string, request: string) {
  const quoted = [...prompt.matchAll(/[“"]([^”"]{1,200})[”"]/gu)].map((m) => m[1]).join(" ");
  const allowed = new Set(normalizeWords(request + " " + quoted).split(" "));
  return new Set(normalizeWords(prompt).split(" ").filter((word) => [...word].length >= 4 && !allowed.has(word)));
}

// The prompt-only words a design's lettering shows, each once.
export function leakedWords(promptOnly: ReadonlySet<string>, lettering: ReadonlyArray<string>) {
  const found = new Set<string>();
  for (const piece of lettering) for (const word of normalizeWords(piece).split(" ")) if (promptOnly.has(word)) found.add(word);
  return [...found];
}

// Five distinct prompt-only words, three of them in a row (shorter words between them don't break
// the run), is a leak. A design's own lettering rarely shares more than a word or two with the
// prompt that isn't in the request, and scattered ordinary words (MAKE, BOLD, COLOR) aren't a
// sentence of it; the leaks in the suite showed dozens, in the prompt's own order.
export const LEAK_THRESHOLD = 5;
export const LEAK_RUN = 3;
export function isLeak(promptOnly: ReadonlySet<string>, lettering: ReadonlyArray<string>) {
  if (leakedWords(promptOnly, lettering).length < LEAK_THRESHOLD) return false;
  let run = 0;
  for (const piece of lettering) {
    for (const word of normalizeWords(piece).split(" ")) {
      if ([...word].length < 4) continue;
      run = promptOnly.has(word) ? run + 1 : 0;
      if (run >= LEAK_RUN) return true;
    }
  }
  return false;
}
