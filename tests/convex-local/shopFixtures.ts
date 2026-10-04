import { createHmac } from "node:crypto";
import { vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { RawOrder } from "../../convex/lib/shopify/orderQuery";
import type { newTest } from "./setup";
import { variantList } from "../../convex/lib/shopify/productSync";
import { sellableColors } from "../../convex/lib/shopColors";

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

// Puts a work on sale without Shopify: a live product and a variant per sellable color and size
// (20 for the launch colors), numbered from base.
export async function makeOnSale(t: T, workId: Id<"works">, cr: string, base = 1000, printfulBase: number | null = 5000) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const work = await ctx.db.get("works", workId);
    await ctx.db.insert("shopProducts", {
      workId,
      handle: `cr-${cr}`,
      status: "live",
      shopifyProductId: `gid://shopify/Product/${base}`,
      attempts: 0,
      syncedAt: now,
      updatedAt: now,
    });
    for (const [i, variant] of variantList(cr, sellableColors(work?.offeredColors)).entries()) {
      await ctx.db.insert("workVariants", {
        workId,
        shopifyVariantId: `gid://shopify/ProductVariant/${base + i}`,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        priceCents: variant.priceCents,
        printfulVariantId: printfulBase === null ? undefined : printfulBase + i,
      });
    }
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
