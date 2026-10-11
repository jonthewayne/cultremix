import { describe, expect, it } from "vitest";
import { requestedWords } from "../../convex/lib/prompts";
import { editDistance, spellingMisses, wordsToCheck } from "../../convex/lib/spelling";
import { fixSpellingRequest, spellingNote } from "../../src/lib/spelling";

// The studio's spelling check (convex/lib/spelling.ts) and how the studio words it (src/lib/spelling.ts).

describe("which words a batch is checked for", () => {
  it("takes the request's words in capitals or quotes and a remix's new words", () => {
    expect(wordsToCheck({ instruction: 'a raccoon that says "trash royalty"' })).toEqual(["trash royalty"]);
    expect(wordsToCheck({ instruction: "a raccoon that says TRASH ROYALTY" })).toEqual(["TRASH ROYALTY"]);
    expect(wordsToCheck({ instruction: "", wordChanges: [{ to: "SPIN CYCLE" }] })).toEqual(["SPIN CYCLE"]);
    expect(wordsToCheck({ instruction: "a cat on a skateboard" })).toEqual([]);
  });
});

describe("spelling misses", () => {
  it("flags a word drawn a letter or two off, with what it reads instead", () => {
    // The lettering leak from the style-mixing notebook: TRASH came out TRROSH and TrROH.
    expect(spellingMisses(["TRASH ROYALTY"], ["TRROSH", "ROYALTY"])).toEqual([{ asked: "TRASH", read: "TRROSH" }]);
    expect(spellingMisses(["TRASH ROYALTY"], ["TrROH ROYALTY"])).toEqual([{ asked: "TRASH", read: "TRROH" }]);
    expect(spellingMisses(["TRASH ROYALTY"], ["TRROW", "ROYALTY"])).toEqual([{ asked: "TRASH", read: "TRROW" }]);
    expect(spellingMisses(["SINCE 1999"], ["SINCE 1990"])).toEqual([{ asked: "1999", read: "1990" }]);
  });

  it("passes words spelled right in any case, with punctuation, or read in pieces", () => {
    expect(spellingMisses(["Trash Royalty"], ["TRASH", "ROYALTY!"])).toEqual([]);
    expect(spellingMisses(["NIGHT SHIFT"], ["NIGH T SHIFT"])).toEqual([]);
    expect(spellingMisses(["DON'T PANIC"], ["DON’T", "PANIC"])).toEqual([]);
  });

  it("leaves alone short words and words the design doesn't show at all", () => {
    // A word in capitals can name a style rather than ask for lettering.
    expect(spellingMisses(["a 70S POSTER of a cat"], ["MEOW"])).toEqual([]);
    expect(spellingMisses(["THE END"], ["TEH", "EDN"])).toEqual([]);
    expect(spellingMisses(["GROW SLOW"], [])).toEqual([]);
    expect(spellingMisses(["TRASH ROYALTY"], ["TRASH", "RACCOON"])).toEqual([]);
  });

  it("counts letters added, dropped, or changed", () => {
    expect(editDistance("TRASH", "TRROSH")).toBe(2);
    expect(editDistance("GROW", "GROW")).toBe(0);
    expect(editDistance("", "ABC")).toBe(3);
  });
});

describe("the studio's words for it", () => {
  it("says what the design reads, and asks for a fix that names only the right words", () => {
    const misses = [{ asked: "TRASH", read: "TRROSH" }];
    expect(spellingNote(misses)).toBe("It reads TRROSH where you asked for TRASH.");
    expect(spellingNote([...misses, { asked: "ROYALTY", read: "ROYALTEE" }])).toBe(
      "It reads TRROSH and ROYALTEE where you asked for TRASH and ROYALTY.",
    );
    const fix = fixSpellingRequest(misses);
    expect(fix).toContain("TRASH is drawn wrong; it reads trrosh. Redraw that word from scratch with exactly its 5 letters");
    // The fix batch is checked for the right words only, never the misreading.
    expect(requestedWords(fix)).toEqual(["TRASH"]);
    expect(wordsToCheck({ instruction: fixSpellingRequest([...misses, { asked: "ROYALTY", read: "ROYALTEE" }]) })).toEqual([
      "TRASH",
      "ROYALTY",
    ]);
  });
});
