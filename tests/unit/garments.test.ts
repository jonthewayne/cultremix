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
