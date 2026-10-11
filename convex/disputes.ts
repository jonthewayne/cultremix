import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { notifyNewSales, syncOrderEarnings } from "./earnings";

// Shopify Payments disputes (INV-23): disputes/create and disputes/update, verified and parsed by the
// webhook route (convex/lib/shopify/webhookRoute.ts, convex/lib/disputes.ts parseDispute), are kept
// one row per dispute, and the order's earnings are brought up to date with them
// (earnings.syncOrderEarnings): an open dispute holds them, a lost chargeback reverses what's left,
// and one that's over releases the hold. A dispute that arrives before its order is kept and applies
// when the order does.

export const record = internalMutation({
  args: {
    webhookId: v.string(),
    topic: v.string(),
    shopifyDisputeId: v.string(),
    shopifyOrderId: v.string(),
    kind: v.union(v.literal("chargeback"), v.literal("inquiry")),
    status: v.string(),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    reason: v.optional(v.string()),
    initiatedAt: v.optional(v.number()),
    finalizedAt: v.optional(v.number()),
    // X-Shopify-Triggered-At, when Shopify sent it.
    eventAt: v.optional(v.number()),
  },
  returns: v.union(v.literal("accepted"), v.literal("duplicate"), v.literal("stale")),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("webhookEvents")
      .withIndex("by_source_key", (q) => q.eq("source", "shopify").eq("eventKey", args.webhookId))
      .first();
    if (seen) return "duplicate";
    const now = Date.now();
    await ctx.db.insert("webhookEvents", {
      source: "shopify",
      eventKey: args.webhookId,
      receivedAt: now,
      topic: args.topic,
      businessKey: args.shopifyOrderId,
      outcome: "accepted",
    });

    const eventAt = args.eventAt ?? now;
    const existing = await ctx.db
      .query("disputes")
      .withIndex("by_dispute", (q) => q.eq("shopifyDisputeId", args.shopifyDisputeId))
      .unique();
    // An older update that arrives after a newer one changes nothing.
    if (existing && existing.eventAt > eventAt) return "stale";
    const fields = {
      shopifyDisputeId: args.shopifyDisputeId,
      shopifyOrderId: args.shopifyOrderId,
      kind: args.kind,
      status: args.status,
      amountCents: args.amountCents,
      currency: args.currency,
      reason: args.reason,
      initiatedAt: args.initiatedAt ?? existing?.initiatedAt,
      finalizedAt: args.finalizedAt ?? existing?.finalizedAt,
      eventAt,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch("disputes", existing._id, fields);
    else await ctx.db.insert("disputes", { ...fields, createdAt: now });

    const order = await ctx.db
      .query("orders")
      .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", args.shopifyOrderId))
      .unique();
    if (order) {
      const fresh = await syncOrderEarnings(ctx, order._id);
      await notifyNewSales(ctx, order._id, fresh);
    }
    return "accepted";
  },
});

