import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ECONOMIC_CONFIG_V1, type EconomicConfig, type RecipientShare } from "./lib/economics";
import { saleSplits, type LineLedger, type UnitStatus } from "./lib/creatorPool";
import { crNumber } from "./lib/shopify/productSync";
import { notifySale } from "./lib/notifications";
import { disputeEffect } from "./lib/disputes";
import { scheduleSaleEmail } from "./saleEmails";
import { getViewerUser } from "./identity";

// Creator earnings (KTD-18). One sale row per (order line, unit, recipient), plus negative
// reversal rows for refunds and cancellations. Everything here is recomputed idempotently from
// what's stored on orderItems, refunds, and orderShipments, so replays and out-of-order events
// land on the same ledger.
//
// States: pending (until the unit ships and 30 days pass), held (a pending refund covers the
// unit, or the recipient doesn't have creator access yet), available, paid, reversed (a sale and
// its reversals that net to zero before maturing). A reversal mirrors its sale's state, so
// partial reversals mature with their sale; a reversal against an Available or Paid sale is a
// negative Available adjustment.

const DAY_MS = 24 * 60 * 60 * 1000;

export function configFor(version: number): EconomicConfig {
  if (version !== ECONOMIC_CONFIG_V1.version) throw new Error(`Unknown economic config v${version}.`);
  return ECONOMIC_CONFIG_V1;
}

// Creator access (A1) isn't modeled yet: a member with a creator number, or the owner, has it.
// Shares owed to anyone else are held ("not_creator") until releaseCreatorHolds runs for them.
export function hasCreatorAccess(user: Doc<"users"> | null): boolean {
  if (!user) return false;
  return user.creatorNumber !== undefined || user.platformRole === "super_admin_owner";
}

type Row = Doc<"earnings">;
type Group = { sale?: Row; reversals: Array<Row> };

const keyOf = (itemId: string, unit: number, who: string) => `${itemId}|${unit}|${who}`;
const unitKey = (itemId: string, unit: number) => `${itemId}|${unit}`;

async function loadOrder(ctx: MutationCtx, orderId: Id<"orders">) {
  const [items, refunds, shipments, rows] = await Promise.all([
    ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(250),
    ctx.db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(100),
    ctx.db.query("orderShipments").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(100),
    ctx.db.query("earnings").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(8000),
  ]);
  refunds.sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
  return { items, refunds, shipments, rows };
}

// When each unit shipped: itemId -> unit -> shippedAt.
function shippedAtByUnit(shipments: Array<Doc<"orderShipments">>): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const shipment of shipments) {
    for (const line of shipment.lines) {
      const units = out.get(line.orderItemId) ?? new Map<number, number>();
      for (let unit = line.fromUnit; unit <= line.toUnit; unit++) {
        const earlier = units.get(unit);
        units.set(unit, earlier === undefined ? shipment.shippedAt : Math.min(earlier, shipment.shippedAt));
      }
      out.set(line.orderItemId, units);
    }
  }
  return out;
}

// The ledger a new refund is allocated against (lib/creatorPool allocateRefund).
export async function orderLedger(ctx: MutationCtx, orderId: Id<"orders">, now: number): Promise<Array<LineLedger>> {
  const { items, refunds, shipments, rows } = await loadOrder(ctx, orderId);
  const shipped = shippedAtByUnit(shipments);
  return items.map((item) => {
    const maturity = configFor(item.configVersion).maturityDays * DAY_MS;
    const consumed = item.unitPoolCents.map(() => new Map<string, number>());
    const add = (unit: number, who: string, cents: number) => {
      const map = consumed[unit - 1];
      if (map) map.set(who, (map.get(who) ?? 0) + cents);
    };
    let refundedAmountCents = 0;
    let refundedPoolCents = 0;
    for (const refund of refunds) {
      if (refund.status === "failed") continue;
      for (const line of refund.lines) {
        if (line.orderItemId !== item._id) continue;
        refundedAmountCents += line.amountCents;
        for (const unit of line.units) {
          refundedPoolCents += unit.cents;
          for (const part of unit.split) add(unit.unit, part.who, part.cents);
        }
      }
    }
    for (const row of rows) {
      if (row.orderItemId === item._id && row.kind === "reversal" && (row.reason === "cancel" || row.reason === "dispute")) {
        add(row.unit, row.recipientId, -row.amountCents);
      }
    }
    const unitStatus: Array<UnitStatus> = item.unitPoolCents.map((_, i) => {
      const unit = i + 1;
      const matured = rows.some(
        (r) => r.orderItemId === item._id && r.unit === unit && r.kind === "sale" && (r.state === "available" || r.state === "paid"),
      );
      const shippedAt = shipped.get(item._id)?.get(unit);
      if (matured || (shippedAt !== undefined && shippedAt + maturity <= now)) return "matured";
      return shippedAt !== undefined ? "shipped" : "unshipped";
    });
    return {
      itemId: item._id,
      lineItemId: item.shopifyLineItemId,
      baseCents: item.baseCents,
      poolCents: item.poolCents,
      unitPoolCents: item.unitPoolCents,
      recipients: item.recipients as Array<RecipientShare>,
      unitStatus,
      consumed,
      refundedAmountCents,
      refundedPoolCents,
    };
  });
}

async function setGroupState(
  ctx: MutationCtx,
  group: Group,
  state: "pending" | "held" | "reversed",
  holdReason: "refund" | "not_creator" | "dispute" | undefined,
  now: number,
) {
  for (const row of [group.sale, ...group.reversals]) {
    if (!row) continue;
    if (row !== group.sale && row.state !== "pending" && row.state !== "held") continue;
    if (row.state === state && row.holdReason === holdReason) continue;
    await ctx.db.patch("earnings", row._id, { state, holdReason, updatedAt: now });
    row.state = state;
    row.holdReason = holdReason;
  }
}

// Brings an order's earnings up to date with its stored inputs. Safe to call any number of times.
// Returns the sale rows it wrote, for notifyNewSales once the caller has applied everything.
export async function syncOrderEarnings(ctx: MutationCtx, orderId: Id<"orders">): Promise<Array<Id<"earnings">>> {
  const order = await ctx.db.get("orders", orderId);
  if (!order || order.economicEventAt === undefined) return [];
  // A production test order never creates earnings.
  if (order.isTest && !order.simulated) return [];
  const now = Date.now();
  const { items, refunds, shipments, rows } = await loadOrder(ctx, orderId);
  // Shopify Payments disputes on the order (convex/disputes.ts, INV-23): an open one holds its
  // earnings, and a chargeback the buyer kept reverses what's left of them (lib/disputes.ts).
  const disputes = await ctx.db
    .query("disputes")
    .withIndex("by_shopifyOrder", (q) => q.eq("shopifyOrderId", order.shopifyOrderId))
    .take(20);
  const effects = disputes.map((dispute) => disputeEffect(dispute.kind, dispute.status));
  const disputeOpen = effects.includes("hold");
  const disputeLost = effects.includes("reverse");
  const groups = new Map<string, Group>();
  const fresh: Array<Id<"earnings">> = [];
  const groupFor = (key: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { reversals: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const row of rows) {
    const group = groupFor(keyOf(row.orderItemId, row.unit, row.recipientId));
    if (row.kind === "sale") group.sale = row;
    else group.reversals.push(row);
  }

  const shipped = shippedAtByUnit(shipments);
  const heldUnits = new Set<string>();
  const nonFailedSplit = new Map<string, number>();
  for (const refund of refunds) {
    if (refund.status === "failed") continue;
    for (const line of refund.lines) {
      for (const unit of line.units) {
        if (refund.status === "pending") heldUnits.add(unitKey(line.orderItemId, unit.unit));
        for (const part of unit.split) {
          const key = keyOf(line.orderItemId, unit.unit, part.who);
          nonFailedSplit.set(key, (nonFailedSplit.get(key) ?? 0) + part.cents);
        }
      }
    }
  }

  const access = new Map<string, boolean>();
  const eligible = async (who: Id<"users">) => {
    if (!access.has(who)) access.set(who, hasCreatorAccess(await ctx.db.get("users", who)));
    return access.get(who)!;
  };

  // Sale rows, maturity dates, and refund holds.
  for (const item of items) {
    if (item.recipients.length === 0) continue;
    const maturity = configFor(item.configVersion).maturityDays * DAY_MS;
    const splits = saleSplits(item.unitPoolCents, item.recipients as Array<RecipientShare>);
    for (const [index, parts] of splits.entries()) {
      const unit = index + 1;
      const shippedAt = shipped.get(item._id)?.get(unit);
      const maturesAt = shippedAt === undefined ? undefined : shippedAt + maturity;
      for (const part of parts) {
        if (part.cents <= 0) continue;
        const who = part.who as Id<"users">;
        const recipient = item.recipients.find((r) => r.who === who);
        const group = groupFor(keyOf(item._id, unit, who));
        if (!group.sale) {
          const ok = await eligible(who);
          const fields = {
            recipientId: who,
            orderId,
            orderItemId: item._id,
            unit,
            kind: "sale" as const,
            roles: recipient?.roles ?? ["creator"],
            amountCents: part.cents,
            state: ok ? ("pending" as const) : ("held" as const),
            holdReason: ok ? undefined : ("not_creator" as const),
            simulated: order.simulated,
            maturesAt,
            createdAt: now,
            updatedAt: now,
          };
          const id = await ctx.db.insert("earnings", fields);
          group.sale = { _id: id, _creationTime: now, ...fields };
          fresh.push(id);
        } else if (maturesAt !== undefined && group.sale.maturesAt === undefined) {
          await ctx.db.patch("earnings", group.sale._id, { maturesAt, updatedAt: now });
          group.sale.maturesAt = maturesAt;
        }
        const sale = group.sale;
        // A pending refund on the unit holds it; otherwise an open dispute on the order does. Holds
        // stop maturing; what has already matured stays available.
        const hold = heldUnits.has(unitKey(item._id, unit)) ? "refund" : disputeOpen ? "dispute" : undefined;
        if (hold) {
          if (sale.state === "pending" || (sale.state === "held" && sale.holdReason !== hold)) {
            await setGroupState(ctx, group, "held", hold, now);
          }
        } else if (sale.state === "held" && (sale.holdReason === "refund" || sale.holdReason === "dispute")) {
          const ok = await eligible(who);
          await setGroupState(ctx, group, ok ? "pending" : "held", ok ? undefined : "not_creator", now);
        }
      }
    }
  }

  const insertReversal = async (
    group: Group,
    amountCents: number,
    reason: "refund" | "cancel" | "dispute",
    refundId: Id<"refunds"> | undefined,
  ) => {
    const sale = group.sale!;
    const state =
      sale.state === "available" || sale.state === "paid" ? ("available" as const) : sale.state;
    const fields = {
      recipientId: sale.recipientId,
      orderId,
      orderItemId: sale.orderItemId,
      unit: sale.unit,
      kind: "reversal" as const,
      refundId,
      reason,
      roles: sale.roles,
      amountCents,
      state,
      holdReason: state === "held" ? sale.holdReason : undefined,
      simulated: sale.simulated,
      createdAt: now,
      updatedAt: now,
    };
    const id = await ctx.db.insert("earnings", fields);
    group.reversals.push({ _id: id, _creationTime: now, ...fields });
  };

  // Reversals for refunds whose money has moved, from their fixed allocations.
  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    for (const line of refund.lines) {
      for (const unit of line.units) {
        for (const part of unit.split) {
          const group = groups.get(keyOf(line.orderItemId, unit.unit, part.who));
          if (!group?.sale) continue;
          const existing = group.reversals
            .filter((r) => r.refundId === refund._id)
            .reduce((sum, r) => sum + r.amountCents, 0);
          const delta = -part.cents - existing;
          if (delta < 0) await insertReversal(group, delta, "refund", refund._id);
        }
      }
    }
  }

  // A cancellation reverses only what no refund has taken (or is holding).
  if (order.cancelled) {
    for (const [key, group] of groups) {
      if (!group.sale) continue;
      const target = Math.min(0, -(group.sale.amountCents - (nonFailedSplit.get(key) ?? 0)));
      const existing = group.reversals.filter((r) => r.reason === "cancel").reduce((sum, r) => sum + r.amountCents, 0);
      const delta = target - existing;
      if (delta < 0) await insertReversal(group, delta, "cancel", undefined);
    }
  }

  // A chargeback the buyer kept reverses what no refund or cancellation has taken (or is holding),
  // once. (A chargeback lost and then won on appeal isn't restored here; the owner corrects it.)
  if (disputeLost) {
    for (const [key, group] of groups) {
      if (!group.sale) continue;
      const cancelled = group.reversals.filter((r) => r.reason === "cancel").reduce((sum, r) => sum + r.amountCents, 0);
      const target = Math.min(0, -(group.sale.amountCents - (nonFailedSplit.get(key) ?? 0)) - cancelled);
      const existing = group.reversals.filter((r) => r.reason === "dispute").reduce((sum, r) => sum + r.amountCents, 0);
      const delta = target - existing;
      if (delta < 0) await insertReversal(group, delta, "dispute", undefined);
    }
  }

  // A sale fully reversed before it matured nets to zero: both sides leave the balances.
  for (const group of groups.values()) {
    const sale = group.sale;
    if (!sale || (sale.state !== "pending" && sale.state !== "held")) continue;
    const net = sale.amountCents + group.reversals.reduce((sum, r) => sum + r.amountCents, 0);
    if (net <= 0 && group.reversals.length > 0) await setGroupState(ctx, group, "reversed", undefined, now);
  }

  return fresh;
}

// One "sold" notification per recipient and work for sale rows just written (the ids
// syncOrderEarnings returned), once the caller has applied the whole snapshot, refunds included.
// Each says what the recipient nets after refunds already applied; units a pending refund holds, or
// that a refund or cancellation reversed, don't count, and a cancelled order tells nobody. Rows are
// written once, so replays of the same order never notify twice.
export async function notifyNewSales(ctx: MutationCtx, orderId: Id<"orders">, freshSaleIds: Array<Id<"earnings">>) {
  if (freshSaleIds.length === 0) return;
  const order = await ctx.db.get("orders", orderId);
  if (!order || order.cancelled) return;
  const { items, rows } = await loadOrder(ctx, orderId);
  const fresh = new Set<string>(freshSaleIds);
  const workOf = new Map(items.map((item) => [item._id as string, item.workId]));
  const totals = new Map<
    string,
    { recipientId: Id<"users">; workId: Id<"works">; cents: number; units: number; held: boolean }
  >();
  for (const sale of rows) {
    if (sale.kind !== "sale" || !fresh.has(sale._id)) continue;
    if (sale.state === "reversed" || (sale.state === "held" && (sale.holdReason === "refund" || sale.holdReason === "dispute"))) continue;
    const workId = workOf.get(sale.orderItemId);
    if (!workId) continue;
    const reversed = rows
      .filter(
        (r) =>
          r.kind === "reversal" &&
          r.orderItemId === sale.orderItemId &&
          r.unit === sale.unit &&
          r.recipientId === sale.recipientId,
      )
      .reduce((sum, r) => sum + r.amountCents, 0);
    const net = sale.amountCents + reversed;
    if (net <= 0) continue;
    const key = `${sale.recipientId}|${workId}`;
    const total = totals.get(key) ?? { recipientId: sale.recipientId, workId, cents: 0, units: 0, held: true };
    total.cents += net;
    total.units += 1;
    // Held for a recipient without creator access (refund holds were skipped above).
    total.held = total.held && sale.state === "held";
    totals.set(key, total);
  }
  const now = Date.now();
  // What each recipient gets an email about (real orders, shares they can be paid).
  const emails = new Map<Id<"users">, Array<{ workId: Id<"works">; cents: number; units: number }>>();
  for (const total of totals.values()) {
    // A kept design sells only to its creator, so they bought it themselves: no "someone bought".
    const work = await ctx.db.get("works", total.workId);
    if (work?.status === "private" && work.creatorId === total.recipientId) continue;
    await notifySale(ctx, { ...total, test: order.simulated, at: now });
    if (!order.simulated && !total.held) {
      const list = emails.get(total.recipientId) ?? [];
      list.push({ workId: total.workId, cents: total.cents, units: total.units });
      emails.set(total.recipientId, list);
    }
  }
  for (const [recipientId, list] of emails) await scheduleSaleEmail(ctx, recipientId, list);
}

// ---- Crons and hooks ----

// Cron: shipped units past their 30 days become Available (with their partial reversals).
export const matureDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("earnings")
      .withIndex("by_state_maturesAt", (q) => q.eq("state", "pending").gt("maturesAt", 0).lte("maturesAt", now))
      .take(200);
    let matured = 0;
    for (const sale of due) {
      if (sale.kind !== "sale") continue;
      await ctx.db.patch("earnings", sale._id, { state: "available", updatedAt: now });
      const siblings = await ctx.db
        .query("earnings")
        .withIndex("by_orderItem_unit", (q) => q.eq("orderItemId", sale.orderItemId).eq("unit", sale.unit))
        .take(50);
      for (const row of siblings) {
        if (row.kind === "reversal" && row.recipientId === sale.recipientId && row.state === "pending") {
          await ctx.db.patch("earnings", row._id, { state: "available", updatedAt: now });
        }
      }
      matured++;
    }
    return matured;
  },
});

// When a member gets creator access (lib/creators.ts ensureCreatorNumber schedules it), their
// "not_creator" holds become Pending and mature on schedule (plan A1).
export const releaseCreatorHolds = internalMutation({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const held = await ctx.db
      .query("earnings")
      .withIndex("by_recipient_state", (q) => q.eq("recipientId", args.userId).eq("state", "held"))
      .take(1000);
    let released = 0;
    for (const row of held) {
      if (row.holdReason !== "not_creator") continue;
      await ctx.db.patch("earnings", row._id, { state: "pending", holdReason: undefined, updatedAt: now });
      released++;
    }
    return released;
  },
});

// ---- The member's own earnings (/me/earnings) ----

const BALANCE_SCAN = 2000;

const entryValidator = v.object({
  id: v.id("earnings"),
  createdAt: v.number(),
  amountCents: v.number(),
  status: v.union(v.literal("Pending"), v.literal("On hold"), v.literal("Available"), v.literal("Paid"), v.literal("Reversed")),
  // Why it's on hold: a refund in progress, a payment dispute open, or no creator access yet.
  holdReason: v.union(v.literal("refund"), v.literal("not_creator"), v.literal("dispute"), v.null()),
  kind: v.union(v.literal("sale"), v.literal("refund"), v.literal("cancel"), v.literal("dispute")),
  test: v.boolean(),
  cr: v.union(v.string(), v.null()),
  title: v.union(v.string(), v.null()),
  // A kept design (no public number): its private page for its own creator, and only "a private
  // remix" for anyone else it pays, never its title.
  keptId: v.union(v.id("works"), v.null()),
  privateRemix: v.boolean(),
  roles: v.array(v.string()),
  maturesAt: v.union(v.number(), v.null()),
});

const totalsValidator = v.object({ pendingCents: v.number(), availableCents: v.number(), paidCents: v.number() });

type EntryWork = { cr: string | null; title: string | null; keptId: Id<"works"> | null; privateRemix: boolean };

// How an earnings entry names its design: by its CR number, or for a kept design, by a link to its
// private page for its creator and as "a private remix" for anyone else.
function entryWork(doc: Doc<"works">, viewerId: Id<"users">): EntryWork {
  if (doc.status !== "private") {
    return { cr: crNumber(doc.crFamily, doc.crExpression), title: doc.title ?? null, keptId: null, privateRemix: false };
  }
  if (doc.creatorId === viewerId) return { cr: null, title: doc.title ?? null, keptId: doc._id, privateRemix: false };
  return { cr: null, title: null, keptId: null, privateRemix: true };
}

function statusOf(row: Row) {
  if (row.state === "held") return "On hold" as const;
  if (row.state === "pending") return "Pending" as const;
  if (row.state === "available") return "Available" as const;
  if (row.state === "paid") return "Paid" as const;
  return "Reversed" as const;
}

// Signed-in members see only their own rows; there is no way to ask for someone else's.
export const mine = query({
  args: {},
  returns: v.union(v.null(), v.object({ totals: totalsValidator, testTotals: totalsValidator, entries: v.array(entryValidator) })),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return null;
    const totals = { pendingCents: 0, availableCents: 0, paidCents: 0 };
    const testTotals = { pendingCents: 0, availableCents: 0, paidCents: 0 };
    for (const state of ["pending", "held", "available", "paid"] as const) {
      const rows = await ctx.db
        .query("earnings")
        .withIndex("by_recipient_state", (q) => q.eq("recipientId", viewer._id).eq("state", state))
        .take(BALANCE_SCAN);
      for (const row of rows) {
        const target = row.simulated ? testTotals : totals;
        if (state === "available") target.availableCents += row.amountCents;
        else if (state === "paid") target.paidCents += row.amountCents;
        else target.pendingCents += row.amountCents;
      }
    }
    const recent = await ctx.db
      .query("earnings")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", viewer._id))
      .order("desc")
      .take(60);
    const works = new Map<string, EntryWork | null>();
    const entries = [];
    for (const row of recent) {
      const item = await ctx.db.get("orderItems", row.orderItemId);
      let work: EntryWork | null = null;
      if (item?.workId) {
        if (!works.has(item.workId)) {
          const doc = await ctx.db.get("works", item.workId);
          works.set(item.workId, doc ? entryWork(doc, viewer._id) : null);
        }
        work = works.get(item.workId) ?? null;
      }
      entries.push({
        id: row._id,
        createdAt: row.createdAt,
        amountCents: row.amountCents,
        status: statusOf(row),
        kind: row.kind === "sale" ? ("sale" as const) : (row.reason ?? "refund"),
        test: row.simulated,
        cr: work?.cr ?? null,
        title: work?.title ?? null,
        keptId: work?.keptId ?? null,
        privateRemix: work?.privateRemix ?? false,
        roles: row.roles,
        maturesAt: row.kind === "sale" && row.state === "pending" ? (row.maturesAt ?? null) : null,
        holdReason: row.state === "held" ? (row.holdReason ?? null) : null,
      });
    }
    return { totals, testTotals, entries };
  },
});
