import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOR_COUNT,
  GARMENT_COLORS,
  defaultOfferedColors,
  nearestGarmentColor,
  validateOfferedColors,
  visibilityOn,
} from "../../convex/lib/garments";
import { normalizeWaitlistEmail } from "../../convex/lib/earlyAccess";
import { readDesignPixels } from "../../src/lib/designPixels";

describe("offered colors", () => {
  it("accepts only shirt colors, at least one, keeping the lead first", () => {
    expect(validateOfferedColors(["moss", "Ivory", "moss"])).toEqual({ ok: true, keys: ["moss", "ivory"] });
    expect(validateOfferedColors([])).toMatchObject({ ok: false });
    expect(validateOfferedColors(["ivory", "neon"])).toMatchObject({ ok: false });
    expect(validateOfferedColors(["#1f1f1f"])).toMatchObject({ ok: false });
  });

  it("has unique keys and valid hex values", () => {
    expect(new Set(GARMENT_COLORS.map((color) => color.key)).size).toBe(GARMENT_COLORS.length);
    for (const color of GARMENT_COLORS) expect(color.hex).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("starts from the closest shade to the design's background", () => {
    // The studio's default off-white reads as the white shirt.
    expect(nearestGarmentColor("#f4f1ea").key).toBe("white");
    expect(nearestGarmentColor("#ece4d2").key).toBe("ivory");
    expect(nearestGarmentColor("#000000").key).toBe("black");
    expect(nearestGarmentColor("not a color").key).toBe("ivory");
    expect(defaultOfferedColors("#f4f1ea")).toEqual(["white", "ivory", "black", "true-navy"]);
    expect(defaultOfferedColors("#efe8d8")).toEqual(["ivory", "black", "true-navy", "butter"]);
    expect(defaultOfferedColors("#5d7590")).toEqual(["blue-jean", "ivory", "black", "true-navy"]);
    const skipped = defaultOfferedColors("#efe8d8", new Set(["black", "true-navy"]));
    expect(skipped).toHaveLength(DEFAULT_COLOR_COUNT);
    expect(skipped).not.toContain("black");
  });
});

describe("the contrast check", () => {
  const black: [number, number, number] = [20, 20, 20];
  const yellow: [number, number, number] = [240, 220, 60];

  it("warns when the design would disappear into the shirt", () => {
    const allBlack = Array.from({ length: 50 }, () => black);
    expect(visibilityOn(allBlack, "#1f1f1f")).toBe("disappears");
    expect(visibilityOn(allBlack, "#efe8d8")).toBe("clear");
    const half = [...Array.from({ length: 20 }, () => black), ...Array.from({ length: 30 }, () => yellow)];
    expect(visibilityOn(half, "#1f1f1f")).toBe("faint");
    expect(visibilityOn([], "#1f1f1f")).toBe("clear");
    // Dark ink on navy is nearly the same brightness; a bright hue of the same brightness isn't lost.
    expect(visibilityOn(allBlack, "#2c3447")).toBe("disappears");
    expect(visibilityOn(allBlack, "#6c6c47")).toBe("clear");
    const red = Array.from({ length: 50 }, (): [number, number, number] => [200, 40, 40]);
    expect(visibilityOn(red, "#b4d9c8")).toBe("clear");
  });

  it("looks at the edge, where the shirt meets the design", () => {
    const half = [...Array.from({ length: 20 }, () => black), ...Array.from({ length: 30 }, () => yellow)];
    const mostlyBlack = [...Array.from({ length: 35 }, () => black), ...Array.from({ length: 15 }, () => yellow)];
    const yellowEdge = Array.from({ length: 12 }, () => yellow);
    const blackEdge = Array.from({ length: 12 }, () => black);
    // Black lines inside a yellow sticker stay visible on a black shirt; a black outline doesn't.
    expect(visibilityOn(half, "#1f1f1f", yellowEdge)).toBe("clear");
    expect(visibilityOn(half, "#1f1f1f", blackEdge)).toBe("faint");
    // Mostly black inside a yellow rim reads faint; with a black edge too it disappears.
    expect(visibilityOn(mostlyBlack, "#1f1f1f", yellowEdge)).toBe("faint");
    expect(visibilityOn(mostlyBlack, "#1f1f1f", blackEdge)).toBe("disappears");
  });
});

describe("reading a design's pixels", () => {
  // A size × size RGBA image: paint(x, y) gives each pixel's [r, g, b, a].
  const image = (size: number, paint: (x: number, y: number) => [number, number, number, number]) =>
    Array.from({ length: size * size }, (_, i) => paint(i % size, Math.floor(i / size))).flat();
  const RED: [number, number, number, number] = [220, 30, 30, 255];
  const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

  it("takes the opaque pixels, and those beside transparency as the edge", () => {
    // A 3×3 red square in the middle of a transparent 5×5: its 8 outer pixels are the edge.
    const data = image(5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? RED : CLEAR));
    const { all, edge } = readDesignPixels(data, 5, 5, 5, "#ffffff");
    expect(all).toHaveLength(9);
    expect(edge).toHaveLength(8);
  });

  it("drops a painted background, and the design's edge is where it was", () => {
    // Solid all over: a white background around a 2×2 red middle.
    const data = image(4, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 2 ? RED : [255, 255, 255, 255]));
    const { all, edge } = readDesignPixels(data, 4, 4, 4, "#ffffff");
    expect(all).toEqual(Array.from({ length: 4 }, () => [220, 30, 30]));
    expect(edge).toHaveLength(4);
  });
});

describe("early-access emails", () => {
  it("normalizes and validates", () => {
    expect(normalizeWaitlistEmail("  Fan@Example.COM ")).toEqual({ ok: true, emailLower: "fan@example.com" });
    for (const bad of ["", "fan", "fan@example", "fan@@example.com", "fan @example.com", `${"x".repeat(250)}@a.co`]) {
      expect(normalizeWaitlistEmail(bad).ok).toBe(false);
    }
  });
});
