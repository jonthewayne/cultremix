import type { Id } from "../../convex/_generated/dataModel";
import type { newTest } from "./setup";
import { variantList } from "../../convex/lib/shopify/productSync";

type T = ReturnType<typeof newTest>;

export const SHOP_ENV = {
  SHOPIFY_SHOP_DOMAIN: "cultremix-dev.myshopify.com",
  SHOPIFY_CLIENT_ID: "client-id",
  SHOPIFY_CLIENT_SECRET: "client-secret",
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

export async function makeUser(t: T, fields: { name?: string; platformRole?: "super_admin_owner"; authId?: string } = {}) {
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
    });
    if (!args.parent) await ctx.db.patch("works", workId, { familyRootId: workId });
    return workId;
  });
}

// Puts a work on sale without Shopify: a live product and the 20 variants, numbered from base.
export async function makeOnSale(t: T, workId: Id<"works">, cr: string, base = 1000, printfulBase: number | null = 5000) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("shopProducts", {
      workId,
      handle: `cr-${cr}`,
      status: "live",
      shopifyProductId: `gid://shopify/Product/${base}`,
      attempts: 0,
      syncedAt: now,
      updatedAt: now,
    });
    for (const [i, variant] of variantList(cr).entries()) {
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
