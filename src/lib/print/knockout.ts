// Knocking out a background color: pixels close enough to it become fully transparent. The
// browser runs this on a preview while the tolerance slider moves; the server runs the same code on
// the full image. Pixels never move and the size never changes.

export type Rgb = { r: number; g: number; b: number };

export type KnockoutParams = {
  color: Rgb;
  // 0-100: how far from the color a pixel may be and still go. 0 takes only the exact color.
  tolerance: number;
  // True: only the color that reaches the image's edge (the background), so the same color inside
  // the design stays. False: that color everywhere.
  fromEdges: boolean;
};

// The largest RGB distance, black to white.
const MAX_DISTANCE = Math.sqrt(3 * 255 * 255);

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

export function clampTolerance(tolerance: number) {
  if (!Number.isFinite(tolerance)) return 0;
  return Math.min(100, Math.max(0, Math.round(tolerance)));
}

// Squared RGB distance below which a pixel counts as the color.
function limit(tolerance: number) {
  const distance = (clampTolerance(tolerance) / 100) * MAX_DISTANCE;
  return distance * distance;
}

function matches(rgba: Uint8Array | Uint8ClampedArray, i: number, color: Rgb, max: number) {
  if (rgba[i + 3] === 0) return true;
  const dr = rgba[i] - color.r;
  const dg = rgba[i + 1] - color.g;
  const db = rgba[i + 2] - color.b;
  return dr * dr + dg * dg + db * db <= max;
}

// Which pixels the knockout clears (1) for the given RGBA pixels.
export function knockoutMask(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, params: KnockoutParams) {
  const max = limit(params.tolerance);
  const mask = new Uint8Array(width * height);
  if (!params.fromEdges) {
    for (let p = 0; p < mask.length; p++) if (matches(rgba, p * 4, params.color, max)) mask[p] = 1;
    return mask;
  }
  // Flood from every edge pixel through matching neighbors (4-connected).
  const stack: Array<number> = [];
  const visit = (p: number) => {
    if (mask[p] || !matches(rgba, p * 4, params.color, max)) return;
    mask[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < mask.length - width) visit(p + width);
  }
  return mask;
}

// Clears the knocked-out pixels in place; returns how many it cleared that showed before.
export function applyKnockout(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, params: KnockoutParams) {
  const mask = knockoutMask(rgba, width, height, params);
  let cleared = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    if (rgba[p * 4 + 3] > 0) cleared++;
    rgba[p * 4 + 3] = 0;
  }
  return cleared;
}

// The color most of the image's border is: the likely background to knock out.
export function borderColor(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Rgb | null {
  // Bucketed to 4 bits a channel so near-identical shades vote together; each bucket keeps the
  // sum of its colors so the answer is their average, not the bucket's corner.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const add = (p: number) => {
    const i = p * 4;
    if (rgba[i + 3] < 128) return;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += rgba[i];
    bucket.g += rgba[i + 1];
    bucket.b += rgba[i + 2];
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x++) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    add(y * width);
    add(y * width + width - 1);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  if (!best) return null;
  return { r: Math.round(best.r / best.count), g: Math.round(best.g / best.count), b: Math.round(best.b / best.count) };
}
