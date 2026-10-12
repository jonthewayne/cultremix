import { describe, expect, it } from "vitest";
import { linePool, recipientShares } from "../../convex/lib/economics";
import {
  
  
  allocateRefund,
  saleSplits,
  shipmentUnits,
  splitReversal,
  spreadProRata
} from "../../convex/lib/creatorPool";
import type { EconomicLineage } from "../../convex/lib/economics";
import type { LineLedger, UnitStatus } from "../../convex/lib/creatorPool";

function ledger(
  lineage: EconomicLineage,
  line: { unitPriceCents: number; quantity: number; discountCents?: number },
  extra: Partial<LineLedger> = {},
): LineLedger {
  const pool = linePool({ discountCents: 0, ...line });
  return {
    itemId: "item1",
    lineItemId: "L1",
    baseCents: pool.baseCents,
    poolCents: pool.poolCents,
    unitPoolCents: pool.units,
    recipients: recipientShares(lineage),
    unitStatus: pool.units.map((): UnitStatus => "unshipped"),
    consumed: pool.units.map(() => new Map()),
    refundedAmountCents: 0,
    refundedPoolCents: 0,
    ...extra,
  };
}

const total = (parts: Array<{ cents: number }>) => parts.reduce((sum, p) => sum + p.cents, 0);
const byWho = (parts: Array<{ who: string; cents: number }>) => Object.fromEntries(parts.map((p) => [p.who, p.cents]));

describe("sale splits per the recipient table", () => {
  it("pays an original's creator the whole pool", () => {
    const { units } = linePool({ unitPriceCents: 3600, quantity: 1, discountCents: 0 });
    expect(units).toEqual([540]);
    expect(saleSplits(units, recipientShares({ kind: "original", creator: "A" }))).toEqual([[{ who: "A", cents: 540 }]]);
  });

  it("splits a variation 50/50 with the family root", () => {
    const shares = recipientShares({ kind: "variation", creator: "B", root: { kind: "original", creator: "A" } });
    expect(byWho(saleSplits([540], shares)[0])).toEqual({ A: 270, B: 270 });
  });

  it("splits a fork 30/70 with the upstream creator", () => {
    const shares = recipientShares({ kind: "fork", creator: "C", parentCreator: "U" });
    expect(byWho(saleSplits([540], shares)[0])).toEqual({ U: 162, C: 378 });
  });

  it("splits a variation in a fork family 20/30/50", () => {
    const shares = recipientShares({
      kind: "variation",
      creator: "D",
      root: { kind: "fork", creator: "C", parentCreator: "U" },
    });
    expect(byWho(saleSplits([540], shares)[0])).toEqual({ U: 108, C: 162, D: 270 });
  });

  it("gives rounding remainders to the work's creator and to the lowest units", () => {
    // 3 x 3333 = 9999 base; pool floor(9999 x 0.15) = 1499 -> units 500, 500, 499.
    const pool = linePool({ unitPriceCents: 3333, quantity: 3, discountCents: 0 });
    expect(pool.units).toEqual([500, 500, 499]);
    const shares = recipientShares({ kind: "fork", creator: "C", parentCreator: "U" });
    const splits = saleSplits(pool.units, shares);
    // 499 x 30% = 149.7 -> U 149, C gets the remainder 350.
    expect(byWho(splits[2])).toEqual({ U: 149, C: 350 });
    expect(splits.reduce((sum, unit) => sum + total(unit), 0)).toBe(1499);
  });

  it("takes line discounts off the base before the pool", () => {
    const pool = linePool({ unitPriceCents: 3600, quantity: 2, discountCents: 720 });
    expect(pool).toEqual({ baseCents: 6480, poolCents: 972, units: [486, 486] });
  });

  it("sums one person's two roles", () => {
    const shares = recipientShares({ kind: "variation", creator: "A", root: { kind: "original", creator: "A" } });
    expect(saleSplits([540], shares)).toEqual([[{ who: "A", cents: 540 }]]);
  });
});

describe("refund allocation", () => {
  const variation: EconomicLineage = { kind: "variation", creator: "B", root: { kind: "original", creator: "A" } };

  it("reverses a whole-unit refund from the highest unshipped unit", () => {
    const line = ledger(variation, { unitPriceCents: 3600, quantity: 3 });
    const allocation = allocateRefund([line], {
      lines: [{ lineItemId: "L1", quantity: 1, subtotalCents: 3600, taxCents: 288 }],
      shippingCents: 0,
      totalCents: 3888,
    });
    expect(allocation.unallocatedCents).toBe(0);
    expect(allocation.lines).toHaveLength(1);
    expect(allocation.lines[0].units).toEqual([{ unit: 3, cents: 540, split: [{ who: "A", cents: 270 }, { who: "B", cents: 270 }] }]);
  });

  it("prefers unshipped units, then shipped, then matured", () => {
    const line = ledger(
      { kind: "original", creator: "A" },
      { unitPriceCents: 1000, quantity: 3 },
      { unitStatus: ["shipped", "unshipped", "matured"] },
    );
    const allocation = allocateRefund([line], {
      lines: [{ lineItemId: "L1", quantity: 3, subtotalCents: 3000, taxCents: 0 }],
      shippingCents: 0,
      totalCents: 3000,
    });
    expect(allocation.lines[0].units.map((u) => u.unit)).toEqual([2, 1, 3]);
    expect(total(allocation.lines[0].units)).toBe(450);
  });

  it("adds partial refunds up to exactly the pool", () => {
    const line = ledger({ kind: "fork", creator: "C", parentCreator: "U" }, { unitPriceCents: 3333, quantity: 3 });
    const first = allocateRefund([line], {
      lines: [{ lineItemId: "L1", quantity: 0, subtotalCents: 1000, taxCents: 0 }],
      shippingCents: 0,
      totalCents: 1000,
    });
    // floor(1499 x 1000 / 9999) = 149.
    expect(total(first.lines[0].units)).toBe(149);
    // Record the first refund as consumed, then refund the rest.
    const consumed = line.unitPoolCents.map(() => new Map<string, number>());
    for (const unit of first.lines[0].units) for (const part of unit.split) consumed[unit.unit - 1].set(part.who, part.cents);
    const second = allocateRefund(
      [{ ...line, consumed, refundedAmountCents: 1000, refundedPoolCents: 149 }],
      { lines: [{ lineItemId: "L1", quantity: 3, subtotalCents: 8999, taxCents: 0 }], shippingCents: 0, totalCents: 8999 },
    );
    expect(149 + total(second.lines[0].units)).toBe(1499);
    // Never more from a person on a unit than their sale gave them.
    const sale = saleSplits(line.unitPoolCents, line.recipients);
    for (let unit = 1; unit <= 3; unit++) {
      for (const part of sale[unit - 1]) {
        const taken =
          (consumed[unit - 1].get(part.who) ?? 0) +
          total(second.lines[0].units.filter((u) => u.unit === unit).flatMap((u) => u.split.filter((s) => s.who === part.who)));
        expect(taken).toBe(part.cents);
      }
    }
  });

  it("leaves the pool alone for a shipping-only refund", () => {
    const line = ledger(variation, { unitPriceCents: 3600, quantity: 1 });
    const allocation = allocateRefund([line], { lines: [], shippingCents: 595, totalCents: 595 });
    expect(allocation.lines).toEqual([]);
    expect(allocation.shippingCents).toBe(595);
  });

  it("spreads an unattributed refund amount over lines by their net", () => {
    const a = ledger({ kind: "original", creator: "A" }, { unitPriceCents: 3000, quantity: 1 });
    const b = { ...ledger({ kind: "original", creator: "B" }, { unitPriceCents: 1000, quantity: 1 }), itemId: "item2", lineItemId: "L2" };
    const allocation = allocateRefund([a, b], { lines: [], shippingCents: 0, totalCents: 400 });
    expect(allocation.unallocatedCents).toBe(400);
    expect(allocation.lines.map((l) => l.amountCents)).toEqual([300, 100]);
    expect(allocation.lines.map((l) => total(l.units))).toEqual([45, 15]);
  });

  it("caps a refund at what's left of the pool", () => {
    const line = ledger({ kind: "original", creator: "A" }, { unitPriceCents: 1000, quantity: 1 }, {
      consumed: [new Map([["A", 150]])],
      refundedAmountCents: 1000,
      refundedPoolCents: 150,
    });
    const allocation = allocateRefund([line], {
      lines: [{ lineItemId: "L1", quantity: 1, subtotalCents: 1000, taxCents: 0 }],
      shippingCents: 0,
      totalCents: 1000,
    });
    expect(allocation.lines[0].units).toEqual([]);
  });
});

describe("helpers", () => {
  it("splitReversal sends what a capped recipient can't absorb to the creator", () => {
    const shares = recipientShares({ kind: "fork", creator: "C", parentCreator: "U" });
    expect(byWho(splitReversal(100, shares, new Map([["U", 10], ["C", 200]])))).toEqual({ U: 10, C: 90 });
  });

  it("spreadProRata hands leftover cents to the heaviest", () => {
    expect(spreadProRata(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(spreadProRata(10, [0, 0])).toEqual([0, 0]);
  });

  it("shipmentUnits ships ascending and never past the line", () => {
    expect(shipmentUnits(0, 2, 3)).toEqual({ fromUnit: 1, toUnit: 2 });
    expect(shipmentUnits(2, 5, 3)).toEqual({ fromUnit: 3, toUnit: 3 });
    expect(shipmentUnits(3, 1, 3)).toBeNull();
  });
});
