import { describe, expect, it } from "vitest";
import { ALL_IDEAS, pickIdeas } from "../../src/lib/promptIdeas";

describe("studio prompt ideas", () => {
  it("shuffles to ideas that aren't already on screen", () => {
    const onScreen = pickIdeas(3);
    for (let i = 0; i < 20; i++) {
      const next = pickIdeas(3, onScreen);
      expect(new Set(next).size).toBe(3);
      for (const idea of next) expect(onScreen).not.toContain(idea);
    }
  });

  it("each idea is unique, puts words on the shirt, and skips the retired NO VACANCY design", () => {
    expect(new Set(ALL_IDEAS).size).toBe(ALL_IDEAS.length);
    for (const idea of ALL_IDEAS) {
      expect(idea).toMatch(/[A-Z]{3,}/);
      expect(idea.toUpperCase()).not.toContain("NO VACANCY");
    }
  });
});
