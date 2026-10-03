// Transparency measurements of a design, from its alpha channel alone (one byte per pixel), so the
// server can measure a 6000 px upscale without holding its colors.

// The image model paints "solid" areas at alpha 240-254 (docs/image-generation/README.md). The
// print file rounds those up to 255, so they count as solid here too.
export const SOLID_ALPHA = 240;
// Pixels this close to a solid one are its soft edge, not haze.
export const EDGE_BAND_PX = 2;

export type AlphaMetrics = {
  width: number;
  height: number;
  // Any pixel that isn't fully solid: the file carries real transparency.
  hasAlpha: boolean;
  // Pixels at SOLID_ALPHA or more.
  solid: number;
  // Pixels with any alpha at all (1-255).
  visible: number;
  // Partly transparent pixels (1 to SOLID_ALPHA - 1) more than EDGE_BAND_PX from a solid pixel.
  haze: number;
};

// Rounds near-solid alpha to fully solid, in place. The print file and the checks agree on this.
export function roundSolid(alpha: Uint8Array) {
  for (let i = 0; i < alpha.length; i++) if (alpha[i] >= SOLID_ALPHA) alpha[i] = 255;
  return alpha;
}

// The alpha channel of RGBA pixels.
export function alphaOf(rgba: Uint8Array | Uint8ClampedArray) {
  const alpha = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return alpha;
}

// Marks every pixel within `radius` (in both directions, a square) of a marked pixel. Two passes
// of a running window, so it costs the same for any radius.
export function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) count += mask[row + x];
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += mask[row + x + radius];
      if (x - radius - 1 >= 0) count -= mask[row + x - radius - 1];
      across[row + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y++) count += across[y * width + x];
    for (let y = 0; y < height; y++) {
      if (y + radius < height) count += across[(y + radius) * width + x];
      if (y - radius - 1 >= 0) count -= across[(y - radius - 1) * width + x];
      out[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

export function measureAlpha(alpha: Uint8Array, width: number, height: number): AlphaMetrics {
  if (alpha.length !== width * height) throw new Error("Alpha size doesn't match the image.");
  const solidMask = new Uint8Array(alpha.length);
  let solid = 0;
  let visible = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a >= SOLID_ALPHA) {
      solidMask[i] = 1;
      solid++;
    }
    if (a > 0) visible++;
  }
  const near = dilate(solidMask, width, height, EDGE_BAND_PX);
  let haze = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a > 0 && a < SOLID_ALPHA && !near[i]) haze++;
  }
  return { width, height, hasAlpha: solid < alpha.length, solid, visible, haze };
}

// Haze as a share of the pixels that show (KTD-9).
export function hazeShare(metrics: AlphaMetrics) {
  return metrics.visible === 0 ? 0 : metrics.haze / metrics.visible;
}
