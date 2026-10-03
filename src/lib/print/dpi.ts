// Source DPI: how many of the image's own pixels land on each printed inch (KTD-9). The smaller
// of the two directions counts, so a stretched side can't hide behind a sharp one.
export function sourceDpi(widthPx: number, heightPx: number, placedWidthIn: number, placedHeightIn: number) {
  if (placedWidthIn <= 0 || placedHeightIn <= 0) return 0;
  return Math.min(widthPx / placedWidthIn, heightPx / placedHeightIn);
}

export const DPI_REFUSED_BELOW = 150;
export const DPI_GREAT_FROM = 200;

export type DpiGrade = "refused" | "good" | "great";

// Under 150 the print looks soft; 150-199 prints well; 200 and up is as sharp as the shirt shows.
export function dpiGrade(dpi: number): DpiGrade {
  if (dpi < DPI_REFUSED_BELOW) return "refused";
  if (dpi < DPI_GREAT_FROM) return "good";
  return "great";
}

// The widest a design can print and still be good.
export function maxWidthAtDpi(widthPx: number, heightPx: number, dpi = DPI_REFUSED_BELOW) {
  if (widthPx <= 0 || heightPx <= 0) return 0;
  return widthPx / dpi;
}
