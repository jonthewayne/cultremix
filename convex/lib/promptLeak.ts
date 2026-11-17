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
  /\b(?:above|brief|asked|received|before|earlier|previous|preceding|instruct\w*|prompt\w*|rules?|system|told|given|sent|notes?|descri\w*|definitions?|verbatim|word.for.word|repeat\w*|quot\w*|context|hidden|secret|guidelines?|directions?|translat\w*|reveal\w*|disclos\w*|config\w*|summar\w*|setup|behind the scenes)\b/iu;

// The same words in the languages members write in most, beside English. A request in another
// language the screen couldn't answer is read anyway (convex/imageGen.ts lettersPrompt).
const SUSPECT_ELSEWHERE =
  /(?:instrucci|anterior|indicaciones|sistema|consign|précédent|precedent|instruction|anweisung|vorherig|systemprompt|istruzion|precedent|instruç|anterior|指示|指令|提示词|提示|系统|プロンプト|指示文|システム|이전|지시|프롬프트|инструкц|промпт|системн)/iu;

export function mightAskForPrompt(request: string) {
  return SUSPECT.test(request) || SUSPECT_ELSEWHERE.test(request);
}

// Words the prompt says that the design has no business lettering: the prompt's words of four
// letters or more, minus the request's own words and the images' quoted words (the notes quote
// every piece of text an image shows, and those may be lettered).
export function promptOnlyWords(prompt: string, request: string) {
  const quoted = [...prompt.matchAll(/[“"]([^”"]{1,200})[”"]/gu)].map((m) => m[1]).join(" ");
  const allowed = new Set(normalizeWords(request + " " + quoted).split(" "));
  const only = new Set(normalizeWords(prompt).split(" ").filter((word) => [...word].length >= 4 && !allowed.has(word)));
  allowedWhole.set(only, new Set([...allowed].flatMap((word) => [word, [...word].reverse().join("")])));
  return only;
}

// A design's lettered words, as read: each word, the letter-spaced runs put back together
// ("T R A N S P A R E N T"), and each read backwards, so spacing or mirroring doesn't hide a leak.
export function letteredWords(lettering: ReadonlyArray<string>): Array<string> {
  const out: Array<string> = [];
  for (const piece of lettering) {
    const words = normalizeWords(piece).split(" ").filter(Boolean);
    let run = "";
    for (const word of [...words, ""]) {
      if ([...word].length === 1) {
        run += word;
        continue;
      }
      if ([...run].length >= 4) out.push(run);
      run = "";
      if (word) out.push(word);
    }
  }
  return [...out, ...out.map((word) => [...word].reverse().join(""))];
}

// Letter-spaced lettering reads without its word gaps ("FULLYTRANSPARENTBACKGROUND"): a long
// run that isn't a prompt word is split into the prompt words it's made of, longest first.
function split(word: string, promptOnly: ReadonlySet<string>): Array<string> {
  if (promptOnly.has(word) || [...word].length < 8) return [word];
  const parts: Array<string> = [];
  let i = 0;
  while (i < word.length) {
    let next = "";
    for (let j = word.length; j >= i + 4; j--) {
      if (promptOnly.has(word.slice(i, j))) {
        next = word.slice(i, j);
        break;
      }
    }
    if (next) {
      parts.push(next);
      i += next.length;
    } else {
      i += 1;
    }
  }
  return parts.length > 0 ? parts : [word];
}

// Words a design may letter whole without being split into prompt words: the member's own words
// and the images' quoted words (promptOnlyWords leaves them out of the prompt-only set), and their
// mirrored spellings. Everything else long, a run of words lettered without gaps included, is split.
const allowedWhole = new WeakMap<ReadonlySet<string>, Set<string>>();
function lettered(promptOnly: ReadonlySet<string>) {
  return allowedWhole.get(promptOnly) ?? new Set<string>();
}

function wordsFor(promptOnly: ReadonlySet<string>, lettering: ReadonlyArray<string>) {
  const whole = lettered(promptOnly);
  return letteredWords(lettering).flatMap((word) => (whole.has(word) ? [word] : split(word, promptOnly)));
}

// The prompt-only words a design's lettering shows, each once.
export function leakedWords(promptOnly: ReadonlySet<string>, lettering: ReadonlyArray<string>) {
  const found = new Set<string>();
  for (const word of wordsFor(promptOnly, lettering)) if (promptOnly.has(word)) found.add(word);
  return [...found];
}

// A leak: five distinct prompt-only words with four of them inside any six lettered words in a row
// (words under four letters don't count), or twelve distinct anywhere. A design's own lettering
// rarely shares more than a word or two with the prompt that isn't in the request, and scattered
// ordinary words (MAKE, BOLD, COLOR) aren't a sentence of it; the leaks in the suite showed
// dozens, in the prompt's own order. A window, not a strict run, so a stray word or misread
// doesn't hide one.
export const LEAK_THRESHOLD = 5;
const LEAK_ANYWHERE = 12;
const WINDOW = 6;
const IN_WINDOW = 4;
export function isLeak(promptOnly: ReadonlySet<string>, lettering: ReadonlyArray<string>) {
  const distinct = leakedWords(promptOnly, lettering).length;
  if (distinct >= LEAK_ANYWHERE) return true;
  if (distinct < LEAK_THRESHOLD) return false;
  const read = letteredWords(lettering);
  const whole = lettered(promptOnly);
  const half = read.length / 2;
  // Forwards, then backwards (a mirrored leak reads the prompt's order backwards).
  const ordered = [...read.slice(0, half), ...read.slice(half).reverse()];
  const hits = ordered
    .flatMap((word) => (whole.has(word) ? [word] : split(word, promptOnly)))
    .filter((word) => [...word].length >= 4)
    .map((word) => promptOnly.has(word));
  for (let i = 0; i < hits.length; i++) {
    if (hits.slice(i, i + WINDOW).filter(Boolean).length >= IN_WINDOW) return true;
  }
  return false;
}
