// The shirt CultRemix prints and sells, shared by the browser (placement, preview, the buy box)
// and Convex (render, readiness, product sync, fulfillment). Every number names where it came from.

export type ShirtColor = {
  name: string;
  hex: string;
  // Printful catalog variant IDs, S through 2XL.
  variants: { S: number; M: number; L: number; XL: number; "2XL": number };
};

export type PrintProduct = {
  key: string;
  // Shown to buyers.
  name: string;
  // Shopify product fields.
  vendor: string;
  productType: string;
  printful: { productId: number; model: string; technique: "DTG"; placement: "front" };
  // The front print area in inches. The print file is this rectangle at DPI pixels per inch.
  printArea: { widthIn: number; heightIn: number };
  // Guides drawn inside the print area: keep the design this far from its edges.
  safeInsetIn: number;
  dpi: number;
  // False while the print area comes from a listing rather than Printful itself.
  verified: boolean;
  sources: Array<string>;
  colors: Array<ShirtColor>;
};

// Comfort Colors 1717 through Printful (catalog product 586, "Unisex Garment-Dyed Heavyweight
// T-Shirt | Comfort Colors 1717"; DTG front is its default placement).
//
// Print area: 15 x 17 in, from listings that give the 1717's front print file as 4500 x 5100 px
// at 300 DPI. Unverified: Printful's printfile endpoint (GET /mockup-generator/printfiles/586)
// needs a store token, which this project doesn't have yet. Check it once a Printful key exists.
//
// Colors and variant IDs: Printful's public catalog, GET https://api.printful.com/products/586
// (fetched 2026-10-03). Hex values are Printful's swatch colors.
export const COMFORT_COLORS_1717: PrintProduct = {
  key: "cc1717",
  name: "Heavyweight garment-dyed tee",
  vendor: "CultRemix",
  productType: "T-Shirt",
  printful: { productId: 586, model: "1717", technique: "DTG", placement: "front" },
  printArea: { widthIn: 15, heightIn: 17 },
  safeInsetIn: 0.5,
  dpi: 300,
  verified: false,
  sources: [
    "https://api.printful.com/products/586 (product, variants, colors; public catalog)",
    "https://mydesigns.io/product-catalog/t-shirts/product/comfort-colors-1717 (front print file 4500 x 5100 px)",
    "https://dynamicmockups.com (Comfort Colors 1717 print file 15:17)",
  ],
  colors: [
    { name: "Black", hex: "#1b1b1c", variants: { S: 15114, M: 15115, L: 15116, XL: 15117, "2XL": 15118 } },
    { name: "White", hex: "#ffffff", variants: { S: 15124, M: 15125, L: 15126, XL: 15127, "2XL": 15128 } },
    { name: "Ivory", hex: "#fff4d9", variants: { S: 16523, M: 16524, L: 16525, XL: 16526, "2XL": 16527 } },
    { name: "True Navy", hex: "#1e2c4a", variants: { S: 15181, M: 15182, L: 15183, XL: 15184, "2XL": 15185 } },
    { name: "Red", hex: "#bb1035", variants: { S: 15119, M: 15120, L: 15121, XL: 15123, "2XL": 15122 } },
    { name: "Grey", hex: "#92928f", variants: { S: 15176, M: 15177, L: 15178, XL: 15179, "2XL": 15180 } },
    { name: "Pepper", hex: "#514f4c", variants: { S: 17693, M: 17694, L: 17695, XL: 17696, "2XL": 17697 } },
    { name: "Blue Jean", hex: "#707e8d", variants: { S: 16511, M: 16512, L: 16513, XL: 16514, "2XL": 16515 } },
    { name: "Butter", hex: "#ffe09e", variants: { S: 15166, M: 15167, L: 15168, XL: 15169, "2XL": 15170 } },
    { name: "Sage", hex: "#49482e", variants: { S: 21562, M: 21563, L: 21564, XL: 21565, "2XL": 21566 } },
    { name: "Brick", hex: "#8d4b54", variants: { S: 15161, M: 15162, L: 15163, XL: 15164, "2XL": 15165 } },
    { name: "Seafoam", hex: "#69a999", variants: { S: 16529, M: 16530, L: 16531, XL: 16532, "2XL": 16533 } },
  ],
};

export const PRINT_PRODUCT = COMFORT_COLORS_1717;

export function shirtColor(name: string | undefined, product: PrintProduct = PRINT_PRODUCT) {
  return product.colors.find((color) => color.name === name) ?? product.colors[0];
}

// ---- Selling it (KTD-17: 4 launch colors, S-2XL, $36 and $39 for 2XL) ----

export const PRINT_SIZES = ["S", "M", "L", "XL", "2XL"] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

export type PrintColor = {
  // Upper-case code used in SKUs.
  code: string;
  // Option value shown to buyers.
  name: string;
  hex: string;
  // Printful catalog variant ID per size, from the product's catalog colors above. null would send
  // an order to needs_attention instead of Printful.
  printfulVariantIds: Record<PrintSize, number | null>;
};

// The colors offered at launch, with their Printful variants from the catalog above.
const LAUNCH_COLORS = ["White", "Ivory", "Pepper", "Black"];

export const PRINT_COLORS: ReadonlyArray<PrintColor> = LAUNCH_COLORS.map((name) => {
  const color = PRINT_PRODUCT.colors.find((c) => c.name === name);
  if (!color) throw new Error("Launch color missing from the catalog: " + name);
  return { code: name.toUpperCase().replace(/[^A-Z0-9]+/gu, ""), name: color.name, hex: color.hex, printfulVariantIds: { ...color.variants } };
});

export const BASE_PRICE_CENTS = 3600;
export const LARGE_PRICE_CENTS = 3900;

export function priceCentsFor(size: PrintSize): number {
  return size === "2XL" ? LARGE_PRICE_CENTS : BASE_PRICE_CENTS;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
