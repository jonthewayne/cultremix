import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/adminAccess";
import { createPrintful, printfulConfigFromEnv } from "./lib/printful/client";
import { PRINTFUL_WEBHOOK_EVENTS, webhookConfig } from "./lib/printful/setup";
import { shopifyAdminConfigFromEnv } from "./lib/shopify/adminClient";
import { SHOP_CHECK_QUERY, WEBHOOK_CREATE_MUTATION, missingTopics, shopifyWebhookUri } from "./lib/shopify/setup";
import type { ShopCheck } from "./lib/shopify/setup";
import { shopifyAdminForAction } from "./shopify";

// Connecting the shop's accounts from Admin, For sale, once their keys are in the env:
// - Connect Printful checks the token and store, sets the store's webhooks to this deployment's
//   /webhooks/printful with every event CultRemix handles, and keeps Printful's signing key, so
//   nobody copies it into the env.
// - Connect Shopify checks the store and its Headless channel and subscribes the order webhooks
//   to this deployment's /webhooks/shopify, skipping any already there.
// Both are safe to run again.

const nameValidator = v.union(v.literal("printful"), v.literal("shopify"));

function siteUrl() {
  const url = process.env.CONVEX_SITE_URL?.trim();
  if (!url) throw new ConvexError({ code: "NOT_CONFIGURED", message: "This deployment has no CONVEX_SITE_URL." });
  return url;
}

function readable(error: unknown) {
  return error instanceof Error && error.message ? error.message.slice(0, 300) : "Something went wrong.";
}

export const saveConnection = internalMutation({
  args: { name: nameValidator, note: v.string(), webhookSecret: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    const fields = { connectedAt: Date.now(), note: args.note.slice(0, 500), ...(args.webhookSecret ? { webhookSecret: args.webhookSecret } : {}) };
    if (row) await ctx.db.patch("integrations", row._id, fields);
    else await ctx.db.insert("integrations", { name: args.name, ...fields });
    return null;
  },
});

// For the Printful webhook route only. The env's PRINTFUL_WEBHOOK_SECRET wins over it.
export const printfulWebhookSecret = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_name", (q) => q.eq("name", "printful"))
      .unique();
    return row?.webhookSecret ?? null;
  },
});

const connectionView = v.object({
  // Its keys are in the env.
  configured: v.boolean(),
  connectedAt: v.optional(v.number()),
  note: v.optional(v.string()),
});

export const status = query({
  args: {},
  returns: v.object({
    printful: v.object({ ...connectionView.fields, signingKey: v.union(v.literal("env"), v.literal("stored"), v.literal("none")) }),
    shopify: connectionView,
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const rows = await ctx.db.query("integrations").take(10);
    const printful = rows.find((row) => row.name === "printful");
    const shopify = rows.find((row) => row.name === "shopify");
    const view = (row: (typeof rows)[number] | undefined) =>
      row ? { connectedAt: row.connectedAt, note: row.note } : {};
    return {
      printful: {
        configured: printfulConfigFromEnv() !== null,
        ...view(printful),
        signingKey: process.env.PRINTFUL_WEBHOOK_SECRET?.trim() ? ("env" as const) : printful?.webhookSecret ? ("stored" as const) : ("none" as const),
      },
      shopify: { configured: shopifyAdminConfigFromEnv() !== null, ...view(shopify) },
    };
  },
});

export const connectPrintful = action({
  args: {},
  returns: v.object({ store: v.string(), url: v.string(), events: v.number() }),
  handler: async (ctx): Promise<{ store: string; url: string; events: number }> => {
    await ctx.runQuery(internal.merch.checkAdmin, { level: "manage" });
    const config = printfulConfigFromEnv();
    if (!config) throw new ConvexError({ code: "NOT_CONFIGURED", message: "Set PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID first." });
    const printful = createPrintful({ config });
    const site = siteUrl();
    let store;
    try {
      store = await printful.getStore();
    } catch (error) {
      throw new ConvexError({ code: "PRINTFUL", message: `Printful refused the token or store: ${readable(error)}` });
    }
    if (!store) throw new ConvexError({ code: "PRINTFUL", message: `Printful has no store ${config.storeId} for this token.` });
    const setup = webhookConfig(site);
    let answer;
    try {
      answer = await printful.setWebhooks(setup);
    } catch (error) {
      throw new ConvexError({ code: "PRINTFUL", message: `Printful refused the webhooks: ${readable(error)}` });
    }
    const secret = answer?.secret_key?.trim();
    if (!secret || !/^[0-9a-f]+$/iu.test(secret)) {
      throw new ConvexError({ code: "PRINTFUL", message: "Printful set the webhooks but sent no signing key. Run it again." });
    }
    const name = store.name ?? `store ${store.id}`;
    await ctx.runMutation(internal.integrations.saveConnection, {
      name: "printful",
      note: `${name}: ${PRINTFUL_WEBHOOK_EVENTS.length} webhooks to ${setup.default_url}.`,
      webhookSecret: secret,
    });
    return { store: name, url: setup.default_url, events: PRINTFUL_WEBHOOK_EVENTS.length };
  },
});

export const connectShopify = action({
  args: {},
  returns: v.object({ shop: v.string(), headless: v.boolean(), created: v.array(v.string()), existing: v.array(v.string()) }),
  handler: async (ctx): Promise<{ shop: string; headless: boolean; created: Array<string>; existing: Array<string> }> => {
    await ctx.runQuery(internal.merch.checkAdmin, { level: "manage" });
    const admin = shopifyAdminForAction(ctx);
    if (!admin) {
      throw new ConvexError({ code: "NOT_CONFIGURED", message: "Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET first." });
    }
    const uri = shopifyWebhookUri(siteUrl());
    let check: ShopCheck;
    try {
      check = await admin.graphql<ShopCheck>(SHOP_CHECK_QUERY);
    } catch (error) {
      throw new ConvexError({ code: "SHOPIFY", message: `Shopify refused the app's keys: ${readable(error)}` });
    }
    const headless = check.publications.nodes.some((publication) => /headless/iu.test(publication.name));
    const missing = missingTopics(check.webhookSubscriptions.nodes, uri);
    const created: Array<string> = [];
    for (const topic of missing) {
      const result = await admin.graphql<{
        webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: Array<{ message: string }> };
      }>(WEBHOOK_CREATE_MUTATION, { topic, webhookSubscription: { uri, format: "JSON" } });
      const { webhookSubscription, userErrors } = result.webhookSubscriptionCreate;
      if (userErrors.length > 0 || !webhookSubscription) {
        throw new ConvexError({
          code: "SHOPIFY",
          message: `Shopify refused the ${topic} webhook: ${userErrors.map((e) => e.message).join("; ") || "no subscription"}`,
        });
      }
      created.push(topic);
    }
    const existing = missingTopics([], uri).filter((topic) => !created.includes(topic));
    await ctx.runMutation(internal.integrations.saveConnection, {
      name: "shopify",
      note:
        `${check.shop.name} (${check.shop.myshopifyDomain}): order webhooks to ${uri}${created.length ? `, ${created.length} new` : ""}.` +
        (headless ? "" : " No Headless sales channel yet: add it, or products can't be published."),
    });
    return { shop: check.shop.name, headless, created, existing };
  },
});

