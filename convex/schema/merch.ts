import { defineTable } from "convex/server";
import { v } from "convex/values";

// Print-on-demand products an admin picked from a partner's catalog (convex/merch.ts), with each
// color's catalog name, swatch hex, and variant ids. The active one is the shirt the studio previews
// on and the publish dialog offers; its offered colors are the palette.
export const merchColor = v.object({
  key: v.string(),
  name: v.string(),
  hex: v.string(),
  // The catalog's variant ids by size, for ordering.
  variants: v.array(v.object({ size: v.string(), id: v.number() })),
  // A photo of the blank product in this color, from the catalog.
  image: v.optional(v.string()),
  inStock: v.boolean(),
  offered: v.boolean(),
});

// A print area in inches.
export const printAreaValidator = v.object({ widthIn: v.number(), heightIn: v.number() });
export const garmentKindValidator = v.union(
  v.literal("tee"),
  v.literal("longsleeve"),
  v.literal("sweatshirt"),
  v.literal("hoodie"),
  v.literal("tank"),
);
export const printSideValidator = v.union(v.literal("front"), v.literal("back"));
// Where a design sits on a garment (src/lib/print/shirtPlacement.ts): the side, its size as a share
// of the largest it fits, and how far down it sits as a share of the room left. Relative, so one
// choice fits every product. A back print may add a chest mark: the same design on the front, mark
// inches wide (the Chest marks switch, print.chestMarks).
export const relativePlacementValidator = v.object({
  side: printSideValidator,
  size: v.number(),
  drop: v.number(),
  mark: v.optional(v.number()),
});

export const merchTables = {
  merchProducts: defineTable({
    provider: v.literal("printful"),
    productId: v.number(),
    name: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    image: v.optional(v.string()),
    colors: v.array(merchColor),
    active: v.boolean(),
    fetchedAt: v.number(),
    addedBy: v.optional(v.id("users")),
    // On offer: creators can sell designs on it. The active product is the default one (its colors
    // are the palette and Publish starts with it); it's always on offer.
    offered: v.optional(v.boolean()),
    // What it is, for the drawn preview and the model photo. Absent: read from its name.
    kind: v.optional(garmentKindValidator),
    // How it sells (/admin/products); absent values use the defaults (convex/lib/shopProduct.ts): the
    // name buyers see, the price for S-XL and for 2XL, and what a back print adds.
    shopName: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    largePriceCents: v.optional(v.number()),
    backExtraCents: v.optional(v.number()),
    // Its print areas in inches. Absent: its kind's (shared/config/print-products.ts).
    frontArea: v.optional(printAreaValidator),
    backArea: v.optional(printAreaValidator),
    // The DTG placements Printful's catalog lists for it ("front", "back", "front_large"), with what
    // each adds to Printful's price. A product without "back" sells front prints only.
    placements: v.optional(v.array(v.object({ id: v.string(), extraCents: v.number() }))),
    // When frontArea and backArea were read from Printful's print files ("Check with Printful").
    areasCheckedAt: v.optional(v.number()),
  })
    .index("by_provider_product", ["provider", "productId"])
    .index("by_active", ["active"]),
};
