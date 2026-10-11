// The studio's spelling warning (convex/spelling.ts) in words, and the request that fixes it.

export type SpellingMiss = { asked: string; read: string };

function listOf(words: ReadonlyArray<string>) {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// "It reads TRROSH where you asked for TRASH."
export function spellingNote(misses: ReadonlyArray<SpellingMiss>) {
  return `It reads ${listOf(misses.map((miss) => miss.read))} where you asked for ${listOf(misses.map((miss) => miss.asked))}.`;
}

// "Fix the spelling": a fresh request on the design that fixes only its lettering. The right words
// go in capitals, so the studio spells them out letter by letter for the model and checks them
// again; each misreading goes in lowercase, so the next check doesn't count it as asked for.
// Without the misreading, and without "from scratch", the model copied the wrong letters back:
// image 1's notes read TrROH as TRASH, and "keep everything else" kept its letter shapes (TrRSH in
// 3 of 4, image suite words-fix-spelling, 2026-10-11).
export function fixSpellingRequest(misses: ReadonlyArray<SpellingMiss>) {
  const seen = new Set<string>();
  const unique = misses.filter((miss) => !seen.has(miss.asked) && seen.add(miss.asked));
  const one = unique.length === 1;
  const wrong = one
    ? `${unique[0].asked} is drawn wrong; it reads ${unique[0].read.toLowerCase()}`
    : unique.map((miss) => `${miss.asked} is drawn wrong (it reads ${miss.read.toLowerCase()})`).join(", and ");
  return [
    `Fix the spelling in image 1: ${wrong}.`,
    one
      ? `Redraw that word from scratch with exactly its ${[...unique[0].asked].length} letters, in the same lettering style, size, colors, and place, without reusing its current letter shapes.`
      : "Redraw those words from scratch, each with exactly its own letters, in the same lettering style, size, colors, and place, without reusing their current letter shapes.",
    "Keep everything else exactly as in image 1, in all four designs: the same drawing, colors, and layout. Change nothing else.",
  ].join(" ");
}
