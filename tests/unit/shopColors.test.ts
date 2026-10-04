import { describe, expect, it } from "vitest";
import { GARMENT_COLORS } from "../../convex/lib/garments";
import { catalogColorByCode, catalogColorFor, sellableColors } from "../../convex/lib/shopColors";
import { PRINT_COLORS, PRINT_PRODUCT } from "../../shared/config/print-products";

describe("catalogColorFor", () => {
  it("maps every garment color the print catalog carries, and only those", () => {
    const mapped = Object.fromEntries(GARMENT_COLORS.map((g) => [g.key, catalogColorFor(g.key)?.code ?? null]));
    expect(mapped).toEqual({
      white: "WHITE",
      ivory: "IVORY",
      butter: "BUTTER",
      "chalky-mint": null,
      bay: null,
      watermelon: null,
      "blue-jean": "BLUEJEAN",
      moss: null,
      crimson: null,
      pepper: "PEPPER",
      "true-navy": "TRUENAVY",
      black: "BLACK",
    });
  });

  it("keeps the garment's name and swatch with the catalog's Printful variants", () => {
    const navy = catalogColorFor("true-navy")!;
    const catalog = PRINT_PRODUCT.colors.find((c) => c.name === "True Navy")!;
    expect(navy).toEqual({
      key: "true-navy",
      code: "TRUENAVY",
      name: "True navy",
      hex: "#2c3447",
      printfulVariantIds: catalog.variants,
    });
  });

  it("matches the launch colors' codes and variants", () => {
    for (const launch of PRINT_COLORS) {
      const color = catalogColorFor(launch.name.toLowerCase())!;
      expect(color.code).toBe(launch.code);
      expect(color.printfulVariantIds).toEqual(launch.printfulVariantIds);
    }
  });

  it("returns null for unknown keys", () => {
    expect(catalogColorFor("lavender")).toBeNull();
    expect(catalogColorFor("")).toBeNull();
  });
});

describe("sellableColors", () => {
  it("falls back to the launch colors when a work has none", () => {
    expect(sellableColors(undefined).map((c) => c.code)).toEqual(PRINT_COLORS.map((c) => c.code));
    expect(sellableColors([]).map((c) => c.key)).toEqual(["white", "ivory", "pepper", "black"]);
  });

  it("keeps the offered order, lead first, dropping unprintable colors and repeats", () => {
    expect(sellableColors(["butter", "moss", "black", "butter", "true-navy"]).map((c) => c.key)).toEqual([
      "butter",
      "black",
      "true-navy",
    ]);
  });

  it("is empty when nothing offered can be printed, rather than switching to other colors", () => {
    expect(sellableColors(["moss", "crimson"])).toEqual([]);
  });
});

describe("catalogColorByCode", () => {
  it("finds any catalog color, not only the launch four", () => {
    expect(catalogColorByCode("SEAFOAM")?.printfulVariantIds.M).toBe(16530);
    expect(catalogColorByCode("LAVENDER")).toBeNull();
  });
});
