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
  })
    .index("by_provider_product", ["provider", "productId"])
    .index("by_active", ["active"]),
};

