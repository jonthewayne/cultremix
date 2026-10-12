import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchOriginals, pickDesigns } from "../../scripts/lib/launchSet";

// The launch set's originals, read from docs/hackathon/launch-set.md (scripts/lib/launchSet.ts).
const DOC = readFileSync(new URL("../../docs/hackathon/launch-set.md", import.meta.url), "utf8");

describe("the launch set", () => {
  it("reads every original from the doc's table, and nothing from the remixes table", () => {
    const designs = launchOriginals(DOC);
    expect(designs.length).toBeGreaterThanOrEqual(9);
    expect(designs[0]).toEqual({ title: "Grow Slow", request: "A psychedelic 70s mushroom graphic that says GROW SLOW" });
    expect(designs.map((d) => d.title)).toContain("Merry & Bright");
    expect(designs.every((d) => d.request.length > 20)).toBe(true);
    expect(designs.map((d) => d.title)).not.toContain("Original");
  });

  it("picks designs by title and names the ones it doesn't know", () => {
    const designs = launchOriginals(DOC);
    expect(pickDesigns(designs, "night shift, Grow Slow").map((d) => d.title)).toEqual(["Grow Slow", "Night Shift"]);
    expect(pickDesigns(designs, undefined)).toBe(designs);
    expect(() => pickDesigns(designs, "Grow Fast")).toThrow(/No design called grow fast\. The launch set has: Grow Slow/);
  });

  it("refuses a doc without the table", () => {
    expect(() => launchOriginals("# Launch set\n")).toThrow(/no Originals section/);
  });
});
