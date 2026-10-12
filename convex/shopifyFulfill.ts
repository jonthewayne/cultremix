import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  FULFILLMENT_CREATE_MUTATION,
  FULFILLMENT_ORDERS_QUERY,
  carrierName,
  fulfillmentLines,
} from "./lib/shopify/fulfillmentSync";
import { shopifyAdminForAction } from "./shopify";
import type { FulfillmentOrderNode } from "./lib/shopify/fulfillmentSync";

// When Printful ships, Shopify gets a fulfillment with the carrier and tracking number, and sends
// the buyer its shipping email (notifyCustomer). One per shipment, recorded on orderShipments;
// retried with backoff, then left for the owner on /admin/orders.

const RETRY_BASE_MS = 5 * 60 * 1000;
const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1000;
export const MAX_FULFILL_ATTEMPTS = 6;

export const job = internalQuery({
  args: { shipmentId: v.id("orderShipments") },
  returns: v.union(
    v.null(),
    v.object({
      shopifyOrderId: v.string(),
      lines: v.array(v.object({ shopifyLineItemId: v.string(), quantity: v.number() })),
      carrier: v.optional(v.string()),
      trackingNumber: v.optional(v.string()),
      trackingUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const shipment = await ctx.db.get("orderShipments", args.shipmentId);
    if (!shipment || shipment.shopifyState === "done" || shipment.shopifyState === "skipped") return null;
    const order = await ctx.db.get("orders", shipment.orderId);
    if (!order) return null;
    const lines = [];
    for (const line of shipment.lines) {
      const item = await ctx.db.get("orderItems", line.orderItemId);
      if (item) lines.push({ shopifyLineItemId: item.shopifyLineItemId, quantity: line.toUnit - line.fromUnit + 1 });
    }
    return {
      shopifyOrderId: order.shopifyOrderId,
      lines,
      ...(shipment.carrier ? { carrier: shipment.carrier } : {}),
      ...(shipment.trackingNumber ? { trackingNumber: shipment.trackingNumber } : {}),
      ...(shipment.trackingUrl ? { trackingUrl: shipment.trackingUrl } : {}),
    };
  },
});

export const record = internalMutation({
  args: {
    shipmentId: v.id("orderShipments"),
    outcome: v.union(
      v.object({ kind: v.literal("done"), fulfillmentId: v.string() }),
      v.object({ kind: v.literal("skipped") }),
      v.object({ kind: v.literal("failed"), error: v.string(), countAttempt: v.boolean() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const shipment = await ctx.db.get("orderShipments", args.shipmentId);
    if (!shipment || shipment.shopifyState === "done") return null;
    const now = Date.now();
    if (args.outcome.kind === "done") {
      await ctx.db.patch("orderShipments", shipment._id, {
        shopifyState: "done",
        shopifyFulfillmentId: args.outcome.fulfillmentId,
        shopifyError: undefined,
        shopifyNextAt: undefined,
      });
    } else if (args.outcome.kind === "skipped") {
      await ctx.db.patch("orderShipments", shipment._id, { shopifyState: "skipped", shopifyError: undefined, shopifyNextAt: undefined });
    } else {
      const attempts = (shipment.shopifyAttempts ?? 0) + (args.outcome.countAttempt ? 1 : 0);
      const giveUp = attempts >= MAX_FULFILL_ATTEMPTS;
      await ctx.db.patch("orderShipments", shipment._id, {
        shopifyState: giveUp ? "failed" : "pending",
        shopifyAttempts: attempts,
        shopifyError: args.outcome.error.slice(0, 300),
        shopifyNextAt: giveUp
          ? undefined
          : now + (args.outcome.countAttempt ? RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1) : NOT_CONFIGURED_RETRY_MS),
      });
    }
    return null;
  },
});

export const run = internalAction({
  args: { shipmentId: v.id("orderShipments") },
  returns: v.union(v.literal("done"), v.literal("skipped"), v.literal("failed"), v.literal("waiting")),
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.shopifyFulfill.job, args);
    if (!work) return "skipped";
    const admin = shopifyAdminForAction(ctx);
    if (!admin) {
      await ctx.runMutation(internal.shopifyFulfill.record, {
        shipmentId: args.shipmentId,
        outcome: { kind: "failed", error: "Shopify is not configured yet.", countAttempt: false },
      });
      return "waiting";
    }
    try {
      const data = await admin.graphql<{ order: { fulfillmentOrders: { nodes: Array<FulfillmentOrderNode> } } | null }>(
        FULFILLMENT_ORDERS_QUERY,
        { id: `gid://shopify/Order/${work.shopifyOrderId}` },
      );
      if (!data.order) throw new Error(`Shopify has no order ${work.shopifyOrderId}.`);
      const lines = fulfillmentLines(data.order.fulfillmentOrders.nodes, work.lines);
      if (lines.length === 0) {
        // Already fulfilled, by hand or by an earlier run.
        await ctx.runMutation(internal.shopifyFulfill.record, { shipmentId: args.shipmentId, outcome: { kind: "skipped" } });
        return "skipped";
      }
      const company = carrierName(work.carrier);
      const trackingInfo = {
        ...(company ? { company } : {}),
        ...(work.trackingNumber ? { number: work.trackingNumber } : {}),
        ...(work.trackingUrl ? { url: work.trackingUrl } : {}),
      };
      const created = await admin.graphql<{
        fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
      }>(FULFILLMENT_CREATE_MUTATION, {
        fulfillment: {
          lineItemsByFulfillmentOrder: lines,
          notifyCustomer: true,
          ...(Object.keys(trackingInfo).length > 0 ? { trackingInfo } : {}),
        },
      });
      const { fulfillment, userErrors } = created.fulfillmentCreate;
      if (userErrors.length > 0 || !fulfillment) {
        throw new Error(`Shopify refused the fulfillment: ${userErrors.map((e) => e.message).join("; ") || "no fulfillment"}`);
      }
      await ctx.runMutation(internal.shopifyFulfill.record, {
        shipmentId: args.shipmentId,
        outcome: { kind: "done", fulfillmentId: fulfillment.id },
      });
      return "done";
    } catch (error) {
      await ctx.runMutation(internal.shopifyFulfill.record, {
        shipmentId: args.shipmentId,
        outcome: { kind: "failed", error: error instanceof Error ? error.message : String(error), countAttempt: true },
      });
      return "failed";
    }
  },
});

// Cron: shipments whose Shopify fulfillment is due again.
export const retryDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("orderShipments")
      .withIndex("by_shopify_next", (q) => q.eq("shopifyState", "pending").lte("shopifyNextAt", now))
      .take(20);
    for (const shipment of due) {
      await ctx.db.patch("orderShipments", shipment._id, { shopifyNextAt: now + NOT_CONFIGURED_RETRY_MS });
      await ctx.scheduler.runAfter(0, internal.shopifyFulfill.run, { shipmentId: shipment._id });
    }
    return due.length;
  },
});

