import { defineTable } from "convex/server";
import { v } from "convex/values";
import { garmentKindValidator, printAreaValidator, relativePlacementValidator } from "./merch";

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

// What a work sells as on one product, fixed when the owner approves it for sale (convex/sales.ts):
// the product, where the design sits on it, the print area on that side, its prices, and its colors
// with their Printful variant ids. Approving again refreshes it; later product changes leave it alone.
export const listingValidator = v.object({
  merchProductId: v.optional(v.id("merchProducts")),
  printfulProductId: v.number(),
  // "printful-<id>" (convex/lib/shopProduct.ts).
  productKey: v.string(),
  kind: garmentKindValidator,
  name: v.string(),
  detail: v.optional(v.string()),
  placement: relativePlacementValidator,
  // The print area on the placement's side, in inches.
  printArea: printAreaValidator,
  // S-XL and 2XL, a back print's extra included.
  priceCents: v.number(),
  largePriceCents: v.number(),
  colors: v.array(
    v.object({
      key: v.string(),
      code: v.string(),
      name: v.string(),
      hex: v.string(),
      variants: v.array(v.object({ size: v.string(), id: v.number() })),
    }),
  ),
});

// A listing's print file: the design placed on that product's whole print area at 300 DPI, the
// size Printful expects for the placement, so Printful puts it where its creator did.
export const listingFileValidator = v.object({
  key: v.string(),
  previewKey: v.optional(v.string()),
  sha256: v.string(),
  widthPx: v.number(),
  heightPx: v.number(),
  // The Print Studio version it was made from.
  versionId: v.id("printVersions"),
  placement: v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number(), heightIn: v.number() }),
  dpi: v.number(),
  grade: v.union(v.literal("good"), v.literal("great")),
  warnings: v.array(v.string()),
  madeAt: v.number(),
});

export const shopTables = {
  // One Shopify product per published work and product it's sold on, by handle
  // cr-FFF-EEE-<printful id>. (The plan's works.commerceStatus lives here so the works table stays
  // untouched.)
  shopProducts: defineTable({
    workId: v.id("works"),
    handle: v.string(),
    // "printful-<id>": the product this row sells the work on. Absent on rows from before products
    // could be chosen.
    productKey: v.optional(v.string()),
    // preparing: approved, its print file is being made. pending: waiting for Shopify. live: on sale
    // (once checkout is on). failed: Shopify refused; retried with backoff. paused: taken off sale.
    status: v.union(
      v.literal("preparing"),
      v.literal("pending"),
      v.literal("live"),
      v.literal("failed"),
      v.literal("paused"),
    ),
    listing: v.optional(listingValidator),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
    // Why the print file couldn't be made, while preparing.
    prepError: v.optional(v.string()),
    printFile: v.optional(listingFileValidator),
    // Set while its print file is being made.
    renderStartedAt: v.optional(v.number()),
    shopifyProductId: v.optional(v.string()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    syncedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_work", ["workId"])
    .index("by_work_product", ["workId", "productKey"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // Reverse lookup from a Shopify variant (GID) to the work, product, color, and size it prints.
  workVariants: defineTable({
    workId: v.id("works"),
    // The listing (shopProducts row) it belongs to, which holds the print file and side. Absent on
    // rows from before products could be chosen.
    listingId: v.optional(v.id("shopProducts")),
    productKey: v.optional(v.string()),
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

  // Shopify Payments disputes (chargebacks and inquiries) from the disputes webhooks (convex/disputes.ts),
  // one row per dispute. Earnings read them by order (convex/lib/disputes.ts, INV-23): an open one
  // holds the order's earnings, and a lost chargeback reverses them. status is Shopify's, lowercase.
  disputes: defineTable({
    shopifyDisputeId: v.string(),
    shopifyOrderId: v.string(),
    kind: v.union(v.literal("chargeback"), v.literal("inquiry")),
    status: v.string(),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    reason: v.optional(v.string()),
    initiatedAt: v.optional(v.number()),
    finalizedAt: v.optional(v.number()),
    // When Shopify sent the update this row reflects (X-Shopify-Triggered-At, else when it arrived),
    // so an older update that arrives late doesn't undo a newer one.
    eventAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dispute", ["shopifyDisputeId"])
    .index("by_shopifyOrder", ["shopifyOrderId"]),

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
    // Printful: the store the order was sent to, its ID there, and its status verbatim (with the
    // time of the event or read that set it, so an older event can't overwrite a newer one).
    printfulStoreId: v.optional(v.string()),
    printfulOrderId: v.optional(v.number()),
    printfulStatus: v.optional(v.string()),
    printfulStatusAt: v.optional(v.number()),
    fulfillmentState: fulfillmentStateValidator,
    attentionReason: v.optional(v.string()),
    // The stuck state and reason the owner and ops were last told about (convex/orderAlerts.ts).
    alertedFor: v.optional(v.string()),
    // The last transient Printful problem (unreachable, not configured); cleared on success.
    fulfillmentError: v.optional(v.string()),
    // Production confirms no earlier than this (1 hour after payment).
    holdUntil: v.optional(v.number()),
    // A Printful call in flight holds the order until this time.
    leaseUntil: v.optional(v.number()),
    // Set when a create may have reached Printful without an answer: from then on the order is
    // only looked up by external_id, never created again.
    createAmbiguousSince: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    // Its personal data (recipient, raw webhook bodies) was removed (convex/privacy.ts); a later
    // Shopify read doesn't bring it back.
    redactedAt: v.optional(v.number()),
    // A customer asked for removal while the order still needed its address for Printful.
    redactRequestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_shopifyOrderId", ["shopifyOrderId"])
    .index("by_printfulOrderId", ["printfulOrderId"])
    .index("by_fulfillmentState_updated", ["fulfillmentState", "updatedAt"])
    .index("by_redactRequested", ["redactRequestedAt"]),

  // Money sent to a creator for their Available earnings (convex/payouts.ts): the owner sends it
  // (USDC on Monad, a bank transfer, or another way), then records it here with its reference, and
  // the earnings it covered become Paid.
  payouts: defineTable({
    recipientId: v.id("users"),
    amountCents: v.number(),
    rows: v.number(),
    method: v.union(v.literal("usdc"), v.literal("bank"), v.literal("other")),
    // A transaction hash, transfer id, or note.
    reference: v.string(),
    paidBy: v.id("users"),
    paidAt: v.number(),
  })
    .index("by_recipient_paidAt", ["recipientId", "paidAt"])
    .index("by_paidAt", ["paidAt"]),

  // What the last "Connect Printful" or "Connect Shopify" in Admin found (convex/integrations.ts),
  // and Printful's webhook signing key from its webhook setup. Internal only: no public function
  // returns webhookSecret. PRINTFUL_WEBHOOK_SECRET in the env, when set, wins over it.
  integrations: defineTable({
    name: v.union(v.literal("printful"), v.literal("shopify")),
    connectedAt: v.number(),
    note: v.string(),
    webhookSecret: v.optional(v.string()),
  }).index("by_name", ["name"]),

  // Shopify's privacy webhooks as received (convex/privacy.ts). No customer email or phone is kept.
  privacyRequests: defineTable({
    webhookId: v.string(),
    topic: v.union(v.literal("customers/data_request"), v.literal("customers/redact"), v.literal("shop/redact")),
    shopDomain: v.string(),
    customerId: v.optional(v.string()),
    // The Shopify order ids it names.
    orderIds: v.array(v.string()),
    receivedAt: v.number(),
    // A data request stays open until the owner sends the customer their data; a redaction is done
    // when received (its note says what waits for Printful).
    status: v.union(v.literal("open"), v.literal("done")),
    doneAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_webhookId", ["webhookId"])
    .index("by_status", ["status", "receivedAt"]),

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
    // The Shopify fulfillment with this tracking (convex/shopifyFulfill.ts), which sends the buyer
    // Shopify's shipping email. skipped: Shopify had nothing left open (fulfilled by hand).
    shopifyState: v.optional(v.union(v.literal("pending"), v.literal("done"), v.literal("skipped"), v.literal("failed"))),
    shopifyFulfillmentId: v.optional(v.string()),
    shopifyAttempts: v.optional(v.number()),
    shopifyError: v.optional(v.string()),
    shopifyNextAt: v.optional(v.number()),
  })
    .index("by_order", ["orderId"])
    .index("by_printfulShipmentId", ["printfulShipmentId"])
    .index("by_shopify_next", ["shopifyState", "shopifyNextAt"]),

  // One row per (line, unit, recipient) sale, plus negative reversal rows. Balances are sums by
  // state: Pending = pending + held, Available, Paid.
  earnings: defineTable({
    recipientId: v.id("users"),
    orderId: v.id("orders"),
    orderItemId: v.id("orderItems"),
    unit: v.number(),
    kind: v.union(v.literal("sale"), v.literal("reversal")),
    refundId: v.optional(v.id("refunds")),
    reason: v.optional(v.union(v.literal("refund"), v.literal("cancel"), v.literal("dispute"))),
    roles: v.array(roleValidator),
    amountCents: v.number(),
    state: earningStateValidator,
    holdReason: v.optional(v.union(v.literal("refund"), v.literal("not_creator"), v.literal("dispute"))),
    simulated: v.boolean(),
    maturesAt: v.optional(v.number()),
    // The payout that paid it (convex/payouts.ts), once paid.
    payoutId: v.optional(v.id("payouts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_recipient_state", ["recipientId", "state"])
    .index("by_recipient_created", ["recipientId", "createdAt"])
    .index("by_orderItem_unit", ["orderItemId", "unit"])
    .index("by_order", ["orderId"])
    .index("by_state_maturesAt", ["state", "maturesAt"]),
};
