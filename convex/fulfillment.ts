import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { shipmentUnits } from "./lib/creatorPool";
import {
  PrintfulError,
  
  
  
  buildOrderRequest,
  createPrintful,
  hasShipped,
  isForward,
  printfulConfigFromEnv,
  shipmentFromPrintful,
  stateForStatus
} from "./lib/printful/client";
import { publicUrl } from "./lib/r2";
import { checkPrintFiles } from "./lib/printFingerprint";
import { advancePrep } from "./sales";
import { autoConfirmAllowedByEnv, autoConfirmFlagAllows } from "./lib/shopFlags";
import { catalogColorByCode } from "./lib/shopColors";
import { hasMark } from "./lib/shopProduct";
import { crNumber } from "./lib/shopify/productSync";
import { syncOrderEarnings } from "./earnings";
import { PAYLOAD_TTL_MS } from "./orders";
import type { PrintfulOrder, PrintfulOrderRequest, ShipmentRecord } from "./lib/printful/client";
import type { PrintSize } from "../shared/config/print-products";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { GenericDatabaseReader } from "convex/server";

// Printful fulfillment (V1 U10). `advance` is the one place that decides what happens next for an
// order; it claims a lease and schedules a single Printful call, whose outcome comes back through
// a mutation that releases the lease and advances again. Invariants:
// - One Printful order per Shopify order: external_id = the Shopify order ID; every create looks
//   the order up by external_id first; after an ambiguous create the order is only looked up,
//   never created again (15 minutes, then needs_attention).
// - Production only: a draft is confirmed after the 1-hour hold, when DEPLOYMENT_ENV=prod,
//   PRINTFUL_AUTO_CONFIRM=true, and the fulfillment.autoConfirm flag isn't off. Dev and staging
//   stop at drafts.
// - A draft can be cancelled or reduced automatically; once confirmed, a cancellation or refund
//   goes to the owner (needs_attention).

const HOLD_MS = 60 * 60 * 1000;
// Longer than an action can run, so a lease never expires under a call still in flight.
const LEASE_MS = 11 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1000;
const AMBIGUOUS_POLL_MS = 60 * 1000;
const AMBIGUOUS_WINDOW_MS = 15 * 60 * 1000;
const REFUND_PENDING_LIMIT_MS = 24 * 60 * 60 * 1000;

const CONFIRMED_STATES = ["submitted", "on_hold", "in_production", "partial"] as const;

type Order = Doc<"orders">;
type Db = GenericDatabaseReader<DataModel>;

function isConfirmed(state: Order["fulfillmentState"]): boolean {
  return (CONFIRMED_STATES as ReadonlyArray<string>).includes(state);
}

async function loadParts(db: Db, orderId: Id<"orders">) {
  const items = await db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(250);
  const refunds = await db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(100);
  return { items, refunds };
}

// Units still owed per line after succeeded refunds.
function openQuantities(items: Array<Doc<"orderItems">>, refunds: Array<Doc<"refunds">>): Map<Id<"orderItems">, number> {
  const out = new Map<Id<"orderItems">, number>();
  for (const item of items) out.set(item._id, item.quantity);
  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    for (const line of refund.lines) out.set(line.orderItemId, Math.max(0, (out.get(line.orderItemId) ?? 0) - line.quantity));
  }
  return out;
}

function printfulVariantFor(variant: Doc<"workVariants">): number | null {
  if (variant.printfulVariantId !== undefined) return variant.printfulVariantId;
  // Products synced before U0 filled in the catalog IDs pick them up from the config.
  return catalogColorByCode(variant.color)?.printfulVariantIds[variant.size as PrintSize] ?? null;
}

// "CR 101-002" for the first design on the order that was taken down, or null.
async function withdrawnWorkIn(db: Db, items: Array<Doc<"orderItems">>): Promise<string | null> {
  for (const item of items) {
    const work = item.workId ? await db.get("works", item.workId) : null;
    if (work?.status === "withdrawn") return `CR ${crNumber(work.crFamily, work.crExpression)}`;
  }
  return null;
}

// A print file the order sends, with the fingerprint it must still have (INV-10).
const fileValidator = v.object({ url: v.string(), sha256: v.string(), label: v.string() });
type FileCheck = Infer<typeof fileValidator>;

type CreatePlan =
  | { ok: true; request: PrintfulOrderRequest; files: Array<FileCheck> }
  | { ok: false; state: "needs_attention" | "manual_required" | "canceled"; reason?: string };

// What a create would send, or why the order can't go to Printful automatically.
async function createPlan(db: Db, order: Order): Promise<CreatePlan> {
  const { items, refunds } = await loadParts(db, order._id);
  const open = openQuantities(items, refunds);
  const lines: Parameters<typeof buildOrderRequest>[0]["lines"] = [];
  const files: Array<FileCheck> = [];
  for (const item of items) {
    const quantity = open.get(item._id) ?? 0;
    if (quantity === 0) continue;
    const work = item.workId ? await db.get("works", item.workId) : null;
    const variant = item.variantId ? await db.get("workVariants", item.variantId) : null;
    if (!work || !variant) return { ok: false, state: "needs_attention", reason: "A line isn't a CultRemix design." };
    const cr = `CR ${crNumber(work.crFamily, work.crExpression)}`;
    // A design taken down never goes to print on its own (INV-27); the owner decides.
    if (work.status === "withdrawn") {
      return { ok: false, state: "needs_attention", reason: `${cr} was taken down. Refund the buyer, or make the order in Printful by hand if it should still ship.` };
    }
    // The listing's print file and side; variants from before products could be chosen use the
    // work's Print Studio file on the front.
    const listing = variant.listingId ? await db.get("shopProducts", variant.listingId) : null;
    const printKey = variant.listingId ? listing?.printFile?.key : work.printKey;
    const printSha256 = variant.listingId ? listing?.printFile?.sha256 : work.printSha256;
    const placement = listing?.listing?.placement.side ?? "front";
    const url = publicUrl(printKey);
    if (!printKey) {
      // A file being made again (after a fingerprint check, or a new approval) is on its way.
      const reason =
        listing?.status === "preparing"
          ? listing.prepError
            ? `${cr}'s print file couldn't be made: ${listing.prepError}`
            : `${cr}'s print file is being made. The order goes to Printful once it's ready.`
          : `${cr} has no print file.`;
      return { ok: false, state: "needs_attention", reason };
    }
    if (!url || !/^https?:\/\//u.test(url)) {
      return { ok: false, state: "needs_attention", reason: `${cr}'s print file isn't at a public address yet.` };
    }
    if (!printSha256) {
      return { ok: false, state: "needs_attention", reason: `${cr}'s print file has no fingerprint to check it against.` };
    }
    const catalogVariantId = printfulVariantFor(variant);
    if (catalogVariantId === null) {
      return { ok: false, state: "needs_attention", reason: `${cr} ${variant.color} ${variant.size} has no Printful variant yet.` };
    }
    // A back print's chest mark goes on the front from its own file, checked like the main one.
    files.push({ url, sha256: printSha256, label: cr });
    let markUrl: string | undefined;
    if (listing?.listing && hasMark(listing.listing)) {
      const markFile = listing.markFile;
      markUrl = publicUrl(markFile?.key);
      if (!markFile || !markUrl || !/^https?:\/\//u.test(markUrl)) {
        return { ok: false, state: "needs_attention", reason: `${cr}'s chest mark file isn't ready yet. The order goes to Printful once it is.` };
      }
      files.push({ url: markUrl, sha256: markFile.sha256, label: `${cr}'s chest mark` });
    }
    lines.push({ lineItemId: item.shopifyLineItemId, catalogVariantId, quantity, printUrl: url, placement, ...(markUrl ? { markUrl } : {}) });
  }
  if (lines.length === 0) return { ok: false, state: "canceled" };
  const r = order.recipient;
  if (!r) {
    return {
      ok: false,
      state: "manual_required",
      reason: `No shipping address came through. Create it in Printful with external ID ${order.shopifyOrderId}.`,
    };
  }
  const recipient: PrintfulOrderRequest["recipient"] = {
    name: r.name,
    address1: r.address1,
    city: r.city,
    country_code: r.countryCode,
    zip: r.zip,
  };
  if (r.company) recipient.company = r.company;
  if (r.address2) recipient.address2 = r.address2;
  if (r.stateCode) recipient.state_code = r.stateCode;
  if (r.phone) recipient.phone = r.phone;
  if (r.email) recipient.email = r.email;
  return { ok: true, request: buildOrderRequest({ shopifyOrderId: order.shopifyOrderId, recipient, lines }), files };
}

const requestValidator = v.object({
  external_id: v.string(),
  shipping: v.literal("STANDARD"),
  recipient: v.object({
    name: v.string(),
    company: v.optional(v.string()),
    address1: v.string(),
    address2: v.optional(v.string()),
    city: v.string(),
    state_code: v.optional(v.string()),
    country_code: v.string(),
    zip: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  }),
  order_items: v.array(
    v.object({
      source: v.literal("catalog"),
      catalog_variant_id: v.number(),
      quantity: v.number(),
      external_id: v.string(),
      placements: v.array(
        v.object({
          placement: v.union(v.literal("front"), v.literal("back")),
          technique: v.literal("dtg"),
          layers: v.array(v.object({ type: v.literal("file"), url: v.string() })),
        }),
      ),
    }),
  ),
});

const opValidator = v.union(
  v.object({
    kind: v.literal("create"),
    shopifyOrderId: v.string(),
    // Absent: look up only (an ambiguous create, or an order the owner makes by hand).
    request: v.optional(requestValidator),
    // The request's print files, checked against their fingerprints just before the create.
    files: v.optional(v.array(fileValidator)),
    ambiguousSince: v.optional(v.number()),
  }),
  v.object({ kind: v.literal("delete"), printfulOrderId: v.number(), refundIds: v.array(v.id("refunds")) }),
  v.object({
    kind: v.literal("reduce"),
    printfulOrderId: v.number(),
    items: v.array(v.object({ printfulItemId: v.number(), quantity: v.number() })),
    refundIds: v.array(v.id("refunds")),
  }),
  v.object({ kind: v.literal("confirm"), printfulOrderId: v.number() }),
);

async function setAttention(ctx: MutationCtx, order: Order, reason: string, now: number) {
  await ctx.db.patch("orders", order._id, {
    fulfillmentState: "needs_attention",
    attentionReason: reason,
    leaseUntil: undefined,
    updatedAt: now,
  });
}

async function claim(ctx: MutationCtx, order: Order, op: Infer<typeof opValidator>, patch: Partial<Order>, now: number) {
  await ctx.db.patch("orders", order._id, { ...patch, leaseUntil: now + LEASE_MS, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.fulfillment.run, { orderId: order._id, op });
}

export const advance = internalMutation({
  args: { orderId: v.id("orders") },
  returns: v.null(),
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get("orders", orderId);
    if (!order) return null;
    const now = Date.now();
    if (order.leaseUntil !== undefined && order.leaseUntil > now) return null;
    const state = order.fulfillmentState;

    // Not in Printful yet (or a create whose outcome isn't known).
    if (order.printfulOrderId === undefined) {
      if (state === "test_ignored") return null;
      const eligible = order.economicEventAt !== undefined && !order.cancelled && !(order.isTest && !order.simulated);
      // A create that died mid-call, or one Printful never answered, may have made the order.
      const mayExist = state === "creating" || order.createAmbiguousSince !== undefined;
      if (state === "manual_required" || (!eligible && mayExist)) {
        // Look up only: the owner makes a manual_required order by hand, and an order that is no
        // longer eligible is never created, but either may already be in Printful.
        const ambiguousSince = state === "manual_required" ? order.createAmbiguousSince : (order.createAmbiguousSince ?? now);
        await claim(
          ctx,
          order,
          { kind: "create", shopifyOrderId: order.shopifyOrderId, ambiguousSince },
          { createAmbiguousSince: ambiguousSince },
          now,
        );
        return null;
      }
      if (!eligible || state === "canceled") return null;
      const plan = await createPlan(ctx.db, order);
      if (!plan.ok && order.createAmbiguousSince === undefined) {
        if (plan.state !== state || plan.reason !== order.attentionReason) {
          await ctx.db.patch("orders", orderId, {
            fulfillmentState: plan.state,
            attentionReason: plan.reason,
            fulfillmentError: undefined,
            leaseUntil: undefined,
            updatedAt: now,
          });
        }
        return null;
      }
      const ambiguousSince = order.createAmbiguousSince;
      await claim(
        ctx,
        order,
        {
          kind: "create",
          shopifyOrderId: order.shopifyOrderId,
          request: ambiguousSince === undefined && plan.ok ? plan.request : undefined,
          files: ambiguousSince === undefined && plan.ok ? plan.files : undefined,
          ambiguousSince,
        },
        { fulfillmentState: "creating", attentionReason: undefined },
        now,
      );
      return null;
    }

    const printfulOrderId = order.printfulOrderId;
    const { items, refunds } = await loadParts(ctx.db, orderId);
    const unapplied = refunds.filter((r) => r.status === "succeeded" && r.appliedAt === undefined);
    const pending = refunds.filter((r) => r.status === "pending");
    const open = openQuantities(items, refunds);
    const nothingLeft = items.length > 0 && items.every((item) => (open.get(item._id) ?? 0) === 0);

    if (state === "draft") {
      if (order.cancelled || nothingLeft) {
        await claim(ctx, order, { kind: "delete", printfulOrderId, refundIds: unapplied.map((r) => r._id) }, {}, now);
        return null;
      }
      if (unapplied.length > 0) {
        const changed = items.filter((item) => (open.get(item._id) ?? 0) < item.quantity);
        if (changed.some((item) => item.printfulItemId === undefined)) {
          await setAttention(ctx, order, "A refunded line can't be matched to the Printful draft. Adjust the draft by hand.", now);
          return null;
        }
        await claim(
          ctx,
          order,
          {
            kind: "reduce",
            printfulOrderId,
            items: changed.map((item) => ({ printfulItemId: item.printfulItemId!, quantity: open.get(item._id) ?? 0 })),
            refundIds: unapplied.map((r) => r._id),
          },
          {},
          now,
        );
        return null;
      }
      if (pending.length > 0) {
        if (pending.some((r) => now - r.createdAt > REFUND_PENDING_LIMIT_MS)) {
          await setAttention(ctx, order, "A refund has been pending for over a day; the draft is waiting on it.", now);
        }
        return null;
      }
      // A design taken down after the order was made: the draft isn't confirmed on its own (INV-27).
      const takenDown = await withdrawnWorkIn(ctx.db, items);
      if (takenDown) {
        await setAttention(ctx, order, `${takenDown} was taken down after this order was placed. Cancel the draft in Printful, or confirm it there by hand.`, now);
        return null;
      }
      if (order.holdUntil !== undefined && now < order.holdUntil) return null;
      if (!autoConfirmAllowedByEnv() || !(await autoConfirmFlagAllows(ctx))) return null;
      await claim(ctx, order, { kind: "confirm", printfulOrderId }, {}, now);
      return null;
    }

    // Confirmed: Printful may already be printing, so the owner decides.
    if (isConfirmed(state)) {
      if (order.cancelled) {
        await setAttention(ctx, order, "Cancelled in Shopify after Printful confirmed it. Cancel it in Printful if you can.", now);
        return null;
      }
      if (unapplied.length > 0) {
        for (const refund of unapplied) await ctx.db.patch("refunds", refund._id, { appliedAt: now });
        await setAttention(ctx, order, "Refunded after Printful confirmed it. Adjust the Printful order if you can.", now);
      }
    }
    return null;
  },
});

// ---- The Printful call, and its outcome ----

const failureKind = v.union(
  v.literal("unconfigured"),
  v.literal("transient"),
  v.literal("ambiguous"),
  v.literal("absent"),
  v.literal("lost"),
  v.literal("rejected"),
);

const printfulOrderValidator = v.object({
  id: v.number(),
  status: v.string(),
  storeId: v.string(),
  items: v.array(v.object({ id: v.number(), externalId: v.union(v.string(), v.null()) })),
});

function orderSummary(order: PrintfulOrder, storeId: string) {
  return {
    id: order.id,
    status: order.status,
    storeId,
    items: (order.order_items ?? []).map((item) => ({ id: item.id, externalId: item.external_id ?? null })),
  };
}

export const run = internalAction({
  args: { orderId: v.id("orders"), op: opValidator },
  returns: v.null(),
  handler: async (ctx, { orderId, op }) => {
    const config = printfulConfigFromEnv();
    const fail = (kind: Infer<typeof failureKind>, error: string) =>
      ctx.runMutation(internal.fulfillment.failed, { orderId, op: op.kind, kind, error });
    if (!config) {
      await fail("unconfigured", "Printful is not configured yet.");
      return null;
    }
    const printful = createPrintful({ config });
    try {
      switch (op.kind) {
        case "create": {
          const found = await printful.getOrderByExternalId(op.shopifyOrderId);
          if (found) {
            await ctx.runMutation(internal.fulfillment.recordOrder, { orderId, order: orderSummary(found, config.storeId) });
            return null;
          }
          if (!op.request) {
            if (op.ambiguousSince === undefined) await fail("absent", "Not in Printful yet.");
            else if (Date.now() - op.ambiguousSince >= AMBIGUOUS_WINDOW_MS) {
              await fail("lost", "Printful may have this order but can't find it by its Shopify ID. Check Printful before making it by hand.");
            } else await fail("ambiguous", "Waiting to see whether Printful made the order.");
            return null;
          }
          // INV-10: Printful gets the approved bytes. A file that changed or is gone is made again
          // and the order waits for it; one that can't be read right now is tried again later.
          const problems = await checkPrintFiles(op.files ?? []);
          const bad = problems.filter((problem) => problem.problem !== "unreadable");
          if (bad.length > 0) {
            await ctx.runMutation(internal.fulfillment.printFileChanged, {
              orderId,
              urls: bad.map((problem) => problem.url),
              reason: printFileReason(bad),
            });
            return null;
          }
          if (problems.length > 0) {
            await fail("transient", `Couldn't read ${problems[0].label}'s print file to check it: ${problems[0].detail}`);
            return null;
          }
          let created: PrintfulOrder;
          try {
            created = await printful.createOrder(op.request);
          } catch (error) {
            if (error instanceof PrintfulError && !error.ambiguous) {
              await fail("rejected", `Printful refused the order: ${error.message}`);
            } else {
              await fail("ambiguous", `No clear answer from Printful: ${error instanceof Error ? error.message : String(error)}`);
            }
            return null;
          }
          await ctx.runMutation(internal.fulfillment.recordOrder, { orderId, order: orderSummary(created, config.storeId) });
          return null;
        }
        case "delete": {
          await printful.deleteOrder(op.printfulOrderId);
          await ctx.runMutation(internal.fulfillment.draftDeleted, { orderId, refundIds: op.refundIds });
          return null;
        }
        case "reduce": {
          for (const item of op.items) {
            if (item.quantity === 0) await printful.deleteItem(op.printfulOrderId, item.printfulItemId);
            else await printful.setItemQuantity(op.printfulOrderId, item.printfulItemId, item.quantity);
          }
          await ctx.runMutation(internal.fulfillment.refundsApplied, { orderId, refundIds: op.refundIds });
          return null;
        }
        case "confirm": {
          const confirmed = await printful.confirmOrder(op.printfulOrderId);
          await ctx.runMutation(internal.fulfillment.confirmed, { orderId, status: confirmed?.status ?? "pending" });
          return null;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PrintfulError && !error.ambiguous) await fail("rejected", `Printful refused a ${op.kind}: ${message}`);
      else await fail("transient", message);
    }
    return null;
  },
});

export const failed = internalMutation({
  args: {
    orderId: v.id("orders"),
    op: v.union(v.literal("create"), v.literal("delete"), v.literal("reduce"), v.literal("confirm")),
    kind: failureKind,
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order) return null;
    const now = Date.now();
    const error = args.error.slice(0, 500);
    const retryAt = (ms: number) => now + ms;
    switch (args.kind) {
      case "absent":
        await ctx.db.patch("orders", order._id, { leaseUntil: undefined, updatedAt: now });
        return null;
      case "lost":
      case "rejected":
        // fulfillmentError marks it as Printful's answer, so the sweep doesn't retry it; a change
        // to the Shopify order (which re-runs advance) or the owner does.
        await ctx.db.patch("orders", order._id, {
          fulfillmentState: "needs_attention",
          attentionReason: error,
          fulfillmentError: error,
          leaseUntil: undefined,
          updatedAt: now,
        });
        return null;
      case "ambiguous": {
        const until = retryAt(AMBIGUOUS_POLL_MS);
        await ctx.db.patch("orders", order._id, {
          fulfillmentState: "creating",
          createAmbiguousSince: order.createAmbiguousSince ?? now,
          fulfillmentError: error,
          leaseUntil: until,
          updatedAt: now,
        });
        await ctx.scheduler.runAt(until, internal.fulfillment.advance, { orderId: order._id });
        return null;
      }
      case "unconfigured":
      case "transient": {
        // The 30-minute sweep retries; the lease keeps anything else from retrying sooner.
        const until = retryAt(args.kind === "unconfigured" ? NOT_CONFIGURED_RETRY_MS : RETRY_MS);
        // A create that never reached Printful goes back to waiting.
        const backToWaiting = args.op === "create" && order.fulfillmentState === "creating" && order.createAmbiguousSince === undefined;
        await ctx.db.patch("orders", order._id, {
          fulfillmentState: backToWaiting ? "waiting" : order.fulfillmentState,
          fulfillmentError: error,
          leaseUntil: until,
          updatedAt: now,
        });
        return null;
      }
    }
  },
});

// "CR 101-002's print file isn't the approved one (…). It's being made again from the same art; the
// order goes to Printful once the new file passes this check."
function printFileReason(problems: Array<{ label: string; problem: string; detail: string }>) {
  const first = problems[0];
  const what = first.problem === "missing" ? `is gone (${first.detail})` : `isn't the approved one (${first.detail})`;
  const more = problems.length > 1 ? ` ${problems.length - 1} more file${problems.length > 2 ? "s" : ""} too.` : "";
  return `${first.label}'s print file ${what}.${more} It's being made again from the same art; the order goes to Printful once the new file passes this check.`;
}

// INV-10, after the check before a create: a print file at one of the order's addresses isn't the
// approved file. The order waits with the reason and no fulfillmentError, so the 30-minute sweep plans
// it again; each product whose file it was gets a new file, rendered again from the art it was made
// from (no new upscale), so the order goes on its own once that file is ready. A paused product
// stays paused, without the file, until it's resumed. A file from before products could be chosen
// (works.printKey) can't be made again here; the order just waits for the owner.
export const printFileChanged = internalMutation({
  args: { orderId: v.id("orders"), urls: v.array(v.string()), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order || order.printfulOrderId !== undefined) return null;
    const now = Date.now();
    const { items } = await loadParts(ctx.db, order._id);
    const works = new Set<Id<"works">>();
    for (const item of items) {
      const variant = item.variantId ? await ctx.db.get("workVariants", item.variantId) : null;
      const listing = variant?.listingId ? await ctx.db.get("shopProducts", variant.listingId) : null;
      const url = publicUrl(listing?.printFile?.key);
      const markUrl = publicUrl(listing?.markFile?.key);
      if (!listing || !((url && args.urls.includes(url)) || (markUrl && args.urls.includes(markUrl)))) continue;
      // Both files are made again together.
      await ctx.db.patch("shopProducts", listing._id, {
        printFile: undefined,
        markFile: undefined,
        renderStartedAt: undefined,
        prepError: undefined,
        ...(listing.status === "paused" ? {} : { status: "preparing" as const }),
        updatedAt: now,
      });
      works.add(listing.workId);
    }
    for (const workId of works) await advancePrep(ctx, workId);
    await ctx.db.patch("orders", order._id, {
      fulfillmentState: "needs_attention",
      attentionReason: args.reason.slice(0, 500),
      fulfillmentError: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    return null;
  },
});

// Links the Printful order (made by us, found by external_id, or made by hand) to ours.
export const recordOrder = internalMutation({
  args: { orderId: v.id("orders"), order: printfulOrderValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order) return null;
    await linkPrintfulOrder(ctx, order, args.order, Date.now());
    return null;
  },
});

async function linkPrintfulOrder(
  ctx: MutationCtx,
  order: Order,
  printfulOrder: Infer<typeof printfulOrderValidator>,
  now: number,
): Promise<void> {
  if (order.printfulOrderId !== undefined && order.printfulOrderId !== printfulOrder.id) {
    await setAttention(ctx, order, `Printful has a second order (${printfulOrder.id}) for this one. Cancel the extra in Printful.`, now);
    return;
  }
  const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(250);
  for (const item of items) {
    const match = printfulOrder.items.find((p) => p.externalId === item.shopifyLineItemId);
    if (match && item.printfulItemId !== match.id) await ctx.db.patch("orderItems", item._id, { printfulItemId: match.id });
  }
  const holdUntil = Math.max(now, (order.economicEventAt ?? now) + HOLD_MS);
  const next = stateForStatus(printfulOrder.status) ?? "draft";
  await ctx.db.patch("orders", order._id, {
    printfulOrderId: printfulOrder.id,
    printfulStoreId: printfulOrder.storeId,
    printfulStatus: printfulOrder.status,
    printfulStatusAt: order.printfulStatusAt ?? now,
    fulfillmentState: next,
    attentionReason: next === "needs_attention" ? "Printful couldn't make this order." : undefined,
    fulfillmentError: undefined,
    createAmbiguousSince: undefined,
    holdUntil: order.holdUntil ?? holdUntil,
    leaseUntil: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId: order._id });
  if (next === "draft") await ctx.scheduler.runAt(order.holdUntil ?? holdUntil, internal.fulfillment.advance, { orderId: order._id });
}

export const draftDeleted = internalMutation({
  args: { orderId: v.id("orders"), refundIds: v.array(v.id("refunds")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.refundIds) await ctx.db.patch("refunds", id, { appliedAt: now });
    await ctx.db.patch("orders", args.orderId, {
      fulfillmentState: "canceled",
      printfulStatus: "deleted",
      printfulStatusAt: now,
      fulfillmentError: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const refundsApplied = internalMutation({
  args: { orderId: v.id("orders"), refundIds: v.array(v.id("refunds")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.refundIds) await ctx.db.patch("refunds", id, { appliedAt: now });
    await ctx.db.patch("orders", args.orderId, { fulfillmentError: undefined, leaseUntil: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId: args.orderId });
    return null;
  },
});

export const confirmed = internalMutation({
  args: { orderId: v.id("orders"), status: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order) return null;
    const now = Date.now();
    await ctx.db.patch("orders", order._id, {
      fulfillmentState: stateForStatus(args.status) ?? "submitted",
      printfulStatus: args.status,
      printfulStatusAt: now,
      confirmedAt: now,
      fulfillmentError: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    // A cancellation or refund that arrived during the call is the owner's now.
    await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId: order._id });
    return null;
  },
});

// ---- Status and shipments (webhooks and reconciliation) ----

// Applies a Printful status seen at `at`. Older reads, and moves backwards, are ignored; an order
// that needs attention leaves that state only when Printful recovers it from `failed`, or it ends.
async function applyStatus(ctx: MutationCtx, order: Order, status: string, at: number, reason?: string): Promise<void> {
  if (order.printfulStatusAt !== undefined && at < order.printfulStatusAt) return;
  const next = stateForStatus(status);
  const patch: Partial<Order> = { printfulStatus: status, printfulStatusAt: at, updatedAt: Date.now() };
  if (next && next !== order.fulfillmentState) {
    const current = order.fulfillmentState;
    const allowed =
      current === "needs_attention"
        ? order.printfulStatus === "failed" || next === "shipped" || next === "canceled"
        : current === "test_ignored"
          ? false
          : isForward(current, next);
    if (allowed) {
      patch.fulfillmentState = next;
      patch.attentionReason = next === "needs_attention" ? `Printful couldn't make this order${reason ? `: ${reason}` : "."}` : undefined;
    }
  }
  await ctx.db.patch("orders", order._id, patch);
}

const shipmentValidator = v.object({
  id: v.string(),
  shippedAt: v.number(),
  carrier: v.optional(v.string()),
  trackingNumber: v.optional(v.string()),
  trackingUrl: v.optional(v.string()),
  items: v.array(v.object({ printfulItemId: v.number(), quantity: v.number() })),
});

type Shipment = ShipmentRecord;

// Records a shipment once; its units are the lowest not yet shipped on each line, and their
// earnings start maturing from shippedAt.
async function recordShipment(ctx: MutationCtx, order: Order, shipment: Shipment): Promise<boolean> {
  const seen = await ctx.db
    .query("orderShipments")
    .withIndex("by_printfulShipmentId", (q) => q.eq("printfulShipmentId", shipment.id))
    .first();
  if (seen) return false;
  const items = await ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(250);
  const earlier = await ctx.db.query("orderShipments").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100);
  const lines: Doc<"orderShipments">["lines"] = [];
  for (const part of shipment.items) {
    const item = items.find((i) => i.printfulItemId === part.printfulItemId);
    if (!item) continue;
    const already = [...earlier.flatMap((s) => s.lines), ...lines]
      .filter((l) => l.orderItemId === item._id)
      .reduce((sum, l) => sum + (l.toUnit - l.fromUnit + 1), 0);
    const units = shipmentUnits(already, part.quantity, item.quantity);
    if (units) lines.push({ orderItemId: item._id, ...units });
  }
  const shipmentId = await ctx.db.insert("orderShipments", {
    orderId: order._id,
    printfulShipmentId: shipment.id,
    shippedAt: shipment.shippedAt,
    lines,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    shopifyState: "pending",
    shopifyAttempts: 0,
    shopifyNextAt: Date.now(),
  });
  await syncOrderEarnings(ctx, order._id);
  // Shopify gets the tracking and emails the buyer (convex/shopifyFulfill.ts).
  await ctx.scheduler.runAfter(0, internal.shopifyFulfill.run, { shipmentId });
  return true;
}

async function findOrder(ctx: MutationCtx, printfulOrderId: number | undefined, externalId: string | undefined) {
  if (printfulOrderId !== undefined) {
    const byId = await ctx.db
      .query("orders")
      .withIndex("by_printfulOrderId", (q) => q.eq("printfulOrderId", printfulOrderId))
      .first();
    if (byId) return byId;
  }
  if (externalId) {
    return ctx.db
      .query("orders")
      .withIndex("by_shopifyOrderId", (q) => q.eq("shopifyOrderId", externalId))
      .unique();
  }
  return null;
}

export const ingestPrintfulEvent = internalMutation({
  args: {
    eventKey: v.string(),
    type: v.string(),
    body: v.string(),
    storeId: v.string(),
    occurredAt: v.number(),
    printfulOrderId: v.optional(v.number()),
    externalId: v.optional(v.string()),
    status: v.optional(v.string()),
    reason: v.optional(v.string()),
    items: v.optional(v.array(v.object({ id: v.number(), externalId: v.union(v.string(), v.null()) }))),
    shipment: v.optional(shipmentValidator),
  },
  returns: v.union(v.literal("accepted"), v.literal("duplicate"), v.literal("ignored")),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("webhookEvents")
      .withIndex("by_source_key", (q) => q.eq("source", "printful").eq("eventKey", args.eventKey))
      .first();
    if (seen) return "duplicate";
    const now = Date.now();
    let order = await findOrder(ctx, args.printfulOrderId, args.externalId);
    await ctx.db.insert("webhookEvents", {
      source: "printful",
      eventKey: args.eventKey,
      receivedAt: now,
      topic: args.type,
      businessKey: args.externalId ?? (args.printfulOrderId !== undefined ? String(args.printfulOrderId) : undefined),
      outcome: order ? "accepted" : "ignored",
      reason: order ? undefined : "unknown order",
    });
    await ctx.db.insert("webhookPayloads", { source: "printful", eventKey: args.eventKey, body: args.body, expiresAt: now + PAYLOAD_TTL_MS });
    if (!order) return "ignored";

    // An order made by hand (or a create whose answer was lost) is linked by its external_id.
    if (order.printfulOrderId === undefined && args.printfulOrderId !== undefined && args.status) {
      await linkPrintfulOrder(ctx, order, { id: args.printfulOrderId, status: args.status, storeId: args.storeId, items: args.items ?? [] }, now);
      order = (await ctx.db.get("orders", order._id))!;
    }
    if (order.printfulOrderId === undefined || order.printfulOrderId !== args.printfulOrderId) return "ignored";
    if (args.status) await applyStatus(ctx, order, args.status, args.occurredAt, args.reason);
    if (args.shipment) await recordShipment(ctx, (await ctx.db.get("orders", order._id))!, args.shipment);
    await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId: order._id });
    return "accepted";
  },
});

// ---- Reconciliation (cron, every 30 minutes) ----

const SWEEP_TAKE = 25;

// Orders the cron advances (work that may be due) or polls from Printful (confirmed and drafts).
export const dueForReconcile = internalQuery({
  args: {},
  returns: v.object({
    advance: v.array(v.id("orders")),
    poll: v.array(v.object({ orderId: v.id("orders"), printfulOrderId: v.number() })),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const advance: Array<Id<"orders">> = [];
    const poll: Array<{ orderId: Id<"orders">; printfulOrderId: number }> = [];
    for (const state of ["waiting", "creating", "needs_attention", "manual_required", "draft"] as const) {
      const rows = await ctx.db
        .query("orders")
        .withIndex("by_fulfillmentState_updated", (q) => q.eq("fulfillmentState", state))
        .take(SWEEP_TAKE);
      for (const order of rows) {
        if (order.leaseUntil !== undefined && order.leaseUntil > now) continue;
        if (state === "waiting" && (order.economicEventAt === undefined || order.cancelled)) continue;
        if (state === "needs_attention" && order.fulfillmentError !== undefined) continue;
        if (order.printfulOrderId === undefined) advance.push(order._id);
        else if (state === "draft") advance.push(order._id);
      }
    }
    for (const state of [...CONFIRMED_STATES, "draft"] as const) {
      const rows = await ctx.db
        .query("orders")
        .withIndex("by_fulfillmentState_updated", (q) => q.eq("fulfillmentState", state))
        .take(SWEEP_TAKE);
      for (const order of rows) {
        if (order.printfulOrderId !== undefined) poll.push({ orderId: order._id, printfulOrderId: order.printfulOrderId });
      }
    }
    return { advance, poll };
  },
});

export const applyPolled = internalMutation({
  args: {
    orderId: v.id("orders"),
    status: v.union(v.string(), v.null()),
    shipments: v.array(shipmentValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("orders", args.orderId);
    if (!order) return null;
    const now = Date.now();
    if (args.status === null) {
      // Gone from Printful: a deleted draft, or something to look at.
      if (order.fulfillmentState !== "canceled") {
        await setAttention(ctx, order, "Printful no longer has this order.", now);
      }
      return null;
    }
    await applyStatus(ctx, order, args.status, now);
    for (const shipment of args.shipments) await recordShipment(ctx, (await ctx.db.get("orders", order._id))!, shipment);
    // Polling touches updatedAt so the sweep moves on to other orders next time.
    await ctx.db.patch("orders", order._id, { updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.fulfillment.advance, { orderId: order._id });
    return null;
  },
});

export const reconcile = internalAction({
  args: {},
  returns: v.object({ advanced: v.number(), polled: v.number() }),
  handler: async (ctx) => {
    const due: { advance: Array<Id<"orders">>; poll: Array<{ orderId: Id<"orders">; printfulOrderId: number }> } =
      await ctx.runQuery(internal.fulfillment.dueForReconcile, {});
    for (const orderId of due.advance) await ctx.runMutation(internal.fulfillment.advance, { orderId });
    const config = printfulConfigFromEnv();
    if (!config) return { advanced: due.advance.length, polled: 0 };
    const printful = createPrintful({ config });
    let polled = 0;
    for (const { orderId, printfulOrderId } of due.poll) {
      try {
        const order = await printful.getOrder(printfulOrderId);
        const shipments = order ? await printful.listShipments(printfulOrderId) : [];
        const now = Date.now();
        await ctx.runMutation(internal.fulfillment.applyPolled, {
          orderId,
          status: order?.status ?? null,
          shipments: shipments.filter(hasShipped).map((s) => shipmentFromPrintful(s, now)),
        });
        polled++;
      } catch {
        // Unreachable this time; the next sweep tries again.
      }
    }
    return { advanced: due.advance.length, polled };
  },
});
