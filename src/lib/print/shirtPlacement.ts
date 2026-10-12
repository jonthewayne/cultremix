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
//
// A back print can also carry a chest mark (`mark`): the same design, small, on the front over the
// wearer's left chest. Its width is in inches, the same on every product, since a chest mark is a
// fixed size rather than a share of the print area.

export type PrintSide = "front" | "back";
export type PrintArea = { widthIn: number; heightIn: number };
export type RelativePlacement = { side: PrintSide; size: number; drop: number; mark?: number };
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

// Chest marks, in inches wide. A tall design is held to MARK_MAX_HEIGHT_IN so it stays a chest mark.
export const MARK_MIN_IN = 2;
export const MARK_MAX_IN = 5;
export const MARK_MAX_HEIGHT_IN = 4.5;
export const MARK_PRESETS = [
  { key: "small", label: "Small", widthIn: 3 },
  { key: "medium", label: "Medium", widthIn: 4 },
] as const;
export const DEFAULT_MARK_IN = 3;
// The mark's top edge below the top of the front print area, which starts just under the collar.
export const MARK_TOP_IN = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

// The widest the design can go on an area (aspect = height / width).
export function fullWidthIn(aspect: number, area: PrintArea) {
  const fit = Math.min(area.widthIn - 2 * EDGE_IN, (area.heightIn - 2 * EDGE_IN) / safeAspect(aspect));
  return Math.max(0.5, fit);
}

// Any input made safe: a known side, size between MIN_SIZE and 1, drop between 0 and 1, and a chest
// mark only on a back print, between MARK_MIN_IN and MARK_MAX_IN wide.
export function clampRelative(placement: Partial<RelativePlacement> | null | undefined): RelativePlacement {
  const side = placement?.side === "back" ? "back" : "front";
  const out: RelativePlacement = {
    side,
    size: round3(Math.min(1, Math.max(MIN_SIZE, finite(placement?.size, DEFAULT_PLACEMENT.size)))),
    drop: round3(Math.min(1, Math.max(0, finite(placement?.drop, DEFAULT_PLACEMENT.drop)))),
  };
  const mark = placement?.mark;
  if (side === "back" && typeof mark === "number" && Number.isFinite(mark)) {
    out.mark = round2(Math.min(MARK_MAX_IN, Math.max(MARK_MIN_IN, mark)));
  }
  return out;
}

// The same placement moved to the front (a product with no back prints there), without a chest mark.
export function onFront(placement: RelativePlacement): RelativePlacement {
  return { side: "front", size: placement.size, drop: placement.drop };
}

// The same placement without its chest mark.
export function withoutMark(placement: RelativePlacement): RelativePlacement {
  return { side: placement.side, size: placement.size, drop: placement.drop };
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
  // Centered every time: a small print without it reads as a left-chest logo, and the print file
  // always centers the design.
  if (rel.size < 0.5) return `a small print centered on the ${where}, not off to one side`;
  if (rel.size < 0.75) return `a medium-size print centered on the ${where}`;
  if (rel.size < 0.95) return `a large print centered on the ${where}`;
  return rel.side === "back" ? "a big print filling most of the back" : "a big print filling most of the front";
}

export function sameRelative(a: RelativePlacement, b: RelativePlacement) {
  return (
    a.side === b.side &&
    Math.abs(a.size - b.size) < 0.001 &&
    Math.abs(a.drop - b.drop) < 0.001 &&
    (a.mark === undefined) === (b.mark === undefined) &&
    Math.abs((a.mark ?? 0) - (b.mark ?? 0)) < 0.01
  );
}

// Where a chest mark sits on the front print area, from its top-left corner: over the wearer's left
// chest, which is the right half as you face the shirt, centered a quarter of the area's width right
// of center, MARK_TOP_IN down, and EDGE_IN clear of the edge.
export function markPlacement(markIn: number, aspect: number, area: PrintArea): Placement {
  const half = area.widthIn / 2 - EDGE_IN;
  const widthIn = round2(Math.max(0.5, Math.min(markIn, MARK_MAX_HEIGHT_IN / safeAspect(aspect), half)));
  const center = area.widthIn * 0.75;
  const xIn = round2(Math.max(area.widthIn / 2, Math.min(area.widthIn - EDGE_IN - widthIn, center - widthIn / 2)));
  const yIn = round2(Math.min(MARK_TOP_IN, Math.max(0, area.heightIn - EDGE_IN - placedHeight(widthIn, safeAspect(aspect)))));
  return { xIn, yIn, widthIn };
}

// The preset a chest mark's width is, if it's one.
export function markKeyOf(markIn: number | undefined) {
  if (markIn === undefined) return null;
  return MARK_PRESETS.find((preset) => Math.abs(preset.widthIn - markIn) < 0.05)?.key ?? null;
}
