import { SHOP_COSTS } from "../../shared/config/shopCosts";
import { spreadProRata } from "./creatorPool";

// Costs first (docs/decisions.md, "Recover protected costs before sharing earnings"; economics
// v6). Before any share of a sale is paid, each line recovers its protected costs: making it
// (Printful's catalog price for the variant and placements, saved at sale), its part of the card
// fee on everything the buyer paid, its part of any shipping Printful charges beyond what the buyer
// paid for shipping, and the operating allowance per unit. Shares are percentages of what's left
// (the distributable amount). Tax and shipping collected are never shared. A line whose costs
// aren't known shares nothing, and the order is flagged. Pure, so the admin display and the sale
// math use the same rules.

export type CostRates = {
  cardPercentBps: number;
  cardFixedCents: number;
  shippingChargedCents: number;
  printfulShippingCents: number;
  printfulShippingExtraCents: number;
};

export type LineCostInput = {
  baseCents: number;
  quantity: number;
  // Making one unit: null when it isn't known.
  unitCostCents: number | null;
};

export type LineCosts = {
  productionCents: number;
  feeCents: number;
  shippingCents: number;
  allowanceCents: number;
  // What's left to share: the line's base after the costs above, never below zero.
  distributableCents: number;
  // The price (after discounts) didn't cover the costs.
  belowCost: boolean;
  costKnown: boolean;
};

export function orderLineCosts(
  order: { totalCents: number; shippingCollectedCents: number | null },
  lines: ReadonlyArray<LineCostInput>,
  allowancePerUnitCents: number,
  rates: CostRates = SHOP_COSTS,
): Array<LineCosts> {
  const bases = lines.map((line) => Math.max(0, line.baseCents));
  const units = lines.map((line) => Math.max(0, line.quantity));
  const unitCount = units.reduce((sum, n) => sum + n, 0);
  // The card fee is on everything the buyer paid, tax and shipping included.
  const feeTotal = order.totalCents > 0 ? Math.round((order.totalCents * rates.cardPercentBps) / 10000) + rates.cardFixedCents : 0;
  const fees = spreadProRata(feeTotal, bases);
  // Printful's shipping beyond what the buyer paid for it, by unit.
  const shippingCost = unitCount > 0 ? rates.printfulShippingCents + rates.printfulShippingExtraCents * (unitCount - 1) : 0;
  const collected = order.shippingCollectedCents ?? rates.shippingChargedCents;
  const shortfalls = spreadProRata(Math.max(0, shippingCost - collected), units);
  return lines.map((line, i) => {
    const costKnown = line.unitCostCents !== null && Number.isFinite(line.unitCostCents) && line.unitCostCents >= 0;
    const productionCents = costKnown ? line.unitCostCents! * units[i] : 0;
    const allowanceCents = allowancePerUnitCents * units[i];
    const total = productionCents + fees[i] + shortfalls[i] + allowanceCents;
    const left = bases[i] - total;
    return {
      productionCents,
      feeCents: fees[i],
      shippingCents: shortfalls[i],
      allowanceCents,
      distributableCents: costKnown ? Math.max(0, left) : 0,
      belowCost: costKnown && left < 0,
      costKnown,
    };
  });
}

// What one unit leaves to share at a price, in a one-unit order with standard shipping: what the
// listing check and Admin's money table show. Negative means the price doesn't cover the costs.
export function unitDistributable(priceCents: number, unitCostCents: number, allowancePerUnitCents: number, rates: CostRates = SHOP_COSTS) {
  const [line] = orderLineCosts(
    { totalCents: priceCents + rates.shippingChargedCents, shippingCollectedCents: rates.shippingChargedCents },
    [{ baseCents: priceCents, quantity: 1, unitCostCents }],
    allowancePerUnitCents,
    rates,
  );
  return priceCents - (line.productionCents + line.feeCents + line.shippingCents + line.allowanceCents);
}
