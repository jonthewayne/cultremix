import { describe, expect, it } from "vitest";
import { rolesFromWords } from "../../convex/lib/prompts";
import { withStyleOf } from "../../src/lib/styleRequest";

describe("withStyleOf", () => {
  it("starts an empty request", () => {
    expect(withStyleOf("", 1, 1, 600)).toBe("In the style of image 1: ");
    expect(withStyleOf("  ", 2, 2, 600)).toBe("Draw image 1 in the style of image 2.");
    expect(withStyleOf("", 1, 2, 600)).toBe("Draw image 2 in the style of image 1.");
    expect(withStyleOf("", 3, 3, 600)).toBe("In the style of image 3: ");
  });

  it("adds to what the request already says", () => {
    expect(withStyleOf("Change the words to GROW SLOW", 2, 2, 600)).toBe("Change the words to GROW SLOW. In the style of image 2.");
    expect(withStyleOf("a wolf howling!", 2, 2, 600)).toBe("a wolf howling! In the style of image 2.");
    expect(withStyleOf("In the style of image 1: ", 2, 2, 600)).toBe("In the style of image 1. In the style of image 2.");
  });

  it("leaves a request that already names that style", () => {
    expect(withStyleOf("draw it in the Style of Image 2, please", 2, 2, 600)).toBe("draw it in the Style of Image 2, please");
    expect(withStyleOf("in the style of image #3", 3, 3, 600)).toBe("in the style of image #3");
  });

  it("stays within the request box's limit", () => {
    expect(withStyleOf("x".repeat(574), 2, 2, 600)).toHaveLength(600);
    expect(withStyleOf("x".repeat(575), 2, 2, 600)).toBeNull();
  });

  it("writes what the server reads as a style", () => {
    // The request reader's fallback phrases (namedStyles), so these hold even when the reader can't answer.
    expect(rolesFromWords(`${withStyleOf("", 1, 1, 600)}a wolf howling at the moon`, 1)).toEqual(["style"]);
    expect(rolesFromWords(withStyleOf("", 2, 2, 600) ?? "", 2)).toEqual(["content", "style"]);
    expect(rolesFromWords(withStyleOf("Change the words to GROW SLOW", 2, 2, 600) ?? "", 2)).toEqual(["content", "style"]);
  });
});
