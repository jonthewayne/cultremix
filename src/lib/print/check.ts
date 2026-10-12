import { hazeShare } from "./alpha";
import { dpiGrade, sourceDpi } from "./dpi";
import { aspectOf, insideSafeArea, placedHeight } from "./placement";
import type { PrintGeometry } from "../../../shared/config/print-products";
import type { AlphaMetrics } from "./alpha";
import type { DpiGrade } from "./dpi";
import type { Placement } from "./placement";

// The print check (KTD-9), the same in the browser preview and in the server render.

export const COVERAGE_MIN = 0.02;
export const COVERAGE_MAX = 0.98;
export const HAZE_WARN = 0.05;
export const HAZE_REFUSE = 0.1;

export type CheckStatus = "ok" | "warn" | "refuse";
export type CheckItem = { key: "dpi" | "alpha" | "coverage" | "haze" | "safe"; status: CheckStatus; label: string };

export type PrintCheck = {
  dpi: number;
  grade: DpiGrade;
  widthIn: number;
  heightIn: number;
  // Share of the print area that prints solid.
  coverage: number;
  haze: number;
  items: Array<CheckItem>;
  ready: boolean;
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function coverageShare(metrics: AlphaMetrics, placement: Placement, product: PrintGeometry) {
  const pixels = metrics.width * metrics.height;
  if (pixels === 0) return 0;
  const aspect = aspectOf(metrics.width, metrics.height);
  const placedArea = placement.widthIn * placedHeight(placement.widthIn, aspect);
  const printArea = product.printArea.widthIn * product.printArea.heightIn;
  return (metrics.solid / pixels) * (placedArea / printArea);
}

export function printCheck(metrics: AlphaMetrics, placement: Placement, product: PrintGeometry): PrintCheck {
  const aspect = aspectOf(metrics.width, metrics.height);
  const heightIn = placedHeight(placement.widthIn, aspect);
  const dpi = sourceDpi(metrics.width, metrics.height, placement.widthIn, heightIn);
  const grade = dpiGrade(dpi);
  const coverage = coverageShare(metrics, placement, product);
  const haze = hazeShare(metrics);
  const items: Array<CheckItem> = [];

  const shownDpi = Math.floor(dpi);
  if (grade === "refused") {
    items.push({ key: "dpi", status: "refuse", label: `${shownDpi} DPI at this size. Make it smaller or upscale it (150 or more prints sharp).` });
  } else {
    items.push({ key: "dpi", status: "ok", label: `${shownDpi} DPI at this size: ${grade === "great" ? "great" : "good"}.` });
  }

  items.push(
    metrics.hasAlpha
      ? { key: "alpha", status: "ok", label: "Transparent background." }
      : { key: "alpha", status: "refuse", label: "No transparency: the whole rectangle would print. Knock out the background." },
  );

  if (coverage < COVERAGE_MIN) {
    items.push({ key: "coverage", status: "refuse", label: `Only ${pct(coverage)} of the print area has ink. Make it bigger.` });
  } else if (coverage > COVERAGE_MAX) {
    items.push({ key: "coverage", status: "refuse", label: `${pct(coverage)} of the print area is solid ink. Knock out the background.` });
  } else {
    items.push({ key: "coverage", status: "ok", label: `${pct(coverage)} of the print area has ink.` });
  }

  if (haze > HAZE_REFUSE) {
    items.push({ key: "haze", status: "refuse", label: `${pct(haze)} faint haze would print as a cloudy film. Knock it out first.` });
  } else if (haze >= HAZE_WARN) {
    items.push({ key: "haze", status: "warn", label: `${pct(haze)} faint haze. It may print as a light film.` });
  } else {
    items.push({ key: "haze", status: "ok", label: "Clean edges." });
  }

  if (!insideSafeArea(placement, aspect, product)) {
    items.push({ key: "safe", status: "warn", label: "Past the safe line: edges may be cut close." });
  }

  return {
    dpi,
    grade,
    widthIn: placement.widthIn,
    heightIn,
    coverage,
    haze,
    items,
    ready: items.every((item) => item.status !== "refuse"),
  };
}

// The work page's status line.
export function readyLine(dpi: number, widthIn: number) {
  return `Print file ready, ${Math.floor(dpi)} DPI at ${(Math.round(widthIn * 10) / 10).toFixed(1)} in`;
}
