import { garmentColor, toLab } from "../../../convex/lib/garments";
import { PRINT_PRODUCT } from "../../../shared/config/print-products";
import { parseHex } from "./knockout";
import type { PrintProduct } from "../../../shared/config/print-products";

function labOf(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  return rgb ? toLab([rgb.r, rgb.g, rgb.b]) : null;
}

// The print product's color for one garment color: the same name when the product has it ("True
// navy" is "True Navy"), else the nearest shade.
function productColorFor(key: string, product: PrintProduct) {
  const garment = garmentColor(key);
  if (!garment) return undefined;
  const named = product.colors.find((color) => color.name.toLowerCase() === garment.name.toLowerCase());
  if (named) return named;
  const target = labOf(garment.hex);
  if (!target) return undefined;
  let best = product.colors[0];
  let bestDistance = Infinity;
  for (const color of product.colors) {
    const lab = labOf(color.hex);
    if (!lab) continue;
    const distance = (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [color, distance];
  }
  return best;
}

// The colors a work was published in (works.offeredColors, garment keys from
// convex/lib/garments.ts), as the print product's color names, lead first. Repeats collapse.
// Empty when the work has none; Print Studio then offers every product color.
export function offeredPrintColors(keys: ReadonlyArray<string> | undefined, product: PrintProduct = PRINT_PRODUCT) {
  const names: Array<string> = [];
  for (const key of keys ?? []) {
    const color = productColorFor(key, product);
    if (color && !names.includes(color.name)) names.push(color.name);
  }
  return names;
}
