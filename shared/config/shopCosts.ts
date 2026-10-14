// What one order costs CultRemix besides the shirt itself, for the per-shirt money in Admin, Brands
// (src/lib/shirtMath.ts). Display only: sales and earnings never read these. Checked October 13,
// 2026; update them when Shopify's plan, Printful's shipping, or the store's shipping rate changes.
export const SHOP_COSTS = {
  // Shopify, Settings, Shipping: Standard, flat per order (docs/setup/shopify-printful.md).
  shippingChargedCents: 595,
  // Printful's US shipping for one shirt: $4.95, plus its $0.40 surcharge from October 15, 2026.
  printfulShippingCents: 535,
  // Shopify Payments on the Basic plan, online: 2.9% + 30¢ of everything the buyer pays.
  cardPercentBps: 290,
  cardFixedCents: 30,
  // Admin, Brands warns when a deal would leave CultRemix less than this on a shirt.
  keepFloorCents: 200,
} as const;

export type ShopCosts = { [K in keyof typeof SHOP_COSTS]: number };
