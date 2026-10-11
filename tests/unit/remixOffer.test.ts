import { describe, expect, it } from "vitest";
import { offerLine, wordsLine } from "../../src/lib/remixOffer";

// "A remix can change" on a work page (src/lib/remixOffer.ts).
describe("what a remix can change", () => {
  it("says what a remix may do with each part", () => {
    expect(offerLine({ id: "p1", kind: "character", label: "The lion" })).toBe("The lion: swap it for anything");
    expect(offerLine({ id: "p2", kind: "person", label: "Santa", empty: "keep" })).toBe("Santa: anyone, from a photo");
    expect(offerLine({ id: "p3", kind: "person", label: "Mrs. Claus", empty: "omit" })).toBe("Mrs. Claus: anyone, from a photo, or left out");
    expect(offerLine({ id: "p4", kind: "person", label: "The bride", empty: "require" })).toBe("The bride: anyone, from a photo (a photo is needed)");
    expect(offerLine({ id: "p5", kind: "group", label: "Elves", count: 3, max: 6 })).toBe("Elves: up to 6, one photo each");
    expect(offerLine({ id: "p6", kind: "group", label: "The band", count: 4 })).toBe("The band: up to 4, one photo each");
  });

  it("names the words once each, in order", () => {
    expect(wordsLine(["GROW", "SLOW"])).toBe("GROW and SLOW");
    expect(wordsLine(["OFFLINE", "IS THE NEW", "LUXURY"])).toBe("OFFLINE, IS THE NEW and LUXURY");
    expect(wordsLine(["NIGHT", "SHIFT", "Z", "Z", "Z"])).toBe("NIGHT, SHIFT and Z");
    expect(wordsLine(["MERRY &\nBRIGHT"])).toBe("MERRY & BRIGHT");
    expect(wordsLine([])).toBe("");
  });
});
