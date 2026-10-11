import { describe, expect, it } from "vitest";
import { chosenProducts, launchShopProduct, listingColors, listingFor, merchShopProduct } from "../../convex/lib/shopProduct";
import { garmentKindOf } from "../../shared/config/print-products";
import { DEFAULT_PLACEMENT } from "../../src/lib/print/shirtPlacement";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const sizes = (base: number, list = ["XS", "S", "M", "L", "XL", "2XL", "3XL"]) => list.map((size, i) => ({ size, id: base + i }));

function hoodie(fields: Partial<Doc<"merchProducts">> = {}): Doc<"merchProducts"> {
  return {
    _id: "m1" as Id<"merchProducts">,
    _creationTime: 0,
    provider: "printful",
    productId: 146,
    name: "Unisex Heavy Blend Hoodie | Gildan 18500",
    brand: "Gildan",
    model: "18500",
    colors: [
      { key: "black", name: "Black", hex: "#000000", variants: sizes(100), inStock: true, offered: true },
      { key: "white", name: "White", hex: "#ffffff", variants: sizes(200), inStock: true, offered: true },
      { key: "maroon", name: "Maroon", hex: "#5b1a24", variants: sizes(300), inStock: true, offered: false },
      { key: "sand", name: "Sand", hex: "#d6c7a1", variants: sizes(400), inStock: false, offered: true },
    ],
    active: false,
    offered: true,
    placements: [
      { id: "front", extraCents: 0 },
      { id: "back", extraCents: 595 },
    ],
    fetchedAt: 0,
    ...fields,
  };
}

describe("a product from Admin, Products", () => {
  it("reads its kind and print areas, and prices a back print from Printful's extra", () => {
    const product = merchShopProduct(hoodie());
    expect(product).toMatchObject({
      key: "printful-146",
      kind: "hoodie",
      name: "Heavy Blend Hoodie",
      detail: "Gildan 18500",
      front: { widthIn: 14, heightIn: 14 },
      back: { widthIn: 12, heightIn: 16 },
      backExtraCents: 600,
      fromAdmin: true,
    });
  });

  it("sells only offered colors in stock, S through 2XL", () => {
    const product = merchShopProduct(hoodie());
    expect(product.colors.map((c) => c.key)).toEqual(["black", "white"]);
    expect(product.colors[0].variants.map((v) => v.size)).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(product.colors[0].code).toBe("BLACK");
  });

  it("uses what the admin set, and prints front only without a back placement", () => {
    const product = merchShopProduct(
      hoodie({
        shopName: "Heavy hoodie",
        priceCents: 5400,
        largePriceCents: 5800,
        backExtraCents: 0,
        frontArea: { widthIn: 13, heightIn: 12 },
        placements: [{ id: "front", extraCents: 0 }],
      }),
    );
    expect(product).toMatchObject({ name: "Heavy hoodie", priceCents: 5400, largePriceCents: 5800, backExtraCents: 0, front: { widthIn: 13, heightIn: 12 } });
    expect(product.back).toBeUndefined();
  });

  it("tells garments apart by name", () => {
    expect(garmentKindOf("Unisex Garment-Dyed Heavyweight T-Shirt | Comfort Colors 1717")).toBe("tee");
    expect(garmentKindOf("Unisex Heavy Blend Hoodie | Gildan 18500")).toBe("hoodie");
    expect(garmentKindOf("Unisex Crew Neck Sweatshirt | Gildan 18000")).toBe("sweatshirt");
    expect(garmentKindOf("Unisex Long Sleeve Tee | Bella + Canvas 3501")).toBe("longsleeve");
    expect(garmentKindOf("Unisex Jersey Tank | Bella + Canvas 3480")).toBe("tank");
  });
});

describe("what a work sells on", () => {
  const tee = launchShopProduct();
  const hood = merchShopProduct(hoodie({ placements: [{ id: "front", extraCents: 0 }] }));

  it("is its picks still on offer, each once, in order, with its own placement when set", () => {
    const work = {
      printPlacement: { side: "front" as const, size: 0.65, drop: 0.2 },
      printProducts: [
        { productId: 146, placement: { side: "back" as const, size: 0.9, drop: 0 } },
        { productId: 999 },
        { productId: 586 },
        { productId: 146 },
      ],
    };
    const chosen = chosenProducts(work, [tee, hood]);
    expect(chosen.map((c) => c.product.key)).toEqual(["printful-146", "printful-586"]);
    // The hoodie has no back placement, so its back print goes on the front.
    expect(chosen[0].placement).toEqual({ side: "front", size: 0.9, drop: 0 });
    expect(chosen[1].placement).toEqual({ side: "front", size: 0.65, drop: 0.2 });
  });

  it("is the default product for works published before products could be chosen", () => {
    const chosen = chosenProducts({ printPlacement: undefined, printProducts: undefined }, [tee, hood]);
    expect(chosen).toEqual([{ product: tee, placement: DEFAULT_PLACEMENT }]);
  });

  it("prices and places a back print", () => {
    const listing = listingFor({ offeredColors: ["black"] }, tee, { side: "back", size: 0.65, drop: 0.1 });
    expect(listing.priceCents).toBe(tee.priceCents + tee.backExtraCents);
    expect(listing.largePriceCents).toBe(tee.largePriceCents + tee.backExtraCents);
    expect(listing.printArea).toEqual(tee.back);
    expect(listing.colors.map((c) => c.key)).toEqual(["black"]);
  });

  it("sells in the creator's colors the product carries, never others", () => {
    expect(listingColors(["white", "maroon", "black"], hood).map((c) => c.key)).toEqual(["white", "black"]);
    expect(listingColors(["butter"], hood)).toEqual([]);
    expect(listingColors(undefined, tee).map((c) => c.key)).toEqual(["white", "ivory", "pepper", "black"]);
    expect(listingColors(undefined, hood).map((c) => c.key)).toEqual(["white", "black"]);
  });
});

