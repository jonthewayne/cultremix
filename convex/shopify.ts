import { v } from "convex/values";
import { PRINT_SIZES } from "../shared/config/print-products";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { createShopifyAdmin, shopifyAdminConfigFromEnv } from "./lib/shopify/adminClient";
import { archiveProduct, crNumber, setProductStatus, syncProduct, variantSku } from "./lib/shopify/productSync";
import { commerceOpen } from "./lib/shopFlags";
import { listingsOf } from "./lib/shopProduct";
import { notifyKeptReady } from "./lib/notifications";
import { publicUrl } from "./lib/r2";
import { garmentKindValidator, printAreaValidator, printSideValidator, relativePlacementValidator } from "./schema/merch";
import { listingValidator } from "./schema/shop";
import type { ProductStatus } from "./lib/shopify/productSync";
import type { FetchLike } from "./lib/shopify/adminClient";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";

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

const productStatusValidator = v.union(v.literal("ACTIVE"), v.literal("UNLISTED"), v.literal("DRAFT"), v.literal("ARCHIVED"));

// What a listing's Shopify product should be now, or null to leave it alone. Every product is a
// draft while checkout is off (so a cart made before it closed can't check out) and once its design
// is taken down; a live listing sells, unlisted for a kept design; a paused listing keeps what it has
// (pausing leaves Shopify alone, and resuming syncs it again).
function wantedStatus(listing: Doc<"shopProducts">["status"], work: Doc<"works"> | null, open: boolean): ProductStatus | null {
  if (!work || work.status === "withdrawn" || !open) return "DRAFT";
  if (listing !== "live") return null;
  if (work.status === "private") return "UNLISTED";
  return work.status === "published" ? "ACTIVE" : null;
}

// What a listing's Shopify product is made from. Null when it isn't ready to sync (paused, still
// preparing, or its work is neither public nor kept). A kept design is approved for its creator
// alone; its product is named "Kept design" and only the creator's cart can reach it. draft: checkout
// is off, so Shopify keeps the product as a draft until it opens.
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
      kept: v.boolean(),
      draft: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row?.listing || !row.printFile || row.status === "paused" || row.status === "preparing") return null;
    const work = await ctx.db.get("works", row.workId);
    if (!work || (work.status !== "published" && work.status !== "private")) return null;
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
    return {
      workId: work._id,
      cr: crNumber(work.crFamily, work.crExpression),
      title: work.title,
      imageUrls,
      listing: row.listing,
      kept: work.status === "private",
      draft: !(await commerceOpen(ctx)),
    };
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
  // kept: the sync wrote a kept design's product (unlisted, for its creator alone). status: the
  // status the sync gave the product.
  args: {
    listingId: v.id("shopProducts"),
    productId: v.string(),
    variants: v.array(syncedVariant),
    kept: v.optional(v.boolean()),
    status: v.optional(productStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row) return null;
    const work = await ctx.db.get("works", row.workId);
    // Shared with the world while its kept product synced (publish.shareKeep): that product was for
    // its creator alone, so Shopify archives it, and the listing waits under its public number.
    if (args.kept && work?.status !== "private") {
      await ctx.scheduler.runAfter(0, internal.shopify.archiveProducts, { productIds: [args.productId] });
      return null;
    }
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
    const withdrawn = work?.status === "withdrawn";
    const status = row.status === "paused" || withdrawn ? ("paused" as const) : ("live" as const);
    // Paused while it synced: it stays paused, with its product id kept.
    await ctx.db.patch("shopProducts", row._id, {
      status,
      shopifyProductId: args.productId,
      lastError: undefined,
      nextAttemptAt: undefined,
      syncedAt: now,
      updatedAt: now,
    });
    // A kept design's first product: its creator asked to have it printed, and it's ready for them.
    if (work?.status === "private" && status === "live") {
      await notifyKeptReady(ctx, { recipientId: work.creatorId, workId: work._id });
    }
    // Taken down while it synced (convex/moderation.ts): Shopify made this product active after the
    // takedown drafted the others (a first sync had no product to draft yet), so it's drafted too.
    if (withdrawn) {
      if (args.status !== "DRAFT") await ctx.scheduler.runAfter(0, internal.shopify.draftProducts, { productIds: [args.productId] });
    } else if (args.status !== undefined) {
      // Checkout opened or closed while it synced: Shopify gets what the switch says now.
      const want = wantedStatus(status, work, await commerceOpen(ctx));
      if (want !== null && want !== args.status) {
        await ctx.scheduler.runAfter(0, internal.shopify.applyStatus, { listingIds: [row._id], attempt: 0 });
      }
    }
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
        kept: job.kept,
        draft: job.draft,
      });
      await ctx.runMutation(internal.shopify.saveSynced, {
        listingId: args.listingId,
        productId: result.productId,
        kept: job.kept,
        status: result.status,
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

// Archives the Shopify products of a kept design that was shared with the world
// (publish.shareKeep): they were for its creator alone, and the shared design sells under its
// public number once an admin approves it. Best effort: the cart only adds what a work offers now.
export const archiveProducts = internalAction({
  args: { productIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = shopifyAdminForAction(ctx);
    if (!admin) return null;
    for (const productId of args.productIds) {
      try {
        await archiveProduct(admin, productId);
      } catch (error) {
        console.warn(`Archiving ${productId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return null;
  },
});

// Drafts the Shopify products of a design taken down (convex/moderation.ts), so nothing can buy it
// even from a cart made before; approving it again after it's back up makes them active. Best effort,
// like archiving: the cart and fulfillment also refuse it on our side.
export const draftProducts = internalAction({
  args: { productIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = shopifyAdminForAction(ctx);
    if (!admin) return null;
    for (const productId of args.productIds) {
      try {
        await setProductStatus(admin, productId, "DRAFT");
      } catch (error) {
        console.warn(`Drafting ${productId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return null;
  },
});

// ---- Checkout open or closed: what Shopify's products are ----

const STATUS_RETRIES = 4;
const CHECKOUT_PAGE = 50;

// The listings' products and what each should be now (wantedStatus), read just before writing so a
// late write can't undo a newer change.
export const wantedStatuses = internalQuery({
  args: { listingIds: v.array(v.id("shopProducts")) },
  returns: v.array(v.object({ listingId: v.id("shopProducts"), productId: v.string(), status: productStatusValidator })),
  handler: async (ctx, args) => {
    const open = await commerceOpen(ctx);
    const out = [];
    for (const listingId of args.listingIds) {
      const row = await ctx.db.get("shopProducts", listingId);
      if (!row?.shopifyProductId) continue;
      const status = wantedStatus(row.status, await ctx.db.get("works", row.workId), open);
      if (status) out.push({ listingId, productId: row.shopifyProductId, status });
    }
    return out;
  },
});

// Writes each listing's wanted status to Shopify; the ones Shopify refused try again with backoff.
async function writeStatuses(ctx: ActionCtx, listingIds: Array<Id<"shopProducts">>, attempt: number) {
  const admin = shopifyAdminForAction(ctx);
  if (!admin || listingIds.length === 0) return;
  const items = await ctx.runQuery(internal.shopify.wantedStatuses, { listingIds });
  const failed: Array<Id<"shopProducts">> = [];
  for (const item of items) {
    try {
      await setProductStatus(admin, item.productId, item.status);
    } catch (error) {
      console.warn(`Setting ${item.productId} to ${item.status} failed: ${error instanceof Error ? error.message : String(error)}`);
      failed.push(item.listingId);
    }
  }
  if (failed.length > 0 && attempt < STATUS_RETRIES) {
    await ctx.scheduler.runAfter(retryDelay(attempt + 2), internal.shopify.applyStatus, { listingIds: failed, attempt: attempt + 1 });
  }
}

export const applyStatus = internalAction({
  args: { listingIds: v.array(v.id("shopProducts")), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeStatuses(ctx, args.listingIds, args.attempt);
    return null;
  },
});

// A page of listings with Shopify products, and whether checkout is open now.
export const checkoutPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ open: v.boolean(), listingIds: v.array(v.id("shopProducts")), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("shopProducts").paginate({ cursor: args.cursor, numItems: CHECKOUT_PAGE });
    return {
      open: await commerceOpen(ctx),
      listingIds: page.page.filter((row) => row.shopifyProductId).map((row) => row._id),
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});

// Turning Checkout on or off in Admin (admin.setFlag) brings the products in Shopify along, a page
// at a time: off makes every one a draft, so even a cart made before it closed can't check out; on
// makes each live listing's product sellable again. A later turn of the switch takes over from an
// earlier run.
export const applyCheckout = internalAction({
  args: { open: v.boolean(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!shopifyAdminForAction(ctx)) return null;
    const page = await ctx.runQuery(internal.shopify.checkoutPage, { cursor: args.cursor });
    if (page.open !== args.open) return null;
    await writeStatuses(ctx, page.listingIds, 0);
    if (!page.done) await ctx.scheduler.runAfter(0, internal.shopify.applyCheckout, { open: args.open, cursor: page.cursor });
    return null;
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
  // Where the design sits, for the buy box's drawn garment.
  placement: relativePlacementValidator,
  printArea: printAreaValidator,
  // The front print area, when a back print has a chest mark there.
  markArea: v.optional(printAreaValidator),
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
    return await offerOf(ctx, work);
  },
});

// A kept design's offer, for its creator alone (the cart asks as the signed-in member). Null for
// anyone else, while checkout is off, or before it's approved and live.
export const keptOffer = query({
  args: { workId: v.id("works") },
  returns: v.union(v.null(), offerValidator),
  handler: async (ctx, args) => {
    if (!(await commerceOpen(ctx))) return null;
    const viewer = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!viewer || !work || work.creatorId !== viewer._id || work.status !== "private") return null;
    return await offerOf(ctx, work);
  },
});

// Whether a published work has a live product to sell, whatever the Checkout switch says (the
// early-access email counts who will hear before checkout opens, and writes only once it has). A
// live listing always has its variants (saveSynced writes them first), so its listings are enough.
export async function onSaleNow(ctx: QueryCtx, work: Doc<"works">) {
  return work.status === "published" && (await listingsOf(ctx, work._id)).some((row) => row.status === "live" && row.listing);
}

// What a work sells now: each live product with its colors, sizes, prices, and side.
async function offerOf(ctx: QueryCtx, work: Doc<"works">) {
  const rows = (await listingsOf(ctx, work._id)).filter((row) => row.status === "live" && row.listing);
  if (rows.length === 0) return null;
  const variants = await ctx.db
    .query("workVariants")
    .withIndex("by_work", (q) => q.eq("workId", work._id))
    .take(500);
  const products = [];
  const cr = crNumber(work.crFamily, work.crExpression);
  for (const row of rows) {
    const listing = row.listing!;
    // Only the listing's colors are sold: rows for any other color (kept so old orders still
    // resolve) are never offered, so the cart refuses them. The same goes for rows under another
    // number: a kept design shared with the world keeps its kept product's rows for the orders
    // that used them, and sells only under its public number.
    const mine = variants.filter(
      (variant) =>
        variant.listingId === row._id && variant.sku === variantSku(cr, variant.color, variant.size, listing.printfulProductId),
    );
    const colors = listing.colors.filter((color) => mine.some((variant) => variant.color === color.code));
    const sold = mine.filter((variant) => colors.some((color) => color.code === variant.color));
    if (sold.length === 0) continue;
    products.push({
      key: listing.productKey,
      name: listing.name,
      kind: listing.kind,
      side: listing.placement.side,
      placement: listing.placement,
      printArea: listing.printArea,
      ...(listing.markArea && listing.placement.mark !== undefined ? { markArea: listing.markArea } : {}),
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
  return { workId: work._id, cr, products };
}
