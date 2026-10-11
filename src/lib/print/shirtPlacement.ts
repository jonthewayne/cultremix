import { placedHeight } from "./placement";
import type { Placement } from "./placement";

// Where a design sits on a product, chosen once when it's published and carried to every product it
// sells on. It's relative, so one choice fits a tee, a hoodie, or a back print alike:
//
//   side  front or back
//   size  a share of Full, the largest the design fits on that side with EDGE_IN clear all round
//   drop  a share of the room left above and below it: 0 at the top of the print area, 1 at the bottom
//
// It's always centered left to right. Each product turns it into inches for its own print area
// (toInches), so "Medium, near the top" looks like Medium near the top on everything. A creator can
// adjust any one product; that product then keeps its own.

export type PrintSide = "front" | "back";
export type PrintArea = { widthIn: number; heightIn: number };
export type RelativePlacement = { side: PrintSide; size: number; drop: number };
// The same on one print area, in inches: the design's width and its top edge below the area's top.
export type InchPlacement = { side: PrintSide; widthIn: number; yIn: number };

// Full keeps this much room inside the print area on every side.
export const EDGE_IN = 0.5;
// The smallest size: about two inches wide on a tee.
export const MIN_SIZE = 0.2;

export const SIZE_PRESETS = [
  { key: "small", label: "Small", size: 0.4 },
  { key: "medium", label: "Medium", size: 0.65 },
  { key: "large", label: "Large", size: 0.85 },
  { key: "full", label: "Full", size: 1 },
] as const;
export type SizeKey = (typeof SIZE_PRESETS)[number]["key"];

// Large, near the top: about 9 inches wide on a tee, its top about an inch into the print area.
export const DEFAULT_PLACEMENT: RelativePlacement = { side: "front", size: 0.85, drop: 0.08 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

// The widest the design can go on an area (aspect = height / width).
export function fullWidthIn(aspect: number, area: PrintArea) {
  const fit = Math.min(area.widthIn - 2 * EDGE_IN, (area.heightIn - 2 * EDGE_IN) / safeAspect(aspect));
  return Math.max(0.5, fit);
}

// Any input made safe: a known side, size between MIN_SIZE and 1, drop between 0 and 1.
export function clampRelative(placement: Partial<RelativePlacement> | null | undefined): RelativePlacement {
  return {
    side: placement?.side === "back" ? "back" : "front",
    size: round3(Math.min(1, Math.max(MIN_SIZE, finite(placement?.size, DEFAULT_PLACEMENT.size)))),
    drop: round3(Math.min(1, Math.max(0, finite(placement?.drop, DEFAULT_PLACEMENT.drop)))),
  };
}

// The placement on one print area, in inches, centered and EDGE_IN clear of every edge.
export function toInches(placement: RelativePlacement, aspect: number, area: PrintArea): InchPlacement {
  const rel = clampRelative(placement);
  const widthIn = round2(rel.size * fullWidthIn(aspect, area));
  const room = Math.max(0, area.heightIn - 2 * EDGE_IN - placedHeight(widthIn, safeAspect(aspect)));
  return { side: rel.side, widthIn, yIn: round2(EDGE_IN + rel.drop * room) };
}

// Back from inches, for a placement made in inches (the Print Studio's).
export function toRelative(placement: InchPlacement, aspect: number, area: PrintArea): RelativePlacement {
  const room = Math.max(0, area.heightIn - 2 * EDGE_IN - placedHeight(placement.widthIn, safeAspect(aspect)));
  return clampRelative({
    side: placement.side,
    size: placement.widthIn / fullWidthIn(aspect, area),
    drop: room > 0 ? (placement.yIn - EDGE_IN) / room : 0,
  });
}

// The preset a size is, if it's one.
export function sizeKeyOf(size: number): SizeKey | null {
  return SIZE_PRESETS.find((preset) => Math.abs(preset.size - size) < 0.015)?.key ?? null;
}

// The same placement in the Print Studio's terms (src/lib/print/placement.ts): from the print
// area's top-left corner.
export function areaPlacement(placement: InchPlacement, area: PrintArea): Placement {
  return {
    xIn: round2(Math.max(0, (area.widthIn - placement.widthIn) / 2)),
    yIn: placement.yIn,
    widthIn: placement.widthIn,
  };
}

// Words for the model photo's prompt: "a medium-size print centered on the upper chest".
export function sizeWords(placement: RelativePlacement) {
  const rel = clampRelative(placement);
  const part = rel.side === "back" ? "back" : "chest";
  const where = rel.drop < 0.3 ? `upper ${part}` : rel.drop > 0.7 ? `lower ${part}` : part;
  if (rel.size < 0.5) return `a small print on the ${where}`;
  if (rel.size < 0.75) return `a medium-size print centered on the ${where}`;
  if (rel.size < 0.95) return `a large print centered on the ${where}`;
  return rel.side === "back" ? "a big print filling most of the back" : "a big print filling most of the front";
}

export function sameRelative(a: RelativePlacement, b: RelativePlacement) {
  return a.side === b.side && Math.abs(a.size - b.size) < 0.001 && Math.abs(a.drop - b.drop) < 0.001;
}

