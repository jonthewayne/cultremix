import { SHOP_COSTS } from "../../shared/config/shopCosts";
import type { ShopCosts } from "../../shared/config/shopCosts";

// One shirt's money in a one-shirt order, for Admin, Brands: what the buyer pays, what Printful and
// the card fee take, each share of the shirt's price, and what CultRemix keeps. Shares are of the
// price alone (tax and shipping left out), as in the sale math (convex/lib/economics.ts); the card
// fee is on everything the buyer pays. Display only, rounded down to the cent like the sale math.
export type ShirtSplit = { creatorBps: number; brandBps: number; linkBps: number };

export type ShirtMath = {
  priceCents: number;
  paidCents: number;
  printfulCents: number;
  cardFeeCents: number;
  creatorCents: number;
  brandCents: number;
  linkCents: number;
  keepCents: number;
};

export function shirtMath(priceCents: number, costCents: number, split: ShirtSplit, costs: ShopCosts = SHOP_COSTS): ShirtMath {
  const paidCents = priceCents + costs.shippingChargedCents;
  const cardFeeCents = Math.round((paidCents * costs.cardPercentBps) / 10000) + costs.cardFixedCents;
  const part = (bps: number) => Math.floor((priceCents * bps) / 10000);
  const creatorCents = part(split.creatorBps);
  const brandCents = part(split.brandBps);
  const linkCents = part(split.linkBps);
  const printfulCents = costCents + costs.printfulShippingCents;
  return {
    priceCents,
    paidCents,
    printfulCents,
    cardFeeCents,
    creatorCents,
    brandCents,
    linkCents,
    keepCents: paidCents - printfulCents - cardFeeCents - creatorCents - brandCents - linkCents,
  };
}

// What Printful charges for a size group: the highest of its sizes, so the math errs low for us.
export function costFor(sizes: ReadonlyArray<{ size: string; cents: number }>, group: ReadonlyArray<string>): number | null {
  const cents = sizes.filter((row) => group.includes(row.size)).map((row) => row.cents);
  return cents.length > 0 ? Math.max(...cents) : null;
}
