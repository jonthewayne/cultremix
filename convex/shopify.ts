import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { createShopifyAdmin, shopifyAdminConfigFromEnv, type FetchLike } from "./lib/shopify/adminClient";
import { crNumber, productHandle, syncProduct } from "./lib/shopify/productSync";
import { commerceOpen } from "./lib/shopFlags";
import { publicUrl } from "./lib/r2";
import { getViewerUser, isOwner } from "./identity";
import { PRINT_COLORS, PRINT_SIZES } from "../shared/config/print-products";

// Shopify products for published works (V1 U9). A work goes on sale after publish when
// commerce.checkout is on: one productSet by handle, then workVariants rows for reverse lookup.

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

async function enqueue(ctx: MutationCtx, workId: Id<"works">) {
  const work = await ctx.db.get("works", workId);
  if (!work || work.status !== "published") return false;
  const now = Date.now();
  const existing = await ctx.db
    .query("shopProducts")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  if (existing?.status === "live") return false;
  if (existing) {
    await ctx.db.patch("shopProducts", existing._id, { status: "pending", nextAttemptAt: now, updatedAt: now });
  } else {
    await ctx.db.insert("shopProducts", {
      workId,
      handle: productHandle(crNumber(work.crFamily, work.crExpression)),
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.shopify.syncWork, { workId });
  return true;
}

// Called by publish.markPublished once a work is public. Does nothing while checkout is off;
// the owner's "Put everything on sale" (syncAllPublished) catches those works up later.
export const onPublished = internalMutation({
  args: { workId: v.id("works") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await commerceOpen(ctx))) return false;
    return await enqueue(ctx, args.workId);
  },
});

export const workForSync = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({ cr: v.string(), title: v.optional(v.string()), imageUrls: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
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
    return { cr: crNumber(work.crFamily, work.crExpression), title: work.title, imageUrls };
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
  args: { workId: v.id("works"), productId: v.string(), variants: v.array(syncedVariant) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workVariants")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .collect();
    for (const variant of args.variants) {
      const row = existing.find((r) => r.sku === variant.sku);
      const fields = {
        workId: args.workId,
        shopifyVariantId: variant.shopifyVariantId,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        priceCents: variant.priceCents,
        printfulVariantId: variant.printfulVariantId ?? undefined,
      };
      if (row) await ctx.db.replace("workVariants", row._id, fields);
      else await ctx.db.insert("workVariants", fields);
    }
    const product = await ctx.db
      .query("shopProducts")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .unique();
    const now = Date.now();
    if (product) {
      await ctx.db.patch("shopProducts", product._id, {
        status: "live",
        shopifyProductId: args.productId,
        lastError: undefined,
        nextAttemptAt: undefined,
        syncedAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const syncFailed = internalMutation({
  args: { workId: v.id("works"), error: v.string(), countAttempt: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("shopProducts")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .unique();
    if (!product || product.status === "live") return null;
    const attempts = product.attempts + (args.countAttempt ? 1 : 0);
    const now = Date.now();
    await ctx.db.patch("shopProducts", product._id, {
      status: args.countAttempt ? "failed" : "pending",
      attempts,
      lastError: args.error.slice(0, 500),
      nextAttemptAt: now + (args.countAttempt ? retryDelay(attempts) : NOT_CONFIGURED_RETRY_MS),
      updatedAt: now,
    });
    return null;
  },
});

export const syncWork = internalAction({
  args: { workId: v.id("works") },
  returns: v.union(v.literal("live"), v.literal("skipped"), v.literal("failed")),
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.shopify.workForSync, args);
    if (!work) return "skipped";
    const admin = shopifyAdminForAction(ctx);
    if (!admin) {
      await ctx.runMutation(internal.shopify.syncFailed, {
        workId: args.workId,
        error: "Shopify is not configured yet.",
        countAttempt: false,
      });
      return "skipped";
    }
    try {
      const result = await syncProduct(admin, { workId: args.workId, ...work });
      await ctx.runMutation(internal.shopify.saveSynced, {
        workId: args.workId,
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
        workId: args.workId,
        error: error instanceof Error ? error.message : String(error),
        countAttempt: true,
      });
      return "failed";
    }
  },
});

// Cron: retries products whose sync is due (failed with backoff, or waiting for configuration).
export const retryDueProducts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (!(await commerceOpen(ctx))) return 0;
    const now = Date.now();
    let scheduled = 0;
    for (const status of ["pending", "failed"] as const) {
      const due = await ctx.db
        .query("shopProducts")
        .withIndex("by_status_next", (q) => q.eq("status", status).lte("nextAttemptAt", now))
        .take(10);
      for (const product of due) {
        await ctx.db.patch("shopProducts", product._id, { nextAttemptAt: now + NOT_CONFIGURED_RETRY_MS });
        await ctx.scheduler.runAfter(0, internal.shopify.syncWork, { workId: product.workId });
        scheduled++;
      }
    }
    return scheduled;
  },
});

// Owner: put every published work on sale (works published while checkout was off), a page at a time.
export const syncAllPublished = mutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ queued: v.number(), cursor: v.union(v.string(), v.null()), done: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer || !isOwner(viewer)) throw new ConvexError({ code: "FORBIDDEN", message: "Owner only." });
    if (!(await commerceOpen(ctx))) {
      throw new ConvexError({ code: "CHECKOUT_OFF", message: "Turn on commerce.checkout first." });
    }
    const page = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    let queued = 0;
    for (const work of page.page) if (await enqueue(ctx, work._id)) queued++;
    return { queued, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});

// ---- Public: what the work page offers ----

const offerValidator = v.object({
  workId: v.id("works"),
  cr: v.string(),
  colors: v.array(v.object({ code: v.string(), name: v.string(), hex: v.string() })),
  sizes: v.array(v.string()),
  variants: v.array(
    v.object({ color: v.string(), size: v.string(), merchandiseId: v.string(), priceCents: v.number() }),
  ),
});

// Null while checkout is off or the work isn't on sale yet; the page then stays exactly as it was.
export const offer = query({
  args: { cr: v.string() },
  returns: v.union(v.null(), offerValidator),
  handler: async (ctx, args) => {
    if (!(await commerceOpen(ctx))) return null;
    const match = /^(\d{3})-(\d{3})$/u.exec(args.cr.trim());
    if (!match) return null;
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) =>
        q.eq("crFamily", Number(match[1])).eq("crExpression", Number(match[2])),
      )
      .unique();
    if (!work || work.status !== "published") return null;
    const product = await ctx.db
      .query("shopProducts")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .unique();
    if (product?.status !== "live") return null;
    const rows = await ctx.db
      .query("workVariants")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .take(100);
    if (rows.length === 0) return null;
    return {
      workId: work._id,
      cr: crNumber(work.crFamily, work.crExpression),
      colors: PRINT_COLORS.filter((c) => rows.some((r) => r.color === c.code)).map((c) => ({
        code: c.code,
        name: c.name,
        hex: c.hex,
      })),
      sizes: PRINT_SIZES.filter((s) => rows.some((r) => r.size === s)),
      variants: rows.map((r) => ({
        color: r.color,
        size: r.size,
        merchandiseId: r.shopifyVariantId,
        priceCents: r.priceCents,
      })),
    };
  },
});
