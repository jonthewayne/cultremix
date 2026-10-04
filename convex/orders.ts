import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { orderGid } from "../shared/config/shopify";
import { linePool, recipientShares } from "./lib/economics";
import { allocateRefund } from "./lib/creatorPool";
import { ORDER_QUERY, normalizeOrder, type HydratedOrder, type RawOrder } from "./lib/shopify/orderQuery";
import {
  RECONCILE_FIRST_LOOKBACK_MS,
  RECONCILE_OVERLAP_MS,
  listUpdatedOrders,
} from "./lib/shopify/reconcile";
import { resolveLineage } from "./lib/shopLineage";
import { simulatesTestOrders } from "./lib/shopFlags";
import { crNumber } from "./lib/shopify/productSync";
import { configFor, orderLedger, syncOrderEarnings } from "./earnings";
import { retryDelay, shopifyAdminForAction } from "./shopify";
import { getViewerUser, isOwner } from "./identity";

// Shopify orders (V1 U10, "Order ingestion"). Every webhook is stored in the order's shopifyInbox
// entry with its payload before it's acknowledged; hydration then reads the whole order from the
// Admin API, and everything else (lines, refunds, cancellation, earnings, fulfillment) derives
// from that snapshot plus what's already stored. Arrival order doesn't matter.

export const PAYLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A hydration in flight holds its inbox entry this long before the cron may retry it.
const HYDRATION_LEASE_MS = 10 * 60 * 1000;
const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1000;
const MAX_INBOX_EVENTS = 50;
const CURSOR_KEY = "shopify.orders";

// ---- Webhook intake (called by /webhooks/shopify after the HMAC passes) ----

export const recordIgnoredWebhook = internalMutation({
  args: {
    source: v.union(v.literal("shopify"), v.literal("printful")),
    eventKey: v.string(),
    topic: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("webhookEvents")
      .withIndex("by_source_key", (q) => q.eq("source", args.source).eq("eventKey", args.eventKey))
      .first();
    if (seen) return null;
    await ctx.db.insert("webhookEvents", {
      source: args.source,
      eventKey: args.eventKey,
      receivedAt: Date.now(),
      topic: args.topic,
      outcome: "ignored",
      reason: args.reason,
    });
    return null;
  },
});

async function upsertInbox(
  ctx: MutationCtx,
  shopifyOrderId: string,
  event: Doc<"shopifyInbox">["events"][number],
): Promise<void> {
  const now = Date.now();
  const inbox = await ctx.db
    .query("shopifyInbox")
    .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", shopifyOrderId))
    .unique();
  if (inbox) {
    await ctx.db.patch("shopifyInbox", inbox._id, {
      events: [...inbox.events, event].slice(-MAX_INBOX_EVENTS),
      hydration: "pending",
      nextAttemptAt: now + HYDRATION_LEASE_MS,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("shopifyInbox", {
      shopifyOrderId,
      events: [event],
      hydration: "pending",
      attempts: 0,
      nextAttemptAt: now + HYDRATION_LEASE_MS,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.orders.hydrate, { shopifyOrderId });
}

export const ingestShopifyWebhook = internalMutation({
  args: {
    webhookId: v.string(),
    topic: v.string(),
    shopifyOrderId: v.string(),
    refundId: v.optional(v.string()),
    body: v.string(),
  },
  returns: v.union(v.literal("accepted"), v.literal("duplicate")),
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
    await ctx.db.insert("webhookPayloads", {
      source: "shopify",
      eventKey: args.webhookId,
      body: args.body,
      expiresAt: now + PAYLOAD_TTL_MS,
    });
    await upsertInbox(ctx, args.shopifyOrderId, {
      topic: args.topic,
      webhookId: args.webhookId,
      receivedAt: now,
      payloadKey: args.webhookId,
      refundId: args.refundId,
    });
    return "accepted";
  },
});

// ---- Hydration ----

const recipientValidator = v.object({
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
});

const hydratedOrderValidator = v.object({
  shopifyOrderId: v.string(),
  name: v.string(),
  test: v.boolean(),
  cancelledAt: v.union(v.number(), v.null()),
  updatedAt: v.union(v.number(), v.null()),
  financialState: v.string(),
  currency: v.string(),
  totalCents: v.number(),
  ref: v.union(v.string(), v.null()),
  economicEventAt: v.union(v.number(), v.null()),
  recipient: v.union(v.null(), recipientValidator),
  lines: v.array(
    v.object({
      lineItemId: v.string(),
      variantId: v.union(v.string(), v.null()),
      sku: v.union(v.string(), v.null()),
      quantity: v.number(),
      unitPriceCents: v.number(),
      discountCents: v.number(),
      workIdAttr: v.union(v.string(), v.null()),
      crAttr: v.union(v.string(), v.null()),
    }),
  ),
  refunds: v.array(
    v.object({
      refundId: v.string(),
      createdAt: v.number(),
      status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
      lines: v.array(
        v.object({ lineItemId: v.string(), quantity: v.number(), subtotalCents: v.number(), taxCents: v.number() }),
      ),
      shippingCents: v.number(),
      totalCents: v.number(),
    }),
  ),
});

// Drops undefined fields so the snapshot passes Convex argument validation.
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const hydrationFailed = internalMutation({
  args: { shopifyOrderId: v.string(), error: v.string(), countAttempt: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("shopifyInbox")
      .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", args.shopifyOrderId))
      .unique();
    if (!inbox) return null;
    const now = Date.now();
    const attempts = inbox.attempts + (args.countAttempt ? 1 : 0);
    await ctx.db.patch("shopifyInbox", inbox._id, {
      hydration: args.countAttempt ? "failed" : "pending",
      attempts,
      lastError: args.error.slice(0, 500),
      nextAttemptAt: now + (args.countAttempt ? retryDelay(attempts) : NOT_CONFIGURED_RETRY_MS),
      updatedAt: now,
    });
    return null;
  },
});

export const hydrate = internalAction({
  args: { shopifyOrderId: v.string() },
  returns: v.union(v.literal("applied"), v.literal("waiting"), v.literal("failed")),
  handler: async (ctx, args) => {
    const admin = shopifyAdminForAction(ctx);
    if (!admin) {
      await ctx.runMutation(internal.orders.hydrationFailed, {
        shopifyOrderId: args.shopifyOrderId,
        error: "Shopify is not configured yet.",
        countAttempt: false,
      });
      return "waiting";
    }
    try {
      const data = await admin.graphql<{ order: RawOrder | null }>(ORDER_QUERY, { id: orderGid(args.shopifyOrderId) });
      if (!data.order) throw new Error(`Shopify has no order ${args.shopifyOrderId}.`);
      const order = normalizeOrder(data.order);
      await ctx.runMutation(internal.orders.applyHydratedOrder, {
        shopDomain: admin.shopDomain,
        order: stripUndefined(order),
      });
      return "applied";
    } catch (error) {
      await ctx.runMutation(internal.orders.hydrationFailed, {
        shopifyOrderId: args.shopifyOrderId,
        error: error instanceof Error ? error.message : String(error),
        countAttempt: true,
      });
      return "failed";
    }
  },
});

type Recipient = { who: Id<"users">; roles: Array<"creator" | "family_root" | "upstream">; bps: number };

async function createItem(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  line: HydratedOrder["lines"][number],
  now: number,
): Promise<void> {
  const config = configFor(1);
  // The variant decides the work; the cart attributes are only a cross-check.
  const variant = line.variantId
    ? await ctx.db
        .query("workVariants")
        .withIndex("by_shopifyVariantId", (q) => q.eq("shopifyVariantId", line.variantId!))
        .first()
    : null;
  const work = variant ? await ctx.db.get("works", variant.workId) : null;
  const pool = linePool(
    { unitPriceCents: line.unitPriceCents, quantity: line.quantity, discountCents: line.discountCents },
    config,
  );
  let recipients: Array<Recipient> = [];
  let lineageSnapshot: Doc<"orderItems">["lineageSnapshot"];
  if (work) {
    lineageSnapshot = await resolveLineage(ctx.db, work);
    recipients = recipientShares(lineageSnapshot, config) as Array<Recipient>;
  }
  await ctx.db.insert("orderItems", {
    orderId,
    shopifyLineItemId: line.lineItemId,
    shopifyVariantId: line.variantId ?? undefined,
    sku: line.sku ?? undefined,
    workId: work?._id,
    variantId: variant?._id,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountCents: line.discountCents,
    configVersion: config.version,
    lineageSnapshot,
    recipients,
    baseCents: pool.baseCents,
    // An unmapped line pays no one; the order goes to needs_attention.
    poolCents: work ? pool.poolCents : 0,
    unitPoolCents: work ? pool.units : [],
    createdAt: now,
  });
}

// Fulfillment state before Printful is involved. Once a Printful order exists, fulfillment.ts
// owns the state.
function preFulfillmentState(
  order: Doc<"orders">,
  items: Array<Doc<"orderItems">>,
  refunds: Array<Doc<"refunds">>,
): { state: Doc<"orders">["fulfillmentState"]; reason?: string } {
  if (order.isTest && !order.simulated) return { state: "test_ignored" };
  if (order.cancelled) return { state: "canceled" };
  if (order.economicEventAt === undefined) return { state: "waiting" };
  const refundedQty = new Map<string, number>();
  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    for (const line of refund.lines) refundedQty.set(line.orderItemId, (refundedQty.get(line.orderItemId) ?? 0) + line.quantity);
  }
  const open = items.filter((item) => item.quantity - (refundedQty.get(item._id) ?? 0) > 0);
  if (items.length > 0 && open.length === 0) return { state: "canceled" };
  if (open.some((item) => !item.workId)) return { state: "needs_attention", reason: "A line isn't a CultRemix design." };
  return { state: "waiting" };
}

export const applyHydratedOrder = internalMutation({
  args: { shopDomain: v.string(), order: hydratedOrderValidator },
  returns: v.id("orders"),
  handler: async (ctx, args) => {
    const snapshot = args.order;
    const now = Date.now();
    let order = await ctx.db
      .query("orders")
      .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", snapshot.shopifyOrderId))
      .unique();
    const stale =
      order?.shopifyUpdatedAt !== undefined && snapshot.updatedAt !== null && snapshot.updatedAt < order.shopifyUpdatedAt;

    if (!order) {
      const simulated = snapshot.test && simulatesTestOrders();
      const id = await ctx.db.insert("orders", {
        shopifyOrderId: snapshot.shopifyOrderId,
        orderName: snapshot.name,
        shopDomain: args.shopDomain,
        isTest: snapshot.test,
        simulated,
        economicEventAt: snapshot.economicEventAt ?? undefined,
        financialState: snapshot.financialState,
        shopifyUpdatedAt: snapshot.updatedAt ?? undefined,
        cancelled: snapshot.cancelledAt !== null,
        cancelledAt: snapshot.cancelledAt ?? undefined,
        currency: snapshot.currency,
        totalCents: snapshot.totalCents,
        ref: snapshot.ref ?? undefined,
        recipient: snapshot.recipient ?? undefined,
        configVersion: configFor(1).version,
        fulfillmentState: "waiting",
        createdAt: now,
        updatedAt: now,
      });
      order = (await ctx.db.get("orders", id))!;
    } else if (!stale) {
      // Payment time is frozen once known; a cancellation is never undone.
      await ctx.db.patch("orders", order._id, {
        orderName: snapshot.name,
        financialState: snapshot.financialState,
        shopifyUpdatedAt: snapshot.updatedAt ?? order.shopifyUpdatedAt,
        economicEventAt: order.economicEventAt ?? snapshot.economicEventAt ?? undefined,
        cancelled: order.cancelled || snapshot.cancelledAt !== null,
        cancelledAt: order.cancelledAt ?? snapshot.cancelledAt ?? undefined,
        totalCents: snapshot.totalCents,
        ref: order.ref ?? snapshot.ref ?? undefined,
        recipient: snapshot.recipient ?? order.recipient,
        updatedAt: now,
      });
      order = (await ctx.db.get("orders", order._id))!;
    }
    const orderId = order._id;

    // Lines are created once, with lineage and config frozen at first sight.
    const existing = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(250);
    for (const line of snapshot.lines) {
      if (!existing.some((item) => item.shopifyLineItemId === line.lineItemId)) await createItem(ctx, orderId, line, now);
    }
    await syncOrderEarnings(ctx, orderId);

    // Refunds, oldest first: allocation is fixed at first sight; only the status moves after.
    const refunds = [...snapshot.refunds].sort((a, b) => a.createdAt - b.createdAt);
    for (const refund of refunds) {
      const row = await ctx.db
        .query("refunds")
        .withIndex("by_shopifyRefundId", (q) => q.eq("shopifyRefundId", refund.refundId))
        .unique();
      if (row) {
        if (row.status === "pending" && refund.status !== "pending") {
          await ctx.db.patch("refunds", row._id, {
            status: refund.status,
            succeededAt: refund.status === "succeeded" ? now : undefined,
          });
        }
        continue;
      }
      const ledger = await orderLedger(ctx, orderId, now);
      const allocation = allocateRefund(ledger, refund);
      await ctx.db.insert("refunds", {
        orderId,
        shopifyRefundId: refund.refundId,
        status: refund.status,
        createdAt: refund.createdAt,
        succeededAt: refund.status === "succeeded" ? now : undefined,
        lines: allocation.lines.map((line) => ({
          orderItemId: line.itemId as Id<"orderItems">,
          lineItemId: line.lineItemId,
          quantity: line.quantity,
          amountCents: line.amountCents,
          units: line.units.map((unit) => ({
            unit: unit.unit,
            cents: unit.cents,
            split: unit.split.map((part) => ({ who: part.who as Id<"users">, cents: part.cents })),
          })),
        })),
        unallocatedCents: allocation.unallocatedCents,
        shippingCents: allocation.shippingCents,
      });
      // Holds and reversals for this refund before the next one is allocated.
      await syncOrderEarnings(ctx, orderId);
    }
    await syncOrderEarnings(ctx, orderId);

    // Before Printful is involved, the order's state follows from the snapshot.
    if (order.printfulOrderId === undefined && (order.fulfillmentState === "waiting" || order.fulfillmentState === "needs_attention")) {
      const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(250);
      const storedRefunds = await ctx.db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(100);
      const next = preFulfillmentState(order, items, storedRefunds);
      if (next.state !== order.fulfillmentState || next.reason !== order.attentionReason) {
        await ctx.db.patch("orders", orderId, { fulfillmentState: next.state, attentionReason: next.reason, updatedAt: now });
      }
    }
    await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId });

    const inbox = await ctx.db
      .query("shopifyInbox")
      .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", snapshot.shopifyOrderId))
      .unique();
    if (inbox) {
      await ctx.db.patch("shopifyInbox", inbox._id, {
        hydration: "complete",
        orderId,
        lastError: undefined,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
    }
    return orderId;
  },
});

// ---- Reconciliation (cron, every 15 minutes) ----

export const reconcileCursor = internalQuery({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("shopCursors")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    return row ? Number(row.cursor) : null;
  },
});

export const noteUpdatedOrders = internalMutation({
  args: { orders: v.array(v.object({ shopifyOrderId: v.string(), updatedAt: v.number() })), cursor: v.union(v.null(), v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let queued = 0;
    for (const entry of args.orders) {
      const order = await ctx.db
        .query("orders")
        .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", entry.shopifyOrderId))
        .unique();
      if (order?.shopifyUpdatedAt !== undefined && order.shopifyUpdatedAt >= entry.updatedAt) continue;
      await upsertInbox(ctx, entry.shopifyOrderId, {
        topic: "reconcile",
        webhookId: `reconcile:${entry.updatedAt}`,
        receivedAt: now,
      });
      queued++;
    }
    if (args.cursor !== null) {
      const row = await ctx.db
        .query("shopCursors")
        .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
        .unique();
      if (row) await ctx.db.patch("shopCursors", row._id, { cursor: String(args.cursor), updatedAt: now });
      else await ctx.db.insert("shopCursors", { key: CURSOR_KEY, cursor: String(args.cursor), updatedAt: now });
    }
    return queued;
  },
});

// Inbox entries whose hydration is due again (failed with backoff, or waiting for keys).
export const retryDueHydrations = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const hydration of ["pending", "failed"] as const) {
      const due = await ctx.db
        .query("shopifyInbox")
        .withIndex("by_hydration_next", (q) => q.eq("hydration", hydration).lte("nextAttemptAt", now))
        .take(20);
      for (const inbox of due) {
        await ctx.db.patch("shopifyInbox", inbox._id, { nextAttemptAt: now + HYDRATION_LEASE_MS });
        await ctx.scheduler.runAfter(0, internal.orders.hydrate, { shopifyOrderId: inbox.shopifyOrderId });
        scheduled++;
      }
    }
    return scheduled;
  },
});

export const reconcile = internalAction({
  args: {},
  returns: v.object({ queued: v.number(), retried: v.number() }),
  handler: async (ctx) => {
    const retried: number = await ctx.runMutation(internal.orders.retryDueHydrations, {});
    const admin = shopifyAdminForAction(ctx);
    if (!admin) return { queued: 0, retried };
    const now = Date.now();
    const cursor: number | null = await ctx.runQuery(internal.orders.reconcileCursor, {});
    const since = cursor === null ? now - RECONCILE_FIRST_LOOKBACK_MS : cursor - RECONCILE_OVERLAP_MS;
    const { orders, complete } = await listUpdatedOrders(admin, since);
    const latest: number = orders.reduce((max, o) => Math.max(max, o.updatedAt), cursor ?? 0);
    const next: number | null = complete ? Math.max(latest, now - RECONCILE_OVERLAP_MS) : latest || null;
    const queued: number = await ctx.runMutation(internal.orders.noteUpdatedOrders, { orders, cursor: next });
    return { queued, retried };
  },
});

// Cron: raw payloads are kept 30 days.
export const purgeExpiredPayloads = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("webhookPayloads")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(200);
    for (const row of expired) await ctx.db.delete("webhookPayloads", row._id);
    return expired.length;
  },
});

// ---- Owner: /admin/orders ----

const adminOrderValidator = v.object({
  id: v.id("orders"),
  name: v.string(),
  createdAt: v.number(),
  test: v.boolean(),
  simulated: v.boolean(),
  paid: v.boolean(),
  cancelled: v.boolean(),
  financialState: v.string(),
  fulfillmentState: v.string(),
  printfulStatus: v.union(v.string(), v.null()),
  attentionReason: v.union(v.string(), v.null()),
  totalCents: v.number(),
  poolCents: v.number(),
  ref: v.union(v.string(), v.null()),
  lines: v.array(
    v.object({ cr: v.union(v.string(), v.null()), sku: v.union(v.string(), v.null()), quantity: v.number(), refunded: v.number() }),
  ),
  refunds: v.array(v.object({ status: v.string(), amountCents: v.number() })),
});

const inboxProblemValidator = v.object({
  shopifyOrderId: v.string(),
  hydration: v.string(),
  attempts: v.number(),
  lastError: v.union(v.string(), v.null()),
  updatedAt: v.number(),
});

export const adminList = query({
  args: {},
  returns: v.object({ orders: v.array(adminOrderValidator), inbox: v.array(inboxProblemValidator) }),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer || !isOwner(viewer)) throw new ConvexError({ code: "FORBIDDEN", message: "Owner only." });
    const orders = await ctx.db.query("orders").order("desc").take(50);
    const out = [];
    for (const order of orders) {
      const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100);
      const refunds = await ctx.db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(50);
      const lines = [];
      for (const item of items) {
        const work = item.workId ? await ctx.db.get("works", item.workId) : null;
        const refunded = refunds
          .filter((r) => r.status === "succeeded")
          .reduce((sum, r) => sum + r.lines.filter((l) => l.orderItemId === item._id).reduce((s, l) => s + l.quantity, 0), 0);
        lines.push({
          cr: work ? crNumber(work.crFamily, work.crExpression) : null,
          sku: item.sku ?? null,
          quantity: item.quantity,
          refunded,
        });
      }
      out.push({
        id: order._id,
        name: order.orderName ?? `#${order.shopifyOrderId}`,
        createdAt: order.createdAt,
        test: order.isTest,
        simulated: order.simulated,
        paid: order.economicEventAt !== undefined,
        cancelled: order.cancelled,
        financialState: order.financialState,
        fulfillmentState: order.fulfillmentState,
        printfulStatus: order.printfulStatus ?? null,
        attentionReason: order.attentionReason ?? null,
        totalCents: order.totalCents,
        poolCents: items.reduce((sum, item) => sum + item.poolCents, 0),
        ref: order.ref ?? null,
        lines,
        refunds: refunds.map((r) => ({
          status: r.status,
          amountCents: r.lines.reduce((sum, l) => sum + l.amountCents, 0) + r.shippingCents,
        })),
      });
    }
    const inbox = [];
    for (const hydration of ["failed", "pending"] as const) {
      const rows = await ctx.db
        .query("shopifyInbox")
        .withIndex("by_hydration_next", (q) => q.eq("hydration", hydration))
        .take(20);
      for (const row of rows) {
        inbox.push({
          shopifyOrderId: row.shopifyOrderId,
          hydration: row.hydration,
          attempts: row.attempts,
          lastError: row.lastError ?? null,
          updatedAt: row.updatedAt,
        });
      }
    }
    return { orders: out, inbox };
  },
});
