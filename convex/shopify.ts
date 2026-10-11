import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { createShopifyAdmin, shopifyAdminConfigFromEnv, type FetchLike } from "./lib/shopify/adminClient";
import { crNumber, syncProduct } from "./lib/shopify/productSync";
import { commerceOpen } from "./lib/shopFlags";
import { listingsOf } from "./lib/shopProduct";
import { publicUrl } from "./lib/r2";
import { PRINT_SIZES } from "../shared/config/print-products";
import { garmentKindValidator, printSideValidator } from "./schema/merch";
import { listingValidator } from "./schema/shop";

// Shopify products for works on sale (V1 U9). An admin approves a work (convex/sales.ts); each of its
// listings (the work on one product) becomes one Shopify product by productSet on its handle, then
// workVariants rows map every Shopify variant back to the work, listing, color, and size.

// ---- Admin API token cache (internal only: the token is a secret) ----

export const getToken = internalQuery({
  args: { shopDomain: v.string() },
  returns: v.union(v.null(), v.object({ accessToken: v.string(), expiresAt: v.number() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("shopifyTokens")
      .withIndex("by_shop", (q) => q.eq("shopDomain", args.shopDomain))
      .unique();
    return row ? { accessToken: row.accessToken, expiresAt: row.expiresAt } : null;
  },
});

export const saveToken = internalMutation({
  args: { shopDomain: v.string(), accessToken: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("shopifyTokens")
      .withIndex("by_shop", (q) => q.eq("shopDomain", args.shopDomain))
      .unique();
    const next = { accessToken: args.accessToken, expiresAt: args.expiresAt, updatedAt: Date.now() };
    if (row) await ctx.db.patch("shopifyTokens", row._id, next);
    else await ctx.db.insert("shopifyTokens", { shopDomain: args.shopDomain, ...next });
    return null;
  },
});

// The Admin client for an action, with the token cached in shopifyTokens. Null when the
// Shopify env vars are not set (everything then waits instead of failing).
export function shopifyAdminForAction(ctx: ActionCtx, fetchImpl?: FetchLike) {
  const config = shopifyAdminConfigFromEnv();
  if (!config) return null;
  return createShopifyAdmin({
    config,
    fetch: fetchImpl,
    tokenStore: {
      get: () => ctx.runQuery(internal.shopify.getToken, { shopDomain: config.shopDomain }),
      set: async (token) => {
        await ctx.runMutation(internal.shopify.saveToken, { shopDomain: config.shopDomain, ...token });
      },
    },
  });
}

// ---- Product sync ----

const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1000;

export function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

// What a listing's Shopify product is made from. Null when it isn't ready to sync (paused, still
// preparing, or its work isn't public).
export const listingForSync = internalQuery({
  args: { listingId: v.id("shopProducts") },
  returns: v.union(
    v.null(),
    v.object({
      workId: v.id("works"),
      cr: v.string(),
      title: v.optional(v.string()),
      imageUrls: v.array(v.string()),
      listing: listingValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row?.listing || !row.printFile || row.status === "paused" || row.status === "preparing") return null;
    const work = await ctx.db.get("works", row.workId);
    if (!work || work.status !== "published") return null;
    const keys: Array<string | undefined> = [work.artKey];
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .order("desc")
      .first();
    if (photo?.state === "succeeded") keys.push(photo.publicKey);
    const imageUrls = keys
      .map((key) => publicUrl(key))
      .filter((url): url is string => typeof url === "string" && /^https:\/\//u.test(url));
    return { workId: work._id, cr: crNumber(work.crFamily, work.crExpression), title: work.title, imageUrls, listing: row.listing };
  },
});

const syncedVariant = v.object({
  color: v.string(),
  size: v.string(),
  sku: v.string(),
  priceCents: v.number(),
  printfulVariantId: v.union(v.number(), v.null()),
  shopifyVariantId: v.string(),
});

export const saveSynced = internalMutation({
  args: { listingId: v.id("shopProducts"), productId: v.string(), variants: v.array(syncedVariant) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row) return null;
    const existing = await ctx.db
      .query("workVariants")
      .withIndex("by_work", (q) => q.eq("workId", row.workId))
      .take(500);
    for (const variant of args.variants) {
      const match = existing.find((r) => r.sku === variant.sku);
      const fields = {
        workId: row.workId,
        listingId: row._id,
        ...(row.productKey ? { productKey: row.productKey } : {}),
        shopifyVariantId: variant.shopifyVariantId,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        priceCents: variant.priceCents,
        ...(variant.printfulVariantId === null ? {} : { printfulVariantId: variant.printfulVariantId }),
      };
      if (match) await ctx.db.replace("workVariants", match._id, fields);
      else await ctx.db.insert("workVariants", fields);
    }
    const now = Date.now();
    // Paused while it synced: it stays paused, with its product id kept.
    await ctx.db.patch("shopProducts", row._id, {
      ...(row.status === "paused" ? {} : { status: "live" as const }),
      shopifyProductId: args.productId,
      lastError: undefined,
      nextAttemptAt: undefined,
      syncedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const syncFailed = internalMutation({
  args: { listingId: v.id("shopProducts"), error: v.string(), countAttempt: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row) return null;
    const now = Date.now();
    // A live product stays on sale; a paused one stays paused. Both keep the error to show.
    if (row.status === "live" || row.status === "paused" || row.status === "preparing") {
      await ctx.db.patch("shopProducts", row._id, { lastError: args.error.slice(0, 500), updatedAt: now });
      return null;
    }
    const attempts = row.attempts + (args.countAttempt ? 1 : 0);
    await ctx.db.patch("shopProducts", row._id, {
      status: args.countAttempt ? "failed" : "pending",
      attempts,
      lastError: args.error.slice(0, 500),
      nextAttemptAt: now + (args.countAttempt ? retryDelay(attempts) : NOT_CONFIGURED_RETRY_MS),
      updatedAt: now,
    });
    return null;
  },
});

export const syncListing = internalAction({
  args: { listingId: v.id("shopProducts") },
  returns: v.union(v.literal("live"), v.literal("skipped"), v.literal("failed")),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.shopify.listingForSync, args);
    if (!job) return "skipped";
    if (job.listing.colors.length === 0) {
      await ctx.runMutation(internal.shopify.syncFailed, {
        listingId: args.listingId,
        error: "None of this design's colors come in this product.",
        countAttempt: true,
      });
      return "failed";
    }
    const admin = shopifyAdminForAction(ctx);
    if (!admin) {
      await ctx.runMutation(internal.shopify.syncFailed, {
        listingId: args.listingId,
        error: "Shopify is not configured yet.",
        countAttempt: false,
      });
      return "skipped";
    }
    try {
      const result = await syncProduct(admin, {
        workId: job.workId,
        cr: job.cr,
        title: job.title,
        imageUrls: job.imageUrls,
        listing: job.listing,
      });
      await ctx.runMutation(internal.shopify.saveSynced, {
        listingId: args.listingId,
        productId: result.productId,
        variants: result.variants.map((variant) => ({
          color: variant.color,
          size: variant.size,
          sku: variant.sku,
          priceCents: variant.priceCents,
          printfulVariantId: variant.printfulVariantId,
          shopifyVariantId: variant.shopifyVariantId,
        })),
      });
      return "live";
    } catch (error) {
      await ctx.runMutation(internal.shopify.syncFailed, {
        listingId: args.listingId,
        error: error instanceof Error ? error.message : String(error),
        countAttempt: true,
      });
      return "failed";
    }
  },
});

// Cron: retries listings whose sync is due (failed with backoff, or waiting for configuration).
// Runs while checkout is off too, so approved works reach the store before buying opens.
export const retryDueProducts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const status of ["pending", "failed"] as const) {
      const due = await ctx.db
        .query("shopProducts")
        .withIndex("by_status_next", (q) => q.eq("status", status).lte("nextAttemptAt", now))
        .take(10);
      for (const row of due) {
        if (!row.listing) {
          // A row from before products could be chosen: approving its work again replaces it.
          await ctx.db.patch("shopProducts", row._id, { nextAttemptAt: undefined });
          continue;
        }
        await ctx.db.patch("shopProducts", row._id, { nextAttemptAt: now + NOT_CONFIGURED_RETRY_MS });
        await ctx.scheduler.runAfter(0, internal.shopify.syncListing, { listingId: row._id });
        scheduled++;
      }
    }
    return scheduled;
  },
});

// ---- Public: what the work page offers ----

const offerProductValidator = v.object({
  key: v.string(),
  name: v.string(),
  kind: garmentKindValidator,
  side: printSideValidator,
  // key is the garment color key (works.offeredColors), so the page's swatches and the buy box
  // share one selection; code is the SKU code the cart sends.
  colors: v.array(v.object({ key: v.string(), code: v.string(), name: v.string(), hex: v.string() })),
  sizes: v.array(v.string()),
  variants: v.array(v.object({ color: v.string(), size: v.string(), merchandiseId: v.string(), priceCents: v.number() })),
});

const offerValidator = v.object({
  workId: v.id("works"),
  cr: v.string(),
  products: v.array(offerProductValidator),
});

// Null while checkout is off or nothing of the work is on sale yet; the page then stays as it was.
export const offer = query({
  args: { cr: v.string() },
  returns: v.union(v.null(), offerValidator),
  handler: async (ctx, args) => {
    if (!(await commerceOpen(ctx))) return null;
    const match = /^(\d{3})-(\d{3})$/u.exec(args.cr.trim());
    if (!match) return null;
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) => q.eq("crFamily", Number(match[1])).eq("crExpression", Number(match[2])))
      .unique();
    if (!work || work.status !== "published") return null;
    const rows = (await listingsOf(ctx, work._id)).filter((row) => row.status === "live" && row.listing);
    if (rows.length === 0) return null;
    const variants = await ctx.db
      .query("workVariants")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .take(500);
    const products = [];
    for (const row of rows) {
      const listing = row.listing!;
      // Only the listing's colors are sold: rows for any other color (kept so old orders still
      // resolve) are never offered, so the cart refuses them.
      const mine = variants.filter((variant) => variant.listingId === row._id);
      const colors = listing.colors.filter((color) => mine.some((variant) => variant.color === color.code));
      const sold = mine.filter((variant) => colors.some((color) => color.code === variant.color));
      if (sold.length === 0) continue;
      products.push({
        key: listing.productKey,
        name: listing.name,
        kind: listing.kind,
        side: listing.placement.side,
        colors: colors.map(({ key, code, name, hex }) => ({ key, code, name, hex })),
        sizes: PRINT_SIZES.filter((size) => sold.some((variant) => variant.size === size)),
        variants: sold.map((variant) => ({
          color: variant.color,
          size: variant.size,
          merchandiseId: variant.shopifyVariantId,
          priceCents: variant.priceCents,
        })),
      });
    }
    if (products.length === 0) return null;
    return { workId: work._id, cr: crNumber(work.crFamily, work.crExpression), products };
  },
});

