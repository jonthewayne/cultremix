import { describe, expect, it } from "vitest";
import { pageColors, selectedColor } from "../../src/lib/pickedColor";
import { sellableColors } from "../../convex/lib/shopColors";
import { garmentColor } from "../../convex/lib/garments";

// What feed.byCr shows for a work offered in chalky mint, true navy, and black.
const published = ["chalky-mint", "true-navy", "black"].map((key) => garmentColor(key)!);
// What shopify.offer sells for it: chalky mint isn't in the print catalog.
const offer = {
  colors: sellableColors(["chalky-mint", "true-navy", "black"]).map(({ key, code, name, hex }) => ({ key, code, name, hex })),
};

describe("pageColors", () => {
  it("is the offer's colors while on sale, else the published ones", () => {
    expect(pageColors(published, offer).map((c) => c.key)).toEqual(["true-navy", "black"]);
    expect(pageColors(published, null).map((c) => c.key)).toEqual(["chalky-mint", "true-navy", "black"]);
    expect(pageColors(published, { colors: [] }).map((c) => c.key)).toEqual(["chalky-mint", "true-navy", "black"]);
  });

  it("uses the same swatch for a color in both lists", () => {
    const navyOnSale = pageColors(published, offer).find((c) => c.key === "true-navy")!;
    const navyPublished = published.find((c) => c.key === "true-navy")!;
    expect({ name: navyOnSale.name, hex: navyOnSale.hex }).toEqual({ name: navyPublished.name, hex: navyPublished.hex });
  });
});

describe("selectedColor", () => {
  const onSale = pageColors(published, offer);

  it("starts on the lead color", () => {
    expect(selectedColor(onSale, null, "101-001")?.key).toBe("true-navy");
  });

  it("follows a pick, and the buy box reads the same pick", () => {
    const picked = { cr: "101-001", key: "black" };
    const color = selectedColor(onSale, picked, "101-001");
    expect(color).toMatchObject({ key: "black", code: "BLACK" });
  });

  it("keeps a pick made before the offer loaded when it is still on sale", () => {
    const picked = { cr: "101-001", key: "black" };
    expect(selectedColor(published, picked, "101-001")?.key).toBe("black");
    expect(selectedColor(onSale, picked, "101-001")?.key).toBe("black");
  });

  it("falls back to the lead when the pick isn't sold or belongs to another work", () => {
    expect(selectedColor(onSale, { cr: "101-001", key: "chalky-mint" }, "101-001")?.key).toBe("true-navy");
    expect(selectedColor(onSale, { cr: "101-002", key: "black" }, "101-001")?.key).toBe("true-navy");
    expect(selectedColor([], null, "101-001")).toBeUndefined();
  });
});
