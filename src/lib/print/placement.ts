import type { PrintGeometry } from "../../../shared/config/print-products";

// Where a design sits in the shirt's front print area, in inches from the area's top-left corner.
// Its height follows from its width and the design's shape (aspect = height / width).
export type Placement = { xIn: number; yIn: number; widthIn: number };

export const MIN_WIDTH_IN = 2;
// A width most chest prints use, when the design and the area allow it.
export const DEFAULT_WIDTH_IN = 12;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function aspectOf(widthPx: number, heightPx: number) {
  return widthPx > 0 ? heightPx / widthPx : 1;
}

export function placedHeight(widthIn: number, aspect: number) {
  return widthIn * aspect;
}

// The widest the design can go and still fit the area.
export function maxWidthIn(aspect: number, product: PrintGeometry) {
  return Math.min(product.printArea.widthIn, product.printArea.heightIn / aspect);
}

// Keeps a placement inside the print area: the width between MIN_WIDTH_IN and what fits, the
// design wholly inside. Values round to hundredths of an inch.
export function clampPlacement(placement: Placement, aspect: number, product: PrintGeometry): Placement {
  const area = product.printArea;
  const max = maxWidthIn(aspect, product);
  const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
  const widthIn = round2(Math.min(max, Math.max(Math.min(MIN_WIDTH_IN, max), finite(placement.widthIn, DEFAULT_WIDTH_IN))));
  const heightIn = placedHeight(widthIn, aspect);
  const xIn = round2(Math.min(area.widthIn - widthIn, Math.max(0, finite(placement.xIn, 0))));
  const yIn = round2(Math.min(area.heightIn - heightIn, Math.max(0, finite(placement.yIn, 0))));
  return { xIn: Math.max(0, xIn), yIn: Math.max(0, yIn), widthIn };
}

export function centered(placement: Placement, product: PrintGeometry): Placement {
  return { ...placement, xIn: round2((product.printArea.widthIn - placement.widthIn) / 2) };
}

// Printful places a file from the top of its print area; "Top" puts the design at the safe line.
export function atTop(placement: Placement, product: PrintGeometry): Placement {
  return { ...placement, yIn: product.safeInsetIn };
}

// A new design: as wide as DEFAULT_WIDTH_IN allows inside the safe area, centered, at the top.
export function defaultPlacement(aspect: number, product: PrintGeometry): Placement {
  const inset = product.safeInsetIn;
  const safeWidth = product.printArea.widthIn - 2 * inset;
  const safeHeight = product.printArea.heightIn - 2 * inset;
  const widthIn = round2(Math.min(DEFAULT_WIDTH_IN, safeWidth, safeHeight / aspect));
  return clampPlacement(atTop(centered({ xIn: 0, yIn: 0, widthIn }, product), product), aspect, product);
}

// Whether the design stays inside the safe guides.
export function insideSafeArea(placement: Placement, aspect: number, product: PrintGeometry) {
  const inset = product.safeInsetIn;
  const eps = 0.005;
  return (
    placement.xIn >= inset - eps &&
    placement.yIn >= inset - eps &&
    placement.xIn + placement.widthIn <= product.printArea.widthIn - inset + eps &&
    placement.yIn + placedHeight(placement.widthIn, aspect) <= product.printArea.heightIn - inset + eps
  );
}

// The print file's canvas: the whole print area at the product's DPI.
export function canvasPx(product: PrintGeometry) {
  return {
    width: Math.round(product.printArea.widthIn * product.dpi),
    height: Math.round(product.printArea.heightIn * product.dpi),
  };
}

// The design's rectangle on that canvas, in whole pixels, always inside it.
export function pixelRect(placement: Placement, aspect: number, product: PrintGeometry) {
  const canvas = canvasPx(product);
  const width = Math.max(1, Math.min(canvas.width, Math.round(placement.widthIn * product.dpi)));
  const height = Math.max(1, Math.min(canvas.height, Math.round(placedHeight(placement.widthIn, aspect) * product.dpi)));
  const left = Math.min(canvas.width - width, Math.max(0, Math.round(placement.xIn * product.dpi)));
  const top = Math.min(canvas.height - height, Math.max(0, Math.round(placement.yIn * product.dpi)));
  return { left, top, width, height };
}
