import { describe, expect, it } from "vitest";
import { GARMENT_COLORS, colorKey, defaultOfferedColors, garmentColor, nearestGarmentColor, validateOfferedColors } from "../../convex/lib/garments";

// The active shirt's colors (convex/merch.ts) as the palette: a smaller set with a color the
// launch colors don't have.
const PALETTE = [
  { key: "black", name: "Black", hex: "#1b1b1c" },
  { key: "ivory", name: "Ivory", hex: "#fff4d9" },
  { key: "mustard", name: "Mustard", hex: "#ffbc5a" },
  { key: "true-navy", name: "True Navy", hex: "#1e2c4a" },
  { key: "emerald", name: "Emerald", hex: "#306d6e" },
];

describe("a palette from the active shirt", () => {
  it("makes keys from catalog names the way the launch colors were keyed", () => {
    expect(colorKey("True Navy")).toBe("true-navy");
    expect(colorKey("Burnt orange")).toBe("burnt-orange");
    expect(colorKey("  Chalky  Mint ")).toBe("chalky-mint");
  });

  it("snaps to the palette's nearest color, and validates against the palette", () => {
    expect(nearestGarmentColor("#f0b050", PALETTE).key).toBe("mustard");
    expect(nearestGarmentColor("#ffffff", PALETTE).key).toBe("ivory");
    expect(validateOfferedColors(["mustard", "black"], PALETTE)).toEqual({ ok: true, keys: ["mustard", "black"] });
    expect(validateOfferedColors(["watermelon"], PALETTE)).toMatchObject({ ok: false });
    expect(garmentColor("mustard", PALETTE)?.name).toBe("Mustard");
  });

  it("starts a design on its own nearest color, then the defaults the palette has", () => {
    expect(defaultOfferedColors("#2a7070", new Set(), PALETTE)).toEqual(["emerald", "ivory", "black", "true-navy"]);
    // Without a palette, the launch colors.
    expect(defaultOfferedColors("#2a7070")[0]).toBe(nearestGarmentColor("#2a7070", GARMENT_COLORS).key);
  });
});

