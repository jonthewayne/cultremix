import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewerUser, isOwner } from "./identity";
import type { SHOPIFY_PRIVACY_TOPICS } from "../shared/config/shopify";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// Buyers' personal data (orders.recipient: name, address, phone, email; and the raw Shopify
// webhook bodies, kept 30 days for replay) and Shopify's privacy webhooks:
// - customers/data_request: recorded as open for the owner, with what CultRemix holds for the
//   orders named, until the owner sends it to the customer and marks it done.
// - customers/redact: each named order's recipient and raw bodies are removed now, or, while the
//   order still has to reach Printful with its address, as soon as it has (the daily sweep).
// - shop/redact: every order's recipient and every raw Shopify body are removed.
// The daily sweep also removes a recipient 30 days after its order shipped or was canceled.

export type PrivacyTopic = (typeof SHOPIFY_PRIVACY_TOPICS)[number];

// An order keeps its address this long after it ships or is canceled (reprints, returns).
export const RECIPIENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const DONE_STATES = new Set(["shipped", "canceled", "test_ignored"]);

// Whether Printful still needs the order's address from CultRemix.
function stillNeedsAddress(order: Doc<"orders">) {
  return order.printfulOrderId === undefined && !order.cancelled && !DONE_STATES.has(order.fulfillmentState);
}

async function deletePayloads(ctx: MutationCtx, shopifyOrderId: string) {
  const inbox = await ctx.db
    .query("shopifyInbox")
    .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", shopifyOrderId))
    .unique();
  for (const event of inbox?.events ?? []) {
    if (!event.payloadKey) continue;
    const key = event.payloadKey;
    const payload = await ctx.db
      .query("webhookPayloads")
      .withIndex("by_source_key", (q) => q.eq("source", "shopify").eq("eventKey", key))
      .first();
    if (payload) await ctx.db.delete("webhookPayloads", payload._id);
  }
}

// Removes an order's personal data: its recipient and its raw webhook bodies.
export async function scrubOrder(ctx: MutationCtx, order: Doc<"orders">, now: number) {
  await ctx.db.patch("orders", order._id, { recipient: undefined, redactedAt: now, redactRequestedAt: undefined, updatedAt: now });
  await deletePayloads(ctx, order.shopifyOrderId);
}

const idList = v.array(v.string());

export const recordRequest = internalMutation({
  args: {
    webhookId: v.string(),
    topic: v.union(v.literal("customers/data_request"), v.literal("customers/redact"), v.literal("shop/redact")),
    shopDomain: v.string(),
    customerId: v.optional(v.string()),
    orderIds: idList,
  },
  returns: v.union(v.literal("accepted"), v.literal("duplicate")),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("privacyRequests")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", args.webhookId))
      .first();
    if (seen) return "duplicate";
    const now = Date.now();
    let note: string | undefined;
    if (args.topic === "customers/redact") {
      let cleared = 0;
      let waiting = 0;
      for (const shopifyOrderId of args.orderIds) {
        const order = await ctx.db
          .query("orders")
          .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", shopifyOrderId))
          .unique();
        if (!order) {
          await deletePayloads(ctx, shopifyOrderId);
          continue;
        }
        if (stillNeedsAddress(order)) {
          await ctx.db.patch("orders", order._id, { redactRequestedAt: now, updatedAt: now });
          waiting++;
        } else {
          await scrubOrder(ctx, order, now);
          cleared++;
        }
      }
      note = waiting > 0 ? `Cleared ${cleared}; ${waiting} cleared once Printful has the address.` : `Cleared ${cleared}.`;
    }
    if (args.topic === "shop/redact") {
      await ctx.scheduler.runAfter(0, internal.privacy.redactShop, { cursor: null });
      note = "Every order's address and every raw order body are being removed.";
    }
    await ctx.db.insert("privacyRequests", {
      webhookId: args.webhookId,
      topic: args.topic,
      shopDomain: args.shopDomain,
      ...(args.customerId ? { customerId: args.customerId } : {}),
      orderIds: args.orderIds.slice(0, 250),
      receivedAt: now,
      status: args.topic === "customers/data_request" ? "open" : "done",
      ...(args.topic === "customers/data_request" ? {} : { doneAt: now }),
      ...(note ? { note } : {}),
    });
    return "accepted";
  },
});

// shop/redact: every order, a page at a time, then every raw Shopify body.
export const redactShop = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db.query("orders").paginate({ cursor: args.cursor, numItems: 100 });
    for (const order of page.page) if (order.recipient || order.redactedAt === undefined) await scrubOrder(ctx, order, now);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.privacy.redactShop, { cursor: page.continueCursor });
      return null;
    }
    const bodies = await ctx.db.query("webhookPayloads").take(500);
    for (const body of bodies.filter((row) => row.source === "shopify")) await ctx.db.delete("webhookPayloads", body._id);
    if (bodies.length === 500) await ctx.scheduler.runAfter(0, internal.privacy.redactShop, { cursor: page.continueCursor });
    return null;
  },
});

// Cron (daily): addresses 30 days after shipping or cancellation, and redactions that waited
// for Printful.
export const sweep = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let cleared = 0;
    const waiting = await ctx.db
      .query("orders")
      .withIndex("by_redactRequested", (q) => q.gt("redactRequestedAt", 0))
      .take(100);
    for (const order of waiting) {
      if (stillNeedsAddress(order)) continue;
      await scrubOrder(ctx, order, now);
      cleared++;
    }
    for (const state of ["shipped", "canceled", "test_ignored"] as const) {
      const old = await ctx.db
        .query("orders")
        .withIndex("by_fulfillmentState_updated", (q) => q.eq("fulfillmentState", state).lt("updatedAt", now - RECIPIENT_KEEP_MS))
        .take(100);
      for (const order of old) {
        if (!order.recipient) continue;
        await scrubOrder(ctx, order, now);
        cleared++;
      }
    }
    return cleared;
  },
});

// ---- Owner: /admin/orders ----

const heldValidator = v.object({
  shopifyOrderId: v.string(),
  name: v.optional(v.string()),
  createdAt: v.number(),
  recipient: v.union(
    v.null(),
    v.object({
      name: v.string(),
      address: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
  ),
  redacted: v.boolean(),
  lines: v.array(v.object({ cr: v.optional(v.string()), quantity: v.number(), unitPriceCents: v.number() })),
});

// Open data requests, with what CultRemix holds for each named order, and the latest redactions.
export const requests = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("privacyRequests"),
      topic: v.string(),
      status: v.union(v.literal("open"), v.literal("done")),
      receivedAt: v.number(),
      customerId: v.optional(v.string()),
      note: v.optional(v.string()),
      held: v.array(heldValidator),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer || !isOwner(viewer)) throw new ConvexError({ code: "FORBIDDEN", message: "Owner only." });
    const open = await ctx.db
      .query("privacyRequests")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(20);
    const done = await ctx.db
      .query("privacyRequests")
      .withIndex("by_status", (q) => q.eq("status", "done"))
      .order("desc")
      .take(10);
    const out = [];
    for (const request of [...open, ...done]) {
      const held = [];
      if (request.status === "open") {
        for (const shopifyOrderId of request.orderIds.slice(0, 50)) {
          const order = await ctx.db
            .query("orders")
            .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", shopifyOrderId))
            .unique();
          if (!order) continue;
          const items = await ctx.db
            .query("orderItems")
            .withIndex("by_order", (q) => q.eq("orderId", order._id))
            .take(50);
          const lines = [];
          for (const item of items) {
            const work = item.workId ? await ctx.db.get("works", item.workId) : null;
            lines.push({
              ...(work ? { cr: `${String(work.crFamily).padStart(3, "0")}-${String(work.crExpression).padStart(3, "0")}` } : {}),
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
            });
          }
          const r = order.recipient;
          held.push({
            shopifyOrderId,
            ...(order.orderName ? { name: order.orderName } : {}),
            createdAt: order.createdAt,
            recipient: r
              ? {
                  name: r.name,
                  address: [r.company, r.address1, r.address2, r.city, r.stateCode, r.zip, r.countryCode].filter(Boolean).join(", "),
                  ...(r.phone ? { phone: r.phone } : {}),
                  ...(r.email ? { email: r.email } : {}),
                }
              : null,
            redacted: order.redactedAt !== undefined,
            lines,
          });
        }
      }
      out.push({
        id: request._id,
        topic: request.topic,
        status: request.status,
        receivedAt: request.receivedAt,
        ...(request.customerId ? { customerId: request.customerId } : {}),
        ...(request.note ? { note: request.note } : {}),
        held,
      });
    }
    return out;
  },
});

// The owner sent the customer their data.
export const markDone = mutation({
  args: { id: v.id("privacyRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer || !isOwner(viewer)) throw new ConvexError({ code: "FORBIDDEN", message: "Owner only." });
    const request = await ctx.db.get("privacyRequests", args.id);
    if (!request || request.status === "done") return null;
    await ctx.db.patch("privacyRequests", request._id, { status: "done", doneAt: Date.now() });
    return null;
  },
});

