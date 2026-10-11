import { describe, expect, it } from "vitest";
import { inkOn } from "../../src/lib/imagePrep";

// WCAG contrast of black or white text on a background.
function contrast(ink: string, background: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const [a, b] = [luminance(ink), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe("inkOn", () => {
  it("picks whichever of black or white reads better", () => {
    expect(inkOn("#ffffff")).toBe("#000000");
    expect(inkOn("#000000")).toBe("#ffffff");
    expect(inkOn("#1b1b1c")).toBe("#ffffff");
    expect(inkOn("#f4f1ea")).toBe("#000000");
    // Mid tones take black: a gray studio background, a red, and a mid gray.
    expect(inkOn("#8c928b")).toBe("#000000");
    expect(inkOn("#ff0000")).toBe("#000000");
    expect(inkOn("#767676")).toBe("#000000");
    expect(inkOn("#1f2a44")).toBe("#ffffff");
  });

  it("always reaches 4.5:1 on any gray, so small labels pass WCAG AA", () => {
    for (let v = 0; v <= 255; v += 5) {
      const gray = "#" + v.toString(16).padStart(2, "0").repeat(3);
      expect(contrast(inkOn(gray), gray)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads anything that isn't a 6-digit hex as a light background", () => {
    expect(inkOn("nope")).toBe("#000000");
  });
});

