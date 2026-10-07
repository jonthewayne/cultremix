import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/adminAccess";
import { GARMENT_COLORS, colorKey } from "./lib/garments";
import type { GarmentColor, Palette } from "./lib/garments";
import { merchColor } from "./schema/merch";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Print-on-demand products (merchProducts): an admin searches Printful's public catalog, adds a
// product with its real colors, picks which colors are offered, and marks one product active. The
// active product's offered colors are the palette the studio previews on and the publish dialog
// offers (convex/lib/garments.ts takes it); without one, the launch colors stand in. Printful's
// catalog needs no account: GET https://api.printful.com/products and /products/<id>.

type Ctx = QueryCtx | MutationCtx;
const PRINTFUL = "https://api.printful.com";
const FETCH_MS = 15_000;
// The catalog categories worth offering: shirts, tanks, sweatshirts, and hoodies (Printful
// category ids under "Men's clothing", "Women's clothing", and "Kids' clothing").
const APPAREL_CATEGORIES = new Set([6, 7, 8, 9, 12, 23, 24, 25, 26, 28, 29, 30, 32, 33, 34, 36, 37, 38]);

// The palette: the active product's offered colors, in its catalog order, or the launch colors.
export async function activePalette(ctx: Ctx): Promise<{ product: Doc<"merchProducts"> | null; colors: Palette }> {
  const product = await ctx.db
    .query("merchProducts")
    .withIndex("by_active", (q) => q.eq("active", true))
    .first();
  const offered = product?.colors.filter((color) => color.offered) ?? [];
  if (!product || offered.length === 0) return { product: null, colors: GARMENT_COLORS };
  return { product, colors: offered.map(({ key, name, hex }) => ({ key, name, hex })) };
}

// Every color any product has had, for showing works published with an earlier palette.
export async function colorLookup(ctx: Ctx) {
  const map = new Map<string, GarmentColor>(GARMENT_COLORS.map((color) => [color.key, color]));
  for (const product of await ctx.db.query("merchProducts").take(50)) {
    for (const { key, name, hex } of product.colors) if (!map.has(key)) map.set(key, { key, name, hex });
  }
  const { colors } = await activePalette(ctx);
  for (const color of colors) map.set(color.key, color);
  return map;
}

// What the studio and the publish dialog offer.
export const palette = query({
  args: {},
  returns: v.object({
    product: v.union(v.null(), v.object({ name: v.string(), brand: v.optional(v.string()), model: v.optional(v.string()) })),
    colors: v.array(v.object({ key: v.string(), name: v.string(), hex: v.string() })),
  }),
  handler: async (ctx) => {
    const { product, colors } = await activePalette(ctx);
    return {
      product: product ? { name: product.name, brand: product.brand, model: product.model } : null,
      colors: colors.map(({ key, name, hex }) => ({ key, name, hex })),
    };
  },
});

// ---- Admin ----

const productView = v.object({
  _id: v.id("merchProducts"),
  productId: v.number(),
  name: v.string(),
  brand: v.optional(v.string()),
  model: v.optional(v.string()),
  image: v.optional(v.string()),
  active: v.boolean(),
  fetchedAt: v.number(),
  colors: v.array(v.object({ key: v.string(), name: v.string(), hex: v.string(), image: v.optional(v.string()), inStock: v.boolean(), offered: v.boolean(), sizes: v.array(v.string()) })),
});

export const adminList = query({
  args: {},
  returns: v.array(productView),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const products = await ctx.db.query("merchProducts").take(50);
    return products
      .sort((a, b) => Number(b.active) - Number(a.active) || b.fetchedAt - a.fetchedAt)
      .map((p) => ({
        _id: p._id,
        productId: p.productId,
        name: p.name,
        brand: p.brand,
        model: p.model,
        image: p.image,
        active: p.active,
        fetchedAt: p.fetchedAt,
        colors: p.colors.map((c) => ({ key: c.key, name: c.name, hex: c.hex, image: c.image, inStock: c.inStock, offered: c.offered, sizes: c.variants.map((s) => s.size) })),
      }));
  },
});

// Searches the catalog's apparel by words in the title, brand, or model ("1717", "comfort colors").
export const adminSearch = action({
  args: { words: v.string() },
  returns: v.array(v.object({ productId: v.number(), name: v.string(), brand: v.optional(v.string()), model: v.optional(v.string()), image: v.optional(v.string()), variants: v.number() })),
  handler: async (ctx, args): Promise<Array<{ productId: number; name: string; brand?: string; model?: string; image?: string; variants: number }>> => {
    await ctx.runQuery(internal.merch.checkAdmin, { level: "manage" });
    const words = args.words.toLowerCase().split(/\s+/u).filter(Boolean);
    const response = await fetch(`${PRINTFUL}/products`, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) throw new ConvexError({ code: "CATALOG", message: `Printful's catalog answered ${response.status}.` });
    const data = (await response.json()) as { result?: Array<{ id: number; title: string; brand?: string; model?: string; image?: string; variant_count?: number; main_category_id?: number; is_discontinued?: boolean }> };
    return (data.result ?? [])
      .filter((p) => !p.is_discontinued && APPAREL_CATEGORIES.has(p.main_category_id ?? 0))
      .filter((p) => {
        const text = `${p.title} ${p.brand ?? ""} ${p.model ?? ""}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 30)
      .map((p) => ({ productId: p.id, name: p.title, brand: p.brand, model: p.model, image: p.image, variants: p.variant_count ?? 0 }));
  },
});

// Adds a catalog product (or refreshes one already added) with its colors grouped from its
// variants. A new product's colors start offered when they match a color offered now.
export const adminAdd = action({
  args: { productId: v.number() },
  returns: v.object({ colors: v.number() }),
  handler: async (ctx, args): Promise<{ colors: number }> => {
    const userId = await ctx.runQuery(internal.merch.checkAdmin, { level: "manage" });
    const response = await fetch(`${PRINTFUL}/products/${args.productId}`, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) throw new ConvexError({ code: "CATALOG", message: `Printful's catalog answered ${response.status}.` });
    const data = (await response.json()) as {
      result?: {
        product: { id: number; title: string; brand?: string; model?: string; image?: string };
        variants: Array<{ id: number; size: string; color: string; color_code: string; image?: string; in_stock?: boolean }>;
      };
    };
    const result = data.result;
    if (!result) throw new ConvexError({ code: "CATALOG", message: "That product isn't in the catalog." });
    const byColor = new Map<string, { name: string; hex: string; image?: string; inStock: boolean; variants: Array<{ size: string; id: number }> }>();
    for (const variant of result.variants) {
      const key = colorKey(variant.color);
      if (!key || !/^#[0-9a-f]{6}$/iu.test(variant.color_code)) continue;
      const color = byColor.get(key) ?? { name: variant.color, hex: variant.color_code.toLowerCase(), image: variant.image, inStock: false, variants: [] };
      color.variants.push({ size: variant.size, id: variant.id });
      color.inStock = color.inStock || variant.in_stock !== false;
      byColor.set(key, color);
    }
    const colors = [...byColor].map(([key, c]) => ({ key, name: c.name, hex: c.hex, image: c.image, inStock: c.inStock, variants: c.variants, offered: false }));
    await ctx.runMutation(internal.merch.saveProduct, {
      productId: result.product.id,
      name: result.product.title,
      brand: result.product.brand,
      model: result.product.model,
      image: result.product.image,
      colors,
      addedBy: userId,
    });
    return { colors: colors.length };
  },
});

// For the actions above: the caller's admin check (their sign-in carries into runQuery).
export const checkAdmin = internalQuery({
  args: { level: v.union(v.literal("view"), v.literal("manage")) },
  returns: v.id("users"),
  handler: async (ctx, args) => (await requireAdmin(ctx, args.level))._id,
});

export const saveProduct = internalMutation({
  args: {
    productId: v.number(),
    name: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    image: v.optional(v.string()),
    colors: v.array(merchColor),
    addedBy: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("merchProducts")
      .withIndex("by_provider_product", (q) => q.eq("provider", "printful").eq("productId", args.productId))
      .unique();
    // Offered colors carry over: a refresh keeps the admin's choices, and a new product starts with
    // the colors offered now that it also comes in.
    const offeredNow = existing
      ? new Set(existing.colors.filter((c) => c.offered).map((c) => c.key))
      : new Set((await activePalette(ctx)).colors.map((c) => c.key));
    const colors = args.colors.map((color) => ({ ...color, offered: offeredNow.has(color.key) }));
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("merchProducts", existing._id, { name: args.name, brand: args.brand, model: args.model, image: args.image, colors, fetchedAt: now });
    } else {
      await ctx.db.insert("merchProducts", {
        provider: "printful",
        productId: args.productId,
        name: args.name,
        brand: args.brand,
        model: args.model,
        image: args.image,
        colors,
        active: false,
        fetchedAt: now,
        addedBy: args.addedBy,
      });
    }
    return null;
  },
});

// Picks which of a product's colors are offered.
export const adminSetColors = mutation({
  args: { productId: v.id("merchProducts"), offered: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const product = await ctx.db.get("merchProducts", args.productId);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "That product isn't here anymore." });
    const offered = new Set(args.offered);
    if (product.active && offered.size === 0) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "The active shirt needs at least one color." });
    }
    await ctx.db.patch("merchProducts", product._id, { colors: product.colors.map((c) => ({ ...c, offered: offered.has(c.key) })) });
    return null;
  },
});

// Makes a product the active shirt (or none, back to the launch colors).
export const adminSetActive = mutation({
  args: { productId: v.union(v.id("merchProducts"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    if (args.productId) {
      const product = await ctx.db.get("merchProducts", args.productId);
      if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "That product isn't here anymore." });
      if (!product.colors.some((c) => c.offered)) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "Pick at least one color first." });
      }
    }
    for (const row of await ctx.db.query("merchProducts").withIndex("by_active", (q) => q.eq("active", true)).collect()) {
      if (row._id !== args.productId) await ctx.db.patch("merchProducts", row._id, { active: false });
    }
    if (args.productId) await ctx.db.patch("merchProducts", args.productId, { active: true });
    return null;
  },
});

export const adminRemove = mutation({
  args: { productId: v.id("merchProducts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const product = await ctx.db.get("merchProducts", args.productId);
    if (!product) return null;
    if (product.active) throw new ConvexError({ code: "INVALID_INPUT", message: "Make another shirt active first." });
    await ctx.db.delete("merchProducts", product._id);
    return null;
  },
});
