import { PRINT_COLORS, PRINT_PRODUCT } from "../../shared/config/print-products";
import { GARMENT_COLORS } from "./garments";
import type { PrintColor } from "../../shared/config/print-products";
import type { GarmentColor } from "./garments";

// Which shirt colors a work can be sold in. Works store garment color keys (`works.offeredColors`,
// convex/lib/garments.ts); Shopify and Printful need the print catalog's colors
// (shared/config/print-products.ts). catalogColorFor is the one place a key becomes a catalog color.
// Shared by Convex and the browser, so nothing here may import server code.

// A color the shop can sell: the garment color the creator picked (key, name, swatch hex, as the
// work page shows it) with the catalog color behind it (SKU code, Printful variant IDs).
export type SellableColor = PrintColor & { key: string };

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

export function colorCode(catalogName: string): string {
  return catalogName.toUpperCase().replace(/[^A-Z0-9]+/gu, "");
}

// Every catalog color, by SKU code.
const CATALOG: ReadonlyArray<PrintColor> = PRINT_PRODUCT.colors.map((color) => ({
  code: colorCode(color.name),
  name: color.name,
  hex: color.hex,
  printfulVariantIds: { ...color.variants },
}));

function sellable(garment: GarmentColor): SellableColor | null {
  const catalog = CATALOG.find((color) => normalized(color.name) === normalized(garment.name));
  if (!catalog) return null;
  return { ...catalog, key: garment.key, name: garment.name, hex: garment.hex };
}

const BY_KEY = new Map(
  GARMENT_COLORS.flatMap((garment) => {
    const color = sellable(garment);
    return color ? [[garment.key, color] as const] : [];
  }),
);

// The catalog color a garment color key is printed on, or null when the print catalog doesn't
// carry it (those colors can be shown but not sold).
export function catalogColorFor(key: string): SellableColor | null {
  return BY_KEY.get(key.trim().toLowerCase()) ?? null;
}

// The launch colors, for works published before creators chose colors.
export const LAUNCH_SELLABLE: ReadonlyArray<SellableColor> = PRINT_COLORS.map((launch) => {
  const color = [...BY_KEY.values()].find((c) => c.code === launch.code);
  if (!color) throw new Error("Launch color has no garment color: " + launch.name);
  return color;
});

// What a work is sold in: its offered colors that the catalog carries, lead first, or the launch
// colors when it has none. A work whose offered colors are all unprintable gets an empty list;
// it is not quietly switched to colors its creator didn't pick.
export function sellableColors(offeredKeys: ReadonlyArray<string> | undefined): Array<SellableColor> {
  if (!offeredKeys || offeredKeys.length === 0) return [...LAUNCH_SELLABLE];
  const out: Array<SellableColor> = [];
  for (const key of offeredKeys) {
    const color = catalogColorFor(key);
    if (color && !out.some((c) => c.code === color.code)) out.push(color);
  }
  return out;
}

// Any catalog color by SKU code, for orders whose variant rows predate stored Printful IDs.
export function catalogColorByCode(code: string): PrintColor | null {
  return CATALOG.find((color) => color.code === code) ?? null;
}
