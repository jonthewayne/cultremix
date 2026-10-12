import { splitUnit } from "./economics";
import type { RecipientShare } from "./economics";

// The creator-pool ledger math for orders (KTD-18), as pure functions over stored inputs so the
// same numbers come out on every replay. Amounts are USD integer cents; units are 1-based.
//
// Refunds: the refund's pool cents for a line are proportional to the refunded amount, computed
// cumulatively (floor(pool x all refunded so far / base) minus what earlier refunds took), so
// several partial refunds add up to exactly the pool. Those cents are taken from units in the
// selection order (unshipped first, highest unit number first; then shipped-but-unmatured; then
// matured), and each unit's cents are split among its recipients without ever taking more from a
// person than their sale earned on that unit.

export type SplitCents = { who: string; cents: number };
export type UnitStatus = "unshipped" | "shipped" | "matured";
export type UnitAllocation = { unit: number; cents: number; split: Array<SplitCents> };

// Every unit's sale split: result[unit - 1] lists each recipient's cents for that unit.
export function saleSplits(unitPoolCents: Array<number>, recipients: Array<RecipientShare>): Array<Array<SplitCents>> {
  return unitPoolCents.map((cents) => splitUnit(cents, recipients));
}

// Splits reversal cents for one unit like splitUnit, but never past a recipient's remaining cents
// on that unit; whatever a capped recipient can't absorb goes to the creator first, then the rest
// in share order.
export function splitReversal(
  cents: number,
  recipients: Array<RecipientShare>,
  remaining: Map<string, number>,
): Array<SplitCents> {
  const base = splitUnit(cents, recipients);
  const out = base.map((part) => ({ who: part.who, cents: Math.min(part.cents, Math.max(0, remaining.get(part.who) ?? 0)) }));
  let leftover = cents - out.reduce((sum, part) => sum + part.cents, 0);
  const order = [...recipients.keys()].sort((a, b) => {
    const ca = recipients[a].roles.includes("creator") ? 0 : 1;
    const cb = recipients[b].roles.includes("creator") ? 0 : 1;
    return ca - cb || a - b;
  });
  for (const index of order) {
    if (leftover <= 0) break;
    const room = Math.max(0, (remaining.get(out[index].who) ?? 0) - out[index].cents);
    const take = Math.min(room, leftover);
    out[index].cents += take;
    leftover -= take;
  }
  return out.filter((part) => part.cents > 0);
}

export type LineLedger = {
  itemId: string;
  lineItemId: string;
  baseCents: number;
  poolCents: number;
  unitPoolCents: Array<number>;
  recipients: Array<RecipientShare>;
  // Indexed by unit - 1.
  unitStatus: Array<UnitStatus>;
  // Cents already taken from each unit, per recipient (earlier refunds that haven't failed, and
  // cancellation reversals). Indexed by unit - 1.
  consumed: Array<Map<string, number>>;
  // The refunded amounts and pool cents of earlier refunds that haven't failed.
  refundedAmountCents: number;
  refundedPoolCents: number;
};

export type RefundInput = {
  lines: Array<{ lineItemId: string; quantity: number; subtotalCents: number; taxCents: number }>;
  shippingCents: number;
  totalCents: number;
};

export type RefundAllocation = {
  lines: Array<{ itemId: string; lineItemId: string; quantity: number; amountCents: number; units: Array<UnitAllocation> }>;
  unallocatedCents: number;
  shippingCents: number;
};

const STATUS_RANK: Record<UnitStatus, number> = { unshipped: 0, shipped: 1, matured: 2 };

// Spreads cents over lines pro rata by weight; leftover cents go to the heaviest lines first.
export function spreadProRata(cents: number, weights: Array<number>): Array<number> {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (cents <= 0 || total <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((cents * w) / total));
  let left = cents - out.reduce((sum, c) => sum + c, 0);
  const order = [...weights.keys()].sort((a, b) => weights[b] - weights[a] || a - b);
  for (let i = 0; left > 0; i = (i + 1) % order.length) {
    if (weights[order[i]] > 0) {
      out[order[i]]++;
      left--;
    }
  }
  return out;
}

function unitRemaining(line: LineLedger, unit: number): Map<string, number> {
  const sale = splitUnit(line.unitPoolCents[unit - 1] ?? 0, line.recipients);
  const used = line.consumed[unit - 1] ?? new Map<string, number>();
  return new Map(sale.map((part) => [part.who, part.cents - (used.get(part.who) ?? 0)]));
}

function sumValues(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += Math.max(0, value);
  return total;
}

// Fixes a refund's unit allocation. Lines not in the order's ledger (unmapped lines) take nothing.
export function allocateRefund(lines: Array<LineLedger>, refund: RefundInput): RefundAllocation {
  const lineTotals = refund.lines.reduce((sum, l) => sum + l.subtotalCents + l.taxCents, 0);
  const unallocatedCents = Math.max(0, refund.totalCents - lineTotals - refund.shippingCents);
  const extras = spreadProRata(
    unallocatedCents,
    lines.map((l) => l.baseCents),
  );

  const out: RefundAllocation["lines"] = [];
  lines.forEach((line, index) => {
    const refunded = refund.lines.filter((l) => l.lineItemId === line.lineItemId);
    const amountCents = refunded.reduce((sum, l) => sum + l.subtotalCents, 0) + extras[index];
    const quantity = refunded.reduce((sum, l) => sum + l.quantity, 0);
    if (amountCents <= 0 && quantity <= 0) return;
    const remainders = line.unitPoolCents.map((_, i) => unitRemaining(line, i + 1));
    const available = remainders.reduce((sum, m) => sum + sumValues(m), 0);
    const target =
      line.baseCents > 0
        ? Math.floor((line.poolCents * Math.min(line.baseCents, line.refundedAmountCents + amountCents)) / line.baseCents)
        : 0;
    let cents = Math.min(available, Math.max(0, target - line.refundedPoolCents));
    const order = line.unitPoolCents
      .map((_, i) => i + 1)
      .sort((a, b) => STATUS_RANK[line.unitStatus[a - 1]] - STATUS_RANK[line.unitStatus[b - 1]] || b - a);
    const units: Array<UnitAllocation> = [];
    for (const unit of order) {
      if (cents <= 0) break;
      const remaining = remainders[unit - 1];
      const take = Math.min(cents, sumValues(remaining));
      if (take <= 0) continue;
      units.push({ unit, cents: take, split: splitReversal(take, line.recipients, remaining) });
      cents -= take;
    }
    out.push({ itemId: line.itemId, lineItemId: line.lineItemId, quantity, amountCents, units });
  });
  return { lines: out, unallocatedCents, shippingCents: refund.shippingCents };
}

// Units a shipment covers, ascending from the first unit not yet shipped.
export function shipmentUnits(alreadyShipped: number, quantity: number, lineQuantity: number): { fromUnit: number; toUnit: number } | null {
  const fromUnit = alreadyShipped + 1;
  const toUnit = Math.min(lineQuantity, alreadyShipped + quantity);
  return toUnit >= fromUnit ? { fromUnit, toUnit } : null;
}
