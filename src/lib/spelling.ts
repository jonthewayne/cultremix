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

// "Fix the spelling": a fresh request on the design that fixes only its lettering. It names the
// right words alone, in capitals, so the studio spells them out letter by letter for the model and
// checks them again; the misreading stays out, or the next check would count it as asked for.
export function fixSpellingRequest(misses: ReadonlyArray<SpellingMiss>) {
  const words = [...new Set(misses.map((miss) => miss.asked))];
  return `Fix only the lettering in image 1 so ${listOf(words)} ${words.length === 1 ? "is" : "are"} spelled exactly right. Keep everything else exactly as it is: the same design, drawing, colors, and layout. Change nothing else.`;
}
