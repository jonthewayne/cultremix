// What one order costs CultRemix besides the garment itself. From economics v6 a sale recovers
// these before anything is shared (convex/lib/saleCosts.ts), and each order line saves the amounts
// it used, so a change here applies to later sales only. Admin, Brands shows the same math.
// Checked November 16, 2026; update them when Shopify's plan, Printful's shipping, or the store's
// shipping rate changes.
export const SHOP_COSTS = {
  // Shopify, Settings, Shipping: Standard, flat per order (docs/setup/shopify-printful.md).
  shippingChargedCents: 595,
  // Printful's US shipping for one shirt: $4.95, plus its $0.40 surcharge from October 15, 2026
  // to January 17, 2027; each additional one $2.20 plus the same surcharge.
  printfulShippingCents: 535,
  printfulShippingExtraCents: 260,
  // Shopify Payments on the Basic plan, online: 2.9% + 30¢ of everything the buyer pays.
  cardPercentBps: 290,
  cardFixedCents: 30,
  // Admin, Brands warns when a deal would leave CultRemix less than this on a shirt.
  keepFloorCents: 200,
} as const;

export type ShopCosts = { [K in keyof typeof SHOP_COSTS]: number };
