import {
  BACK_EXTRA_CENTS,
  BASE_PRICE_CENTS,
  GARMENT_KINDS,
  LARGE_PRICE_CENTS,
  PRINT_PRODUCT,
  PRINT_SIZES,
  garmentKindOf,
} from "../../shared/config/print-products";
import { DEFAULT_PLACEMENT, clampRelative } from "../../src/lib/print/shirtPlacement";
import { GARMENT_COLORS, colorKey } from "./garments";
import { colorCode } from "./shopColors";
import { productHandle } from "./shopify/productSync";
import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { GarmentKind, PrintGeometry } from "../../shared/config/print-products";
import type { PrintArea, PrintSide, RelativePlacement } from "../../src/lib/print/shirtPlacement";
import type { listingValidator } from "../schema/shop";

// The products a work can sell on: the products on offer in /admin/products (convex/merch.ts), with
// the prices and print areas set there, or the launch shirt while none is on offer. A creator picks
// some of them when publishing and places the design once (src/lib/print/shirtPlacement.ts).
// Approving the work for sale fixes a copy of each on its shopProducts rows (their listings), so later
// product changes leave works already on sale alone.

type Ctx = QueryCtx | MutationCtx;
export type Listing = Infer<typeof listingValidator>;
export type ListingColor = Listing["colors"][number];

export const SAFE_INSET_IN = 0.5;
export const PRINT_DPI = 300;
// Works published before colors were chosen sell in these, when the product has them.
const LAUNCH_KEYS = ["white", "ivory", "pepper", "black"];

export type ShopProduct = {
  merchProductId?: Id<"merchProducts">;
  printfulProductId: number;
  // "printful-<id>".
  key: string;
  kind: GarmentKind;
  name: string;
  detail?: string;
  priceCents: number;
  largePriceCents: number;
  backExtraCents: number;
  front: PrintArea;
  // Absent: it sells front prints only.
  back?: PrintArea;
  colors: Array<ListingColor>;
  // The default product: its colors are the palette, and Publish starts with it.
  isDefault: boolean;
  // False for the launch shirt, which stands in until a product is on offer.
  fromAdmin: boolean;
};

export function productKeyOf(printfulProductId: number) {
  return `printful-${printfulProductId}`;
}

export function launchShopProduct(): ShopProduct {
  const preview = new Map(GARMENT_COLORS.map((color) => [color.key, color.hex]));
  return {
    printfulProductId: PRINT_PRODUCT.printful.productId,
    key: productKeyOf(PRINT_PRODUCT.printful.productId),
    kind: "tee",
    name: PRINT_PRODUCT.name,
    detail: "Comfort Colors 1717",
    priceCents: BASE_PRICE_CENTS,
    largePriceCents: LARGE_PRICE_CENTS,
    backExtraCents: BACK_EXTRA_CENTS,
    front: PRINT_PRODUCT.printArea,
    back: GARMENT_KINDS.tee.back,
    colors: PRINT_PRODUCT.colors.map((color) => {
      const key = colorKey(color.name);
      return {
        key,
        code: colorCode(color.name),
        name: color.name,
        hex: preview.get(key) ?? color.hex,
        variants: PRINT_SIZES.map((size) => ({ size, id: color.variants[size] })),
      };
    }),
    isDefault: true,
    fromAdmin: false,
  };
}

// "Unisex Staple T-Shirt | Bella + Canvas 3001" reads as "Staple T-Shirt".
export function shortName(name: string) {
  const short = name.split("|")[0]?.trim() || name;
  return short.replace(/^unisex\s+/iu, "") || short;
}

// A back print's extra: the admin's, else Printful's catalog extra rounded up to a whole dollar.
function backExtraOf(product: Doc<"merchProducts">) {
  if (product.backExtraCents !== undefined) return product.backExtraCents;
  const catalog = product.placements?.find((placement) => placement.id === "back")?.extraCents;
  return catalog !== undefined ? Math.ceil(catalog / 100) * 100 : BACK_EXTRA_CENTS;
}

export function merchShopProduct(product: Doc<"merchProducts">): ShopProduct {
  const kind = product.kind ?? garmentKindOf(product.name);
  const defaults = GARMENT_KINDS[kind];
  const sizes = new Set<string>(PRINT_SIZES);
  const colors = product.colors
    .filter((color) => color.offered && color.inStock)
    .map((color) => ({
      key: color.key,
      code: colorCode(color.name),
      name: color.name,
      hex: color.hex,
      variants: color.variants.filter((variant) => sizes.has(variant.size)).map(({ size, id }) => ({ size, id })),
    }))
    .filter((color) => color.variants.length > 0);
  // Products added before placements were read can print on the back.
  const hasBack = !product.placements || product.placements.some((placement) => placement.id === "back");
  return {
    merchProductId: product._id,
    printfulProductId: product.productId,
    key: productKeyOf(product.productId),
    kind,
    name: product.shopName?.trim() || shortName(product.name),
    detail: [product.brand, product.model].filter(Boolean).join(" ") || undefined,
    priceCents: product.priceCents ?? defaults.priceCents,
    largePriceCents: product.largePriceCents ?? defaults.largePriceCents,
    backExtraCents: backExtraOf(product),
    front: product.frontArea ?? defaults.front,
    ...(hasBack ? { back: product.backArea ?? defaults.back } : {}),
    colors,
    isDefault: product.active,
    fromAdmin: true,
  };
}

// The products on offer, the default first. The launch shirt stands in when none offers an
// orderable color.
export async function offeredShopProducts(ctx: Ctx): Promise<Array<ShopProduct>> {
  const rows = await ctx.db.query("merchProducts").take(50);
  const offered = rows
    .filter((row) => row.active || row.offered)
    .map(merchShopProduct)
    .filter((product) => product.colors.length > 0)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.priceCents - b.priceCents);
  if (offered.length === 0) return [launchShopProduct()];
  if (!offered[0].isDefault) offered[0] = { ...offered[0], isDefault: true };
  return offered;
}

export async function defaultShopProduct(ctx: Ctx): Promise<ShopProduct> {
  return (await offeredShopProducts(ctx))[0];
}

// The print area on a side (front when the product has no back).
export function areaFor(product: { front: PrintArea; back?: PrintArea }, side: PrintSide): PrintArea {
  return side === "back" && product.back ? product.back : product.front;
}

export function geometryOf(key: string, area: PrintArea): PrintGeometry {
  return { key, printArea: area, safeInsetIn: SAFE_INSET_IN, dpi: PRINT_DPI };
}

export function listingGeometry(listing: Listing): PrintGeometry {
  return geometryOf(`${listing.productKey}-${listing.placement.side}`, listing.printArea);
}

export type ProductChoice = { product: ShopProduct; placement: RelativePlacement };

// The products a work sells on that are still on offer, each with its placement (its own when its
// creator adjusted it, else the work's). Works published before products could be chosen sell on
// the default product. A back placement on a product without a back prints on the front.
export function chosenProducts(
  work: Pick<Doc<"works">, "printPlacement" | "printProducts">,
  products: ReadonlyArray<ShopProduct>,
): Array<ProductChoice> {
  const shared = clampRelative(work.printPlacement ?? DEFAULT_PLACEMENT);
  const picks =
    work.printProducts && work.printProducts.length > 0
      ? work.printProducts
      : products.length > 0
        ? [{ productId: products[0].printfulProductId, placement: undefined }]
        : [];
  const out: Array<ProductChoice> = [];
  for (const pick of picks) {
    const product = products.find((p) => p.printfulProductId === pick.productId);
    if (!product || out.some((choice) => choice.product.key === product.key)) continue;
    const placement = clampRelative(pick.placement ?? shared);
    out.push({ product, placement: placement.side === "back" && !product.back ? { ...placement, side: "front" } : placement });
  }
  return out;
}

// The colors a work sells in on a product: its offered colors the product carries, in the creator's
// order. A work published before colors were chosen sells in the launch colors the product has, or
// its first four colors. A work whose colors the product lacks gets none: it isn't quietly moved to
// colors its creator didn't pick.
export function listingColors(offered: ReadonlyArray<string> | undefined, product: Pick<ShopProduct, "colors">): Array<ListingColor> {
  const byKey = new Map(product.colors.map((color) => [color.key, color]));
  const chose = Boolean(offered && offered.length > 0);
  const out: Array<ListingColor> = [];
  for (const key of chose ? offered! : LAUNCH_KEYS) {
    const color = byKey.get(key);
    if (color && !out.some((c) => c.code === color.code)) out.push(color);
  }
  if (out.length === 0 && !chose) return product.colors.slice(0, 4);
  return out;
}

export function listingFor(work: Pick<Doc<"works">, "offeredColors">, product: ShopProduct, placement: RelativePlacement): Listing {
  const extra = placement.side === "back" ? product.backExtraCents : 0;
  return {
    ...(product.merchProductId ? { merchProductId: product.merchProductId } : {}),
    printfulProductId: product.printfulProductId,
    productKey: product.key,
    kind: product.kind,
    name: product.name,
    ...(product.detail ? { detail: product.detail } : {}),
    placement,
    printArea: areaFor(product, placement.side),
    priceCents: product.priceCents + extra,
    largePriceCents: product.largePriceCents + extra,
    colors: listingColors(work.offeredColors, product),
  };
}

export function priceForSize(prices: { priceCents: number; largePriceCents: number }, size: string) {
  return size === "2XL" ? prices.largePriceCents : prices.priceCents;
}

// A work's rows in shopProducts, one per product it's been approved on.
export async function listingsOf(ctx: Ctx, workId: Id<"works">) {
  return await ctx.db
    .query("shopProducts")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .take(20);
}

// Sharing a kept design with the world (publish.shareKeep) takes what it sold to its creator alone
// off sale: each listing pauses under the handle of its new public number, so an admin's approval
// makes public products, and the kept products' ids come back for archiving in Shopify. Their
// variant rows stay for the orders that used them; the offer only sells the current number's.
export async function retireKeptListings(ctx: MutationCtx, workId: Id<"works">, cr: string) {
  const now = Date.now();
  const productIds: Array<string> = [];
  for (const row of await listingsOf(ctx, workId)) {
    if (row.shopifyProductId) productIds.push(row.shopifyProductId);
    await ctx.db.patch("shopProducts", row._id, {
      status: "paused",
      handle: productHandle(cr, row.listing?.printfulProductId),
      shopifyProductId: undefined,
      nextAttemptAt: undefined,
      renderStartedAt: undefined,
      updatedAt: now,
    });
  }
  return productIds;
}

// What the Print Studio places for: the front of the first product the work sells on.
export async function printTargetForWork(ctx: Ctx, work: Pick<Doc<"works">, "printPlacement" | "printProducts">) {
  const products = await offeredShopProducts(ctx);
  const choice = chosenProducts(work, products)[0];
  const product = choice?.product ?? products[0];
  return {
    geometry: geometryOf(product.key, product.front),
    name: product.name,
    colors: product.colors.map(({ name, hex }) => ({ name, hex })),
    // Where its creator placed it on this product when publishing; null when it isn't one they chose.
    placement: choice ? choice.placement : null,
  };
}

