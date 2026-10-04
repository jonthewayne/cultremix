// The studio's rules, shared by the Convex functions and the studio page (safe in the browser;
// tests/unit/clientBoundary.test.ts). docs/image-generation/README.md explains the numbers.

// A batch is one 2x2 grid call (high quality, about 10-11¢ of image cost) cut into four designs.
export const DESIGNS_PER_BATCH = 4;
export const BATCH_CREDITS = 2;

// Credits back when designs don't come out of a batch: 1 for one or two missing, 2 for three or
// four, so a batch that fails or is blocked costs nothing.
export function creditsBack(missing: number) {
  const share = (Math.max(0, Math.min(missing, DESIGNS_PER_BATCH)) * BATCH_CREDITS) / DESIGNS_PER_BATCH;
  return Math.ceil(share);
}

// Numbered images to work on, and styles in the mixer. One call took 16 images in testing, with
// every image's subject kept; these leave room under that.
export const MAX_IMAGES = 8;
export const MAX_STYLES = 4;

// Sessions count their batches up to this; past it the studio shows "100+".
export const BATCH_COUNT_CAP = 100;
