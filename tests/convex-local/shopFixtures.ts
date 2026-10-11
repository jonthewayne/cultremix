import { createHash, createHmac } from "node:crypto";
import { vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { RawOrder } from "../../convex/lib/shopify/orderQuery";
import type { newTest } from "./setup";
import { variantList } from "../../convex/lib/shopify/productSync";
import { launchShopProduct, listingFor } from "../../convex/lib/shopProduct";
import { DEFAULT_PLACEMENT } from "../../src/lib/print/shirtPlacement";

type T = ReturnType<typeof newTest>;

export const SHOP_ENV = {
  SHOPIFY_SHOP_DOMAIN: "cultremix-dev.myshopify.com",
  SHOPIFY_CLIENT_ID: "client-id",
  SHOPIFY_CLIENT_SECRET: "client-secret",
  R2_PUBLIC_URL: "https://files.cultremix.test",
} as const;

export async function setFlag(t: T, key: string, enabled: boolean) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch("featureFlags", row._id, { enabled });
    else await ctx.db.insert("featureFlags", { key, enabled });
  });
}

export async function makeUser(
  t: T,
  fields: { name?: string; platformRole?: "super_admin_owner"; authId?: string; creatorNumber?: number } = {},
) {
  return t.run((ctx) => ctx.db.insert("users", { name: fields.name ?? "Member", ...fields }));
}

// A published work with the lineage fields the shop reads. Remixes pass parent.
export async function makeWork(
  t: T,
  args: {
    creatorId: Id<"users">;
    family: number;
    expression: number;
    parent?: Id<"works">;
    root?: Id<"works">;
    kind?: "original" | "variation" | "fork";
    title?: string;
    printKey?: string;
    offeredColors?: Array<string>;
  },
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: args.creatorId,
      updatedAt: now,
      phrase: "x",
      styleDirection: "x",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: args.creatorId,
      instruction: "x",
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "m",
      count: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: args.creatorId,
      index: 1,
      kind: "concept",
      status: "succeeded",
      provider: "p",
      model: "m",
      charged: true,
      favorite: false,
    });
    const workId = await ctx.db.insert("works", {
      crFamily: args.family,
      crExpression: args.expression,
      creatorId: args.creatorId,
      kind: args.kind ?? (args.parent ? "variation" : "original"),
      parentWorkId: args.parent,
      familyRootId: args.root,
      generationId,
      requestId: `req-${args.family}-${args.expression}`,
      title: args.title,
      backgroundColor: "#ffffff",
      status: "published",
      publishedAt: now,
      artKey: `works/${args.family}/${String(args.expression).padStart(3, "0")}/art.png`,
      printKey: args.printKey,
      offeredColors: args.offeredColors,
    });
    if (!args.parent) await ctx.db.patch("works", workId, { familyRootId: workId });
    return workId;
  });
}

// The bytes the public bucket serves for a print file in these tests, and their fingerprint, which
// makeOnSale saves as the file's approved SHA-256 (INV-10 checks them before a Printful create).
export const PRINT_FILE_BYTES = new TextEncoder().encode("CultRemix print file fixture: 3600 x 4800 at 300 DPI");
export const PRINT_FILE_SHA256 = createHash("sha256").update(PRINT_FILE_BYTES).digest("hex");

// Puts a work on sale without Shopify: a live listing on the launch shirt (front print, the work's
// print file as its file when it has one) and a variant per color and size (20 for the launch
// colors), numbered from base.
export async function makeOnSale(t: T, workId: Id<"works">, cr: string, base = 1000, printfulBase: number | null = 5000) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const work = await ctx.db.get("works", workId);
    if (!work) throw new Error("No work.");
    const product = launchShopProduct();
    const listing = listingFor({ offeredColors: work.offeredColors }, product, DEFAULT_PLACEMENT);
    const versionId = await ctx.db.insert("printVersions", {
      workId,
      number: 1,
      op: "published",
      status: "ready",
      key: work.artKey,
      width: 4096,
      height: 4096,
      upscaled: true,
      charged: 0,
      createdBy: work.creatorId,
    });
    const listingId = await ctx.db.insert("shopProducts", {
      workId,
      productKey: product.key,
      handle: `cr-${cr}-${product.printfulProductId}`,
      status: "live",
      listing,
      ...(work.printKey
        ? {
            printFile: {
              key: work.printKey,
              sha256: PRINT_FILE_SHA256,
              widthPx: 3600,
              heightPx: 4800,
              versionId,
              placement: { xIn: 1.33, yIn: 0.95, widthIn: 9.35, heightIn: 9.35 },
              dpi: 438,
              grade: "great" as const,
              warnings: [],
              madeAt: now,
            },
          }
        : {}),
      shopifyProductId: `gid://shopify/Product/${base}`,
      attempts: 0,
      syncedAt: now,
      updatedAt: now,
    });
    for (const [i, variant] of variantList(cr, listing).entries()) {
      await ctx.db.insert("workVariants", {
        workId,
        listingId,
        productKey: product.key,
        shopifyVariantId: `gid://shopify/ProductVariant/${base + i}`,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        priceCents: variant.priceCents,
        printfulVariantId: printfulBase === null ? undefined : printfulBase + i,
      });
    }
    return listingId;
  });
}

// A fake Admin API: the order snapshot it returns can be changed between deliveries.
export function fakeShopify() {
  const orders = new Map<string, RawOrder>();
  const updated: Array<{ id: string; updatedAt: string }> = [];
  let hydrations = 0;
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/admin/oauth/access_token")) {
      return Response.json({ access_token: "tok", expires_in: 86399 });
    }
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
    if (query.includes("HydrateOrder")) {
      hydrations++;
      return Response.json({ data: { order: orders.get(variables.id) ?? null } });
    }
    if (query.includes("OrdersUpdated")) {
      return Response.json({ data: { orders: { nodes: updated, pageInfo: { hasNextPage: false, endCursor: null } } } });
    }
    throw new Error(`Unexpected Shopify call: ${query.slice(0, 40)}`);
  });
  return {
    fetchFake,
    set: (order: RawOrder) => orders.set(order.id, order),
    updated,
    hydrations: () => hydrations,
  };
}

type ShopifyDelivery = {
  topic: string;
  body: Record<string, unknown>;
  webhookId?: string;
  signature?: string | null;
  shop?: string;
  raw?: string;
  // X-Shopify-Triggered-At, when Shopify says it sent the event.
  triggeredAt?: string;
};

let webhookCount = 0;
// Posts a signed Shopify webhook without running what it schedules.
export async function postShopifyWebhook(t: T, args: ShopifyDelivery) {
  const body = args.raw ?? JSON.stringify(args.body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-shopify-topic": args.topic,
    "x-shopify-shop-domain": args.shop ?? SHOP_ENV.SHOPIFY_SHOP_DOMAIN,
    "x-shopify-webhook-id": args.webhookId ?? `wh-${++webhookCount}`,
    ...(args.triggeredAt ? { "x-shopify-triggered-at": args.triggeredAt } : {}),
  };
  const signature =
    args.signature === undefined ? createHmac("sha256", SHOP_ENV.SHOPIFY_CLIENT_SECRET).update(body).digest("base64") : args.signature;
  if (signature !== null) headers["x-shopify-hmac-sha256"] = signature;
  return t.fetch("/webhooks/shopify", { method: "POST", headers, body });
}

// Posts a Shopify webhook and runs everything it schedules, however far in the future.
export async function deliver(t: T, args: ShopifyDelivery) {
  const response = await postShopifyWebhook(t, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return response;
}
