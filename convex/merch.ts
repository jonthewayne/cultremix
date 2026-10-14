import { ConvexError, v } from "convex/values";
import { garmentKindOf } from "../shared/config/print-products";
import { api, internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/adminAccess";
import { GARMENT_COLORS, colorDistance, colorKey, colorsByNearness, nearestGarmentColor } from "./lib/garments";
import { formatCr } from "./lib/r2";
import { areaFor, chosenProducts, merchShopProduct, offeredShopProducts } from "./lib/shopProduct";
import { garmentKindValidator, merchColor, printAreaValidator, relativePlacementValidator } from "./schema/merch";
import { createPrintful, printfulConfigFromEnv } from "./lib/printful/client";
import { areasFromPrintfiles } from "./lib/printful/setup";
import type { GarmentColor, Palette } from "./lib/garments";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Print-on-demand products (merchProducts): an admin searches Printful's public catalog, adds a
// product with its real colors and print placements, picks which colors are offered, puts products
// on offer, and sets how each sells (name, prices, back-print extra, print areas). Creators pick
// from the products on offer when publishing. The active product is the default one: its offered
// colors are the palette the studio previews on and the publish dialog offers
// (convex/lib/garments.ts takes it); without one, the launch shirt and colors stand in. Printful's
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

// The products on offer, the default first, for Publish and the work page.
export const offered = query({
  args: {},
  returns: v.array(
    v.object({
      productId: v.number(),
      key: v.string(),
      kind: garmentKindValidator,
      name: v.string(),
      detail: v.optional(v.string()),
      priceCents: v.number(),
      largePriceCents: v.number(),
      backExtraCents: v.number(),
      front: printAreaValidator,
      back: v.optional(printAreaValidator),
      colors: v.array(v.object({ key: v.string(), name: v.string(), hex: v.string() })),
      isDefault: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    return (await offeredShopProducts(ctx)).map((product) => ({
      productId: product.printfulProductId,
      key: product.key,
      kind: product.kind,
      name: product.name,
      ...(product.detail ? { detail: product.detail } : {}),
      priceCents: product.priceCents,
      largePriceCents: product.largePriceCents,
      backExtraCents: product.backExtraCents,
      front: product.front,
      ...(product.back ? { back: product.back } : {}),
      colors: product.colors.map(({ key, name, hex }) => ({ key, name, hex })),
      isDefault: product.isDefault,
    }));
  },
});

// What a published work comes on (the products its creator picked that are still on offer), for its
// page before it's on sale: each product's name, kind, side, and price with any back-print extra.
export const comesOn = query({
  args: { cr: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      kind: garmentKindValidator,
      side: v.union(v.literal("front"), v.literal("back")),
      priceCents: v.number(),
      placement: relativePlacementValidator,
      printArea: printAreaValidator,
      // The front print area, when a back print has a chest mark there.
      markArea: v.optional(printAreaValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const match = /^(\d{3})-(\d{3})$/u.exec(args.cr.trim());
    if (!match) return [];
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) => q.eq("crFamily", Number(match[1])).eq("crExpression", Number(match[2])))
      .unique();
    if (!work || work.status !== "published") return [];
    return chosenProducts(work, await offeredShopProducts(ctx)).map(({ product, placement }) => ({
      name: product.name,
      kind: product.kind,
      side: placement.side,
      priceCents: product.priceCents + (placement.side === "back" ? product.backExtraCents : 0),
      placement,
      printArea: areaFor(product, placement.side),
      ...(placement.side === "back" && placement.mark !== undefined ? { markArea: product.front } : {}),
    }));
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
  offered: v.boolean(),
  fetchedAt: v.number(),
  colors: v.array(v.object({ key: v.string(), name: v.string(), hex: v.string(), image: v.optional(v.string()), inStock: v.boolean(), offered: v.boolean(), sizes: v.array(v.string()) })),
  // How it sells, with the defaults filled in, and which of those the admin set.
  sale: v.object({
    kind: garmentKindValidator,
    name: v.string(),
    priceCents: v.number(),
    largePriceCents: v.number(),
    backExtraCents: v.number(),
    front: printAreaValidator,
    back: v.optional(printAreaValidator),
    custom: v.array(v.string()),
  }),
  // Printful's DTG placements for it, with what each adds to Printful's price.
  placements: v.optional(v.array(v.object({ id: v.string(), extraCents: v.number() }))),
  // When its print areas were read from Printful's print files.
  areasCheckedAt: v.optional(v.number()),
});

// Whether Printful's keys are in the env, so the page can offer "Check with Printful".
export const printfulReady = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    return printfulConfigFromEnv() !== null;
  },
});

// Reads a product's print areas from Printful's print files (it needs the store's token): the
// largest file on each placement, in inches at its DPI. A product Printful prints no back on is
// then sold front only.
export const adminCheckAreas = action({
  args: { productId: v.id("merchProducts") },
  returns: v.object({ front: v.union(v.null(), printAreaValidator), back: v.union(v.null(), printAreaValidator) }),
  handler: async (ctx, args): Promise<{ front: { widthIn: number; heightIn: number } | null; back: { widthIn: number; heightIn: number } | null }> => {
    await ctx.runQuery(internal.merch.checkAdmin, { level: "manage" });
    const config = printfulConfigFromEnv();
    if (!config) throw new ConvexError({ code: "NOT_CONFIGURED", message: "Set PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID first." });
    const product: { catalogId: number } | null = await ctx.runQuery(internal.merch.catalogIdOf, { productId: args.productId });
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "That product isn't here anymore." });
    let files;
    try {
      files = await createPrintful({ config }).printfiles(product.catalogId);
    } catch (error) {
      throw new ConvexError({ code: "PRINTFUL", message: `Printful didn't send the print files: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (!files) throw new ConvexError({ code: "PRINTFUL", message: "Printful has no print files for that product." });
    const areas = areasFromPrintfiles(files);
    if (!areas.front) throw new ConvexError({ code: "PRINTFUL", message: "Printful lists no front print file for that product." });
    await ctx.runMutation(internal.merch.saveCheckedAreas, {
      productId: args.productId,
      front: areas.front,
      ...(areas.back ? { back: areas.back } : {}),
      placements: areas.placements,
    });
    return { front: areas.front, back: areas.back };
  },
});

export const catalogIdOf = internalQuery({
  args: { productId: v.id("merchProducts") },
  returns: v.union(v.null(), v.object({ catalogId: v.number() })),
  handler: async (ctx, args) => {
    const product = await ctx.db.get("merchProducts", args.productId);
    return product ? { catalogId: product.productId } : null;
  },
});

export const saveCheckedAreas = internalMutation({
  args: { productId: v.id("merchProducts"), front: printAreaValidator, back: v.optional(printAreaValidator), placements: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const product = await ctx.db.get("merchProducts", args.productId);
    if (!product) return null;
    // Keep the catalog's extra prices; the print files say which placements the product really has.
    const extras = new Map((product.placements ?? []).map((placement) => [placement.id, placement.extraCents]));
    const placements = ["front", "back", "front_large"]
      .filter((id) => args.placements.includes(id))
      .map((id) => ({ id, extraCents: extras.get(id) ?? 0 }));
    await ctx.db.patch("merchProducts", product._id, {
      frontArea: args.front,
      backArea: args.back,
      placements,
      areasCheckedAt: Date.now(),
    });
    return null;
  },
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
        offered: p.active || Boolean(p.offered),
        fetchedAt: p.fetchedAt,
        colors: p.colors.map((c) => ({ key: c.key, name: c.name, hex: c.hex, image: c.image, inStock: c.inStock, offered: c.offered, sizes: c.variants.map((s) => s.size) })),
        sale: saleView(p),
        ...(p.placements ? { placements: p.placements } : {}),
        ...(p.areasCheckedAt ? { areasCheckedAt: p.areasCheckedAt } : {}),
      }));
  },
});

function saleView(product: Doc<"merchProducts">) {
  const shop = merchShopProduct(product);
  const custom = (["shopName", "kind", "priceCents", "largePriceCents", "backExtraCents", "frontArea", "backArea"] as const).filter(
    (field) => product[field] !== undefined,
  );
  return {
    kind: shop.kind,
    name: shop.name,
    priceCents: shop.priceCents,
    largePriceCents: shop.largePriceCents,
    backExtraCents: shop.backExtraCents,
    front: shop.front,
    ...(shop.back ? { back: shop.back } : {}),
    custom: [...custom],
  };
}

// The DTG placements CultRemix can print, from a catalog product's file types.
const DTG_PLACEMENTS = new Set(["front", "back", "front_large"]);

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
        product: {
          id: number;
          title: string;
          brand?: string;
          model?: string;
          image?: string;
          files?: Array<{ type?: string; additional_price?: string | null }>;
        };
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
    const placements = (result.product.files ?? [])
      .filter((file) => file.type && DTG_PLACEMENTS.has(file.type))
      .map((file) => ({ id: file.type!, extraCents: Math.round(Number(file.additional_price ?? 0) * 100) || 0 }));
    await ctx.runMutation(internal.merch.saveProduct, {
      productId: result.product.id,
      name: result.product.title,
      brand: result.product.brand,
      model: result.product.model,
      image: result.product.image,
      colors,
      placements,
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

type ProductCosts = { productId: number; sizes: Array<{ size: string; cents: number }> };

// Admin, Brands: what Printful charges for each product on offer, by size (the highest across its
// colors), from its public catalog. A product the catalog didn't answer for comes back with no sizes.
export const adminCosts = action({
  args: {},
  returns: v.array(v.object({ productId: v.number(), sizes: v.array(v.object({ size: v.string(), cents: v.number() })) })),
  handler: async (ctx): Promise<Array<ProductCosts>> => {
    await ctx.runQuery(internal.merch.checkAdmin, { level: "view" });
    const products: Array<{ productId: number }> = await ctx.runQuery(api.merch.offered, {});
    return await Promise.all(
      products.map(async ({ productId }): Promise<ProductCosts> => {
        try {
          const response = await fetch(`${PRINTFUL}/products/${productId}`, { signal: AbortSignal.timeout(FETCH_MS) });
          if (!response.ok) return { productId, sizes: [] };
          const data = (await response.json()) as { result?: { variants?: Array<{ size?: string; price?: string }> } };
          const most = new Map<string, number>();
          for (const variant of data.result?.variants ?? []) {
            const cents = Math.round(Number(variant.price) * 100);
            if (!variant.size || !Number.isFinite(cents) || cents <= 0) continue;
            most.set(variant.size, Math.max(most.get(variant.size) ?? 0, cents));
          }
          return { productId, sizes: [...most].map(([size, cents]) => ({ size, cents })) };
        } catch {
          return { productId, sizes: [] };
        }
      }),
    );
  },
});

export const saveProduct = internalMutation({
  args: {
    productId: v.number(),
    name: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    image: v.optional(v.string()),
    colors: v.array(merchColor),
    placements: v.optional(v.array(v.object({ id: v.string(), extraCents: v.number() }))),
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
      await ctx.db.patch("merchProducts", existing._id, {
        name: args.name,
        brand: args.brand,
        model: args.model,
        image: args.image,
        colors,
        ...(args.placements ? { placements: args.placements } : {}),
        fetchedAt: now,
      });
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
        offered: false,
        kind: garmentKindOf(args.name),
        ...(args.placements ? { placements: args.placements } : {}),
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

// How many colors a design gets when it's given the active shirt's colors, how close each has to be
// to the design's background (Lab distance) so the art keeps its contrast, and how far apart two
// picks have to be so a design isn't offered five shades of cream.
const BACKFILL_COLOR_COUNT = 5;
const BACKFILL_RADIUS = 50;
const BACKFILL_DISTINCT = 12;

// Gives published designs the active shirt's colors (October 13, 2026, when the 3001 went from 6
// colors to 20). A design published before creators chose colors, or with colors the shirt doesn't
// come in, keeps the ones it has, swaps each missing one for the shirt's nearest color, and fills to
// five with distinct colors near its own background, so it keeps its look and its contrast.
// Approving each design again (sales.approve) puts the colors on its Shopify product.
export const backfillOfferedColors = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.array(
    v.object({ workId: v.id("works"), cr: v.string(), from: v.union(v.null(), v.array(v.string())), to: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const { product, colors: palette } = await activePalette(ctx);
    if (!product) return [];
    const known = new Set(palette.map((color) => color.key));
    const lookup = await colorLookup(ctx);
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .take(500);
    const out: Array<{ workId: Doc<"works">["_id"]; cr: string; from: Array<string> | null; to: Array<string> }> = [];
    for (const work of works) {
      const current = work.offeredColors ?? [];
      if (current.length > 0 && current.every((key) => known.has(key))) continue;
      const keys: Array<string> = [];
      const hexOf = (key: string) => palette.find((color) => color.key === key)?.hex ?? "";
      const add = (key: string) => {
        if (known.has(key) && !keys.includes(key)) keys.push(key);
      };
      for (const key of current) {
        const old = lookup.get(key);
        add(known.has(key) || !old ? key : nearestGarmentColor(old.hex, palette).key);
      }
      const nearest = colorsByNearness(work.backgroundColor, palette);
      for (const color of nearest) {
        if (keys.length >= BACKFILL_COLOR_COUNT || colorDistance(work.backgroundColor, color.hex) > BACKFILL_RADIUS) break;
        if (keys.every((key) => colorDistance(hexOf(key), color.hex) >= BACKFILL_DISTINCT)) add(color.key);
      }
      if (keys.length === 0 && nearest.length > 0) add(nearest[0].key);
      out.push({ workId: work._id, cr: formatCr(work.crFamily, work.crExpression), from: work.offeredColors ?? null, to: keys });
      if (!args.dryRun) await ctx.db.patch("works", work._id, { offeredColors: keys });
    }
    return out;
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
    // The default stays on offer when another becomes the default.
    for (const row of await ctx.db.query("merchProducts").withIndex("by_active", (q) => q.eq("active", true)).collect()) {
      if (row._id !== args.productId) await ctx.db.patch("merchProducts", row._id, { active: false, offered: true });
    }
    if (args.productId) await ctx.db.patch("merchProducts", args.productId, { active: true, offered: true });
    return null;
  },
});

// Puts a product on offer to creators, or takes it off. Works already on sale keep selling it until
// they're approved again.
export const adminSetOffered = mutation({
  args: { productId: v.id("merchProducts"), offered: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const product = await ctx.db.get("merchProducts", args.productId);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "That product isn't here anymore." });
    if (!args.offered && product.active) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Make another product the default first." });
    }
    if (args.offered && !product.colors.some((c) => c.offered)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Pick at least one color first." });
    }
    await ctx.db.patch("merchProducts", product._id, { offered: args.offered });
    return null;
  },
});

const MIN_PRICE_CENTS = 500;
const MAX_PRICE_CENTS = 50_000;

function checkedArea(area: { widthIn: number; heightIn: number } | undefined, label: string) {
  if (!area) return undefined;
  const ok = (n: number) => Number.isFinite(n) && n >= 2 && n <= 30;
  if (!ok(area.widthIn) || !ok(area.heightIn)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: `The ${label} print area should be 2 to 30 inches each way.` });
  }
  return { widthIn: Math.round(area.widthIn * 100) / 100, heightIn: Math.round(area.heightIn * 100) / 100 };
}

// How a product sells: the name buyers see, prices (S-XL and 2XL), what a back print adds, its kind,
// and its print areas. A field left out goes back to its default.
export const adminSetSale = mutation({
  args: {
    productId: v.id("merchProducts"),
    shopName: v.optional(v.string()),
    kind: v.optional(garmentKindValidator),
    priceCents: v.optional(v.number()),
    largePriceCents: v.optional(v.number()),
    backExtraCents: v.optional(v.number()),
    frontArea: v.optional(printAreaValidator),
    backArea: v.optional(printAreaValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const product = await ctx.db.get("merchProducts", args.productId);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "That product isn't here anymore." });
    const price = (cents: number | undefined, label: string) => {
      if (cents === undefined) return undefined;
      if (!Number.isInteger(cents) || cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) {
        throw new ConvexError({ code: "INVALID_INPUT", message: `${label} should be between $5 and $500.` });
      }
      return cents;
    };
    const priceCents = price(args.priceCents, "The price");
    const largePriceCents = price(args.largePriceCents, "The 2XL price");
    if (priceCents !== undefined && largePriceCents !== undefined && largePriceCents < priceCents) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "The 2XL price can't be lower than the price." });
    }
    const backExtraCents = args.backExtraCents;
    if (backExtraCents !== undefined && (!Number.isInteger(backExtraCents) || backExtraCents < 0 || backExtraCents > 5_000)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "A back print can add $0 to $50." });
    }
    const shopName = args.shopName?.trim().slice(0, 60) || undefined;
    const frontArea = checkedArea(args.frontArea, "front");
    const backArea = checkedArea(args.backArea, "back");
    const same = (a?: { widthIn: number; heightIn: number }, b?: { widthIn: number; heightIn: number }) =>
      a?.widthIn === b?.widthIn && a?.heightIn === b?.heightIn;
    // Areas typed in by hand are no longer the ones Printful's print files gave.
    const keepsChecked = same(frontArea, product.frontArea) && same(backArea, product.backArea);
    await ctx.db.patch("merchProducts", product._id, {
      shopName,
      kind: args.kind,
      priceCents,
      largePriceCents,
      backExtraCents,
      frontArea,
      backArea,
      ...(keepsChecked ? {} : { areasCheckedAt: undefined }),
    });
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
