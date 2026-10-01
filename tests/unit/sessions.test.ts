import { describe, expect, it } from "vitest";
import { sessionName } from "../../convex/lib/sessions";

describe("session names", () => {
  it("prefers the member's own title", () => {
    expect(sessionName({ title: "  Trash royalty  ", firstInstruction: "A raccoon" })).toBe("Trash royalty");
  });

  it("names a remix by its CR number", () => {
    expect(sessionName({ remixCr: "101-001", firstInstruction: "Change the words" })).toBe("Remix of CR 101-001");
  });

  it("falls back to the first request, shortened", () => {
    expect(sessionName({ firstInstruction: "A raccoon in a tiny crown" })).toBe("A raccoon in a tiny crown");
    const long = "A psychedelic 70s mushroom graphic that says GROW SLOW with stars and swirls all around";
    expect(sessionName({ firstInstruction: long })).toBe("A psychedelic 70s mushroom graphic that says GROW SLOW…");
    expect(sessionName({})).toBe("Untitled session");
  });
});
