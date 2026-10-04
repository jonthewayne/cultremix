import { defineTable } from "convex/server";
import { v } from "convex/values";

// Shop tables (V1 U9/U10): Shopify products and orders, Printful fulfillment, and creator
// earnings. Names follow the V1 plan's data model; anything the plan doesn't name is noted here.

const lineageRoot = v.union(
  v.object({ kind: v.literal("original"), creator: v.string() }),
  v.object({ kind: v.literal("fork"), creator: v.string(), parentCreator: v.string() }),
);

// EconomicLineage (convex/lib/economics.ts) frozen on an order line at its economic event time.
export const lineageValidator = v.union(
  v.object({ kind: v.literal("original"), creator: v.string() }),
  v.object({ kind: v.literal("fork"), creator: v.string(), parentCreator: v.string() }),
  v.object({ kind: v.literal("variation"), creator: v.string(), root: lineageRoot }),
);

export const fulfillmentStateValidator = v.union(
  v.literal("waiting"), // not paid yet
  v.literal("creating"), // Printful create in flight (or an ambiguous create being polled)
  v.literal("draft"), // a Printful draft exists; production confirms it after the hold
  v.literal("submitted"), // confirmed: Printful pending / inreview
  v.literal("on_hold"),
  v.literal("in_production"),
  v.literal("partial"),
  v.literal("shipped"),
  v.literal("canceled"),
  v.literal("needs_attention"),
  v.literal("manual_required"),
  v.literal("test_ignored"),
);

export const earningStateValidator = v.union(
  v.literal("pending"),
  v.literal("held"),
  v.literal("available"),
  v.literal("paid"),
  v.literal("reversed"),
);

const roleValidator = v.union(v.literal("creator"), v.literal("family_root"), v.literal("upstream"));

// One unit's reversal cents and how they split among its recipients, fixed when the refund is seen.
const unitCents = v.object({
  unit: v.number(),
  cents: v.number(),
  split: v.array(v.object({ who: v.id("users"), cents: v.number() })),
});

export const shopTables = {
  // One Shopify product per published work, by handle cr-FFF-EEE. (The plan's works.commerceStatus
  // lives here so the works table stays untouched.)
  shopProducts: defineTable({
    workId: v.id("works"),
    handle: v.string(),
    status: v.union(v.literal("pending"), v.literal("live"), v.literal("failed")),
    shopifyProductId: v.optional(v.string()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    syncedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_work", ["workId"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // Reverse lookup from a Shopify variant (GID) to the work, color, and size it prints.
  workVariants: defineTable({
    workId: v.id("works"),
    shopifyVariantId: v.string(),
    sku: v.string(),
    color: v.string(),
    size: v.string(),
    printfulVariantId: v.optional(v.number()),
    priceCents: v.number(),
  })
    .index("by_shopifyVariantId", ["shopifyVariantId"])
    .index("by_work", ["workId"])
    .index("by_sku", ["sku"]),

  // The Admin API's client-credentials token (24h), shared across actions. Internal only.
  shopifyTokens: defineTable({
    shopDomain: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_shop", ["shopDomain"]),

  // Cursors for the reconciliation crons (key "shopify.orders").
  shopCursors: defineTable({
    key: v.string(),
    cursor: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Every webhook delivery seen, accepted or ignored, deduplicated by source + event key.
  webhookEvents: defineTable({
    source: v.union(v.literal("shopify"), v.literal("printful")),
    eventKey: v.string(),
    receivedAt: v.number(),
    topic: v.optional(v.string()),
    businessKey: v.optional(v.string()),
    outcome: v.union(v.literal("accepted"), v.literal("ignored")),
    reason: v.optional(v.string()),
  })
    .index("by_source_key", ["source", "eventKey"])
    .index("by_source_received", ["source", "receivedAt"]),

  // Raw webhook bodies, kept 30 days for replay (admin only).
  webhookPayloads: defineTable({
    source: v.union(v.literal("shopify"), v.literal("printful")),
    eventKey: v.string(),
    body: v.string(),
    expiresAt: v.number(),
  })
    .index("by_source_key", ["source", "eventKey"])
    .index("by_expiresAt", ["expiresAt"]),

  // One entry per Shopify order, written before any webhook is acknowledged. The orders row is
  // created only when hydration from the Admin API succeeds.
  shopifyInbox: defineTable({
    shopifyOrderId: v.string(),
    events: v.array(
      v.object({
        topic: v.string(),
        webhookId: v.string(),
        receivedAt: v.number(),
        payloadKey: v.optional(v.string()),
        refundId: v.optional(v.string()),
      }),
    ),
    hydration: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed")),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    orderId: v.optional(v.id("orders")),
    updatedAt: v.number(),
  })
    .index("by_shopifyOrderId", ["shopifyOrderId"])
    .index("by_hydration_next", ["hydration", "nextAttemptAt"]),

  orders: defineTable({
    shopifyOrderId: v.string(),
    orderName: v.optional(v.string()),
    shopDomain: v.string(),
    isTest: v.boolean(),
    // Earnings from a test order in dev or staging: labeled "Test", never paid.
    simulated: v.boolean(),
    economicEventAt: v.optional(v.number()),
    financialState: v.string(),
    // Shopify's updatedAt for the snapshot last applied; older snapshots are ignored.
    shopifyUpdatedAt: v.optional(v.number()),
    cancelled: v.boolean(),
    cancelledAt: v.optional(v.number()),
    currency: v.string(),
    totalCents: v.number(),
    ref: v.optional(v.string()),
    // The shipping recipient Printful needs (admin only).
    recipient: v.optional(
      v.object({
        name: v.string(),
        company: v.optional(v.string()),
        address1: v.string(),
        address2: v.optional(v.string()),
        city: v.string(),
        stateCode: v.optional(v.string()),
        countryCode: v.string(),
        zip: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),
    configVersion: v.optional(v.number()),
    printfulOrderId: v.optional(v.number()),
    printfulStatus: v.optional(v.string()),
    fulfillmentState: fulfillmentStateValidator,
    attentionReason: v.optional(v.string()),
    holdUntil: v.optional(v.number()),
    createLeaseUntil: v.optional(v.number()),
    createAmbiguousSince: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_shopifyOrderId", ["shopifyOrderId"])
    .index("by_printfulOrderId", ["printfulOrderId"])
    .index("by_fulfillmentState_updated", ["fulfillmentState", "updatedAt"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    shopifyLineItemId: v.string(),
    shopifyVariantId: v.optional(v.string()),
    sku: v.optional(v.string()),
    workId: v.optional(v.id("works")),
    variantId: v.optional(v.id("workVariants")),
    quantity: v.number(),
    unitPriceCents: v.number(),
    discountCents: v.number(),
    configVersion: v.number(),
    lineageSnapshot: v.optional(lineageValidator),
    recipients: v.array(v.object({ who: v.id("users"), roles: v.array(roleValidator), bps: v.number() })),
    baseCents: v.number(),
    poolCents: v.number(),
    unitPoolCents: v.array(v.number()),
    printfulItemId: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_work", ["workId"]),

  // A refund's unit allocation is fixed when first seen; reversals are written only once its
  // refund transactions succeed (KTD-18).
  refunds: defineTable({
    orderId: v.id("orders"),
    shopifyRefundId: v.string(),
    status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
    createdAt: v.number(),
    succeededAt: v.optional(v.number()),
    lines: v.array(
      v.object({
        orderItemId: v.id("orderItems"),
        lineItemId: v.string(),
        quantity: v.number(),
        amountCents: v.number(),
        // Pool cents reversed per unit.
        units: v.array(unitCents),
      }),
    ),
    unallocatedCents: v.number(),
    shippingCents: v.number(),
    // Set once a succeeded refund has been applied to fulfillment (draft reduced, or the order
    // flagged for the owner). Earnings are applied idempotently from the allocation above.
    appliedAt: v.optional(v.number()),
  })
    .index("by_order", ["orderId"])
    .index("by_shopifyRefundId", ["shopifyRefundId"]),

  // Units ship in ascending unit number; each shipped unit matures 30 days after shippedAt.
  orderShipments: defineTable({
    orderId: v.id("orders"),
    printfulShipmentId: v.string(),
    shippedAt: v.number(),
    lines: v.array(v.object({ orderItemId: v.id("orderItems"), fromUnit: v.number(), toUnit: v.number() })),
    carrier: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    trackingUrl: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_printfulShipmentId", ["printfulShipmentId"]),

  // One row per (line, unit, recipient) sale, plus negative reversal rows. Balances are sums by
  // state: Pending = pending + held, Available, Paid.
  earnings: defineTable({
    recipientId: v.id("users"),
    orderId: v.id("orders"),
    orderItemId: v.id("orderItems"),
    unit: v.number(),
    kind: v.union(v.literal("sale"), v.literal("reversal")),
    refundId: v.optional(v.id("refunds")),
    reason: v.optional(v.union(v.literal("refund"), v.literal("cancel"))),
    roles: v.array(roleValidator),
    amountCents: v.number(),
    state: earningStateValidator,
    holdReason: v.optional(v.union(v.literal("refund"), v.literal("not_creator"))),
    simulated: v.boolean(),
    maturesAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_recipient_state", ["recipientId", "state"])
    .index("by_recipient_created", ["recipientId", "createdAt"])
    .index("by_orderItem_unit", ["orderItemId", "unit"])
    .index("by_order", ["orderId"])
    .index("by_state_maturesAt", ["state", "maturesAt"]),
};
