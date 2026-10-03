// The one garment CultRemix sells in V1 (decision 5, KTD-17): 4 colors, S-2XL, $36 ($39 for 2XL).
// Colors and Printful catalog variant IDs are placeholders until U0(d) records the garment's real
// list; printfulVariantId stays null until then, and an order for a variant without one waits in
// needs_attention instead of reaching Printful.

export const PRINT_PRODUCT = {
  key: "tee-heavyweight",
  name: "Heavyweight garment-dyed tee",
  vendor: "CultRemix",
  productType: "T-Shirt",
  // Printful placement and technique for the front print.
  placement: "front",
  technique: "dtg",
} as const;

export const PRINT_SIZES = ["S", "M", "L", "XL", "2XL"] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

export type PrintColor = {
  // Upper-case code used in SKUs.
  code: string;
  // Option value shown to buyers.
  name: string;
  hex: string;
  // Printful catalog variant ID per size (U0(d)); null until confirmed.
  printfulVariantIds: Record<PrintSize, number | null>;
};

const unconfirmed: Record<PrintSize, number | null> = { S: null, M: null, L: null, XL: null, "2XL": null };

export const PRINT_COLORS: ReadonlyArray<PrintColor> = [
  { code: "WHITE", name: "White", hex: "#F7F5F0", printfulVariantIds: { ...unconfirmed } },
  { code: "IVORY", name: "Ivory", hex: "#EFE6D2", printfulVariantIds: { ...unconfirmed } },
  { code: "PEPPER", name: "Pepper", hex: "#4F4C4A", printfulVariantIds: { ...unconfirmed } },
  { code: "BLACK", name: "Black", hex: "#1E1E1E", printfulVariantIds: { ...unconfirmed } },
];

export const BASE_PRICE_CENTS = 3600;
export const LARGE_PRICE_CENTS = 3900;

export function priceCentsFor(size: PrintSize): number {
  return size === "2XL" ? LARGE_PRICE_CENTS : BASE_PRICE_CENTS;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
