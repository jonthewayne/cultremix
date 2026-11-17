import { describe, expect, it } from "vitest";
import { orderLineCosts, unitDistributable } from "../../convex/lib/saleCosts";
import { poolFromAmount } from "../../convex/lib/economics";

const RATES = { cardPercentBps: 290, cardFixedCents: 30, shippingChargedCents: 595, printfulShippingCents: 535, printfulShippingExtraCents: 260 };

// Costs first (docs/decisions.md, economics v6): each line recovers its protected costs before
// anything is shared.
describe("costs before sharing", () => {
  it("recovers making, the card fee, and the allowance from a one-shirt order", () => {
    // $24 shirt, $5.95 shipping paid; Printful charges $12.95 to make it and $5.35 to ship it.
    const [line] = orderLineCosts({ totalCents: 2995, shippingCollectedCents: 595 }, [{ baseCents: 2400, quantity: 1, unitCostCents: 1295 }], 100, RATES);
    // Card fee: 2.9% of $29.95 = 86.9 -> 87, plus 30 = 117. Shipping is covered.
    expect(line).toEqual({ productionCents: 1295, feeCents: 117, shippingCents: 0, allowanceCents: 100, distributableCents: 888, belowCost: false, costKnown: true });
    // 15% of what's left: $1.33.
    expect(poolFromAmount(line.distributableCents, 1, 1500)).toEqual({ poolCents: 133, units: [133] });
  });

  it("splits the order's card fee and shipping shortfall across its lines", () => {
    const lines = orderLineCosts(
      { totalCents: 6595, shippingCollectedCents: 595 },
      [
        { baseCents: 2400, quantity: 1, unitCostCents: 1295 },
        { baseCents: 3600, quantity: 2, unitCostCents: 1095 },
      ],
      100,
      RATES,
    );
    // Shipping: 535 + 2 x 260 = 1055, less 595 paid = 460 short, by unit 1:2, the odd cent to the heavier line.
    expect(lines.map((l) => l.shippingCents)).toEqual([153, 307]);
    // Fee 2.9% of 65.95 = 191 + 30 = 221, by base 2400:3600.
    expect(lines.map((l) => l.feeCents).reduce((a, b) => a + b, 0)).toBe(221);
    expect(lines[1].productionCents).toBe(2190);
    expect(lines[1].allowanceCents).toBe(200);
  });

  it("shares nothing when a discount takes the price below cost, or the cost isn't known", () => {
    const [cheap] = orderLineCosts({ totalCents: 1595, shippingCollectedCents: 595 }, [{ baseCents: 1000, quantity: 1, unitCostCents: 1295 }], 100, RATES);
    expect(cheap).toMatchObject({ distributableCents: 0, belowCost: true });
    const [unknown] = orderLineCosts({ totalCents: 2995, shippingCollectedCents: 595 }, [{ baseCents: 2400, quantity: 1, unitCostCents: null }], 100, RATES);
    expect(unknown).toMatchObject({ distributableCents: 0, costKnown: false, belowCost: false });
  });

  it("uses the store's flat shipping when the order doesn't say what was paid", () => {
    const [line] = orderLineCosts({ totalCents: 2995, shippingCollectedCents: null }, [{ baseCents: 2400, quantity: 1, unitCostCents: 1295 }], 100, RATES);
    expect(line.shippingCents).toBe(0);
  });

  it("says what one unit leaves at a price, negative when it doesn't cover costs", () => {
    expect(unitDistributable(2400, 1295, 100, RATES)).toBe(888);
    expect(unitDistributable(1450, 1295, 100, RATES)).toBeLessThan(0);
  });
});
