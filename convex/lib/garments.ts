// The launch shirt and the colors it comes in (V1 KTD-17; amendment A5). Works store the keys of
// the colors they're offered in (`works.offeredColors`), lead color first: the shop page shows the
// lead first and the model photo is shot on it. Shared by Convex and the browser, so nothing here
// may import server code. An admin can pick the shirt and its offered colors from Printful's
// catalog (convex/merch.ts, /admin/products); the functions below take that palette, and fall back
// to GARMENT_COLORS until one is set.

export type GarmentColor = { key: string; name: string; hex: string };
// The colors on offer: the active shirt's (convex/merch.ts palette), or GARMENT_COLORS.
export type Palette = ReadonlyArray<GarmentColor>;

// A color's key from its catalog name: "True Navy" is "true-navy", as the launch colors' keys are.
export function colorKey(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

export const LAUNCH_GARMENT = {
  key: "heavyweight-tee",
  name: "Heavyweight garment-dyed tee",
  priceCents: 3600,
} as const;

// The longest shop-page description a creator can write when publishing.
export const MAX_DESCRIPTION_LENGTH = 280;

// Garment-dyed shades, lightest first. The hex values are close to the dyed fabric, for previews.
export const GARMENT_COLORS: ReadonlyArray<GarmentColor> = [
  { key: "white", name: "White", hex: "#f7f6f2" },
  { key: "ivory", name: "Ivory", hex: "#efe8d8" },
  { key: "butter", name: "Butter", hex: "#f2df9c" },
  { key: "chalky-mint", name: "Chalky mint", hex: "#b4dccb" },
  { key: "bay", name: "Bay", hex: "#b9c3ae" },
  { key: "watermelon", name: "Watermelon", hex: "#e2737b" },
  { key: "blue-jean", name: "Blue jean", hex: "#5d7590" },
  { key: "moss", name: "Moss", hex: "#6c6c47" },
  { key: "crimson", name: "Crimson", hex: "#8c2a35" },
  { key: "pepper", name: "Pepper", hex: "#545454" },
  { key: "true-navy", name: "True navy", hex: "#2c3447" },
  { key: "black", name: "Black", hex: "#1f1f1f" },
];

// The four a design is offered in unless the creator picks others.
export const DEFAULT_COLOR_KEYS: ReadonlyArray<string> = ["ivory", "black", "true-navy", "butter"];
export const DEFAULT_COLOR_COUNT = 4;

const BY_KEY = new Map(GARMENT_COLORS.map((color) => [color.key, color]));

export function garmentColor(key: string, palette?: Palette): GarmentColor | undefined {
  return palette?.find((color) => color.key === key) ?? BY_KEY.get(key);
}

export type OfferedColorsResult = { ok: true; keys: Array<string> } | { ok: false; message: string };

// Offered colors must be colors the shirt comes in, at least one. Repeats collapse, keeping the
// first, so the lead color stays first.
export function validateOfferedColors(keys: ReadonlyArray<string>, palette: Palette = GARMENT_COLORS): OfferedColorsResult {
  const known = new Set(palette.map((color) => color.key));
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const raw of keys) {
    const key = raw.trim().toLowerCase();
    if (!known.has(key)) return { ok: false, message: "Pick colors from the swatch board." };
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (out.length === 0) return { ok: false, message: "Pick at least one shirt color." };
  return { ok: true, keys: out };
}

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// sRGB to CIE Lab (D65), for color differences that roughly match what eyes see.
export function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// The garment color closest to any hex (a design's background), so a design keeps its look.
export function nearestGarmentColor(hex: string, palette: Palette = GARMENT_COLORS): GarmentColor {
  const rgb = rgbOf(hex);
  if (palette.length === 0) return BY_KEY.get("ivory")!;
  if (!rgb) return palette.find((color) => color.key === "ivory") ?? palette[0];
  const lab = toLab(rgb);
  let best = palette[0];
  let bestDistance = Infinity;
  for (const color of palette) {
    const rgbColor = rgbOf(color.hex);
    if (!rgbColor) continue;
    const distance = labDistance(lab, toLab(rgbColor));
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

// The colors a design starts with: its own background's nearest shade first, then the defaults,
// skipping any the contrast check says it would disappear on.
export function defaultOfferedColors(backgroundHex: string, hidden: ReadonlySet<string> = new Set(), palette: Palette = GARMENT_COLORS) {
  const keys = [nearestGarmentColor(backgroundHex, palette).key];
  const known = new Set(palette.map((color) => color.key));
  const fill = (candidates: ReadonlyArray<string>) => {
    for (const key of candidates) {
      if (keys.length >= DEFAULT_COLOR_COUNT) return;
      if (known.has(key) && !keys.includes(key) && !hidden.has(key)) keys.push(key);
    }
  };
  fill(DEFAULT_COLOR_KEYS);
  fill(palette.map((color) => color.key));
  return keys;
}

// Advisory contrast check (A5). `pixels` are the design's visible pixels as [r, g, b]. A pixel
// blends in when it's within BLEND_DISTANCE of the shirt in Lab, or when it's nearly the same
// brightness (under LOW_CONTRAST to 1) without a strong hue difference: dark ink on navy reads as
// one shade on fabric. When most of the design blends in, it would disappear on that shirt.
export type Visibility = "clear" | "faint" | "disappears";

const BLEND_DISTANCE = 14;
const LOW_CONTRAST = 1.5;
const HUE_DISTANCE = 30;
const FAINT_SHARE = 0.3;
const DISAPPEARS_SHARE = 0.6;

export function blendShare(pixels: ReadonlyArray<[number, number, number]>, shirtHex: string): number {
  const shirt = rgbOf(shirtHex);
  if (!shirt || pixels.length === 0) return 0;
  const shirtLab = toLab(shirt);
  let blended = 0;
  for (const pixel of pixels) {
    const lab = toLab(pixel);
    const distance = labDistance(lab, shirtLab);
    if (distance < BLEND_DISTANCE || (distance < HUE_DISTANCE && contrastRatio(lab, shirtLab) < LOW_CONTRAST)) {
      blended++;
    }
  }
  return blended / pixels.length;
}

// WCAG contrast ratio from Lab lightness.
function contrastRatio(a: [number, number, number], b: [number, number, number]) {
  const luminance = ([l]: [number, number, number]) => (l > 8 ? ((l + 16) / 116) ** 3 : l / 903.3);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function visibilityOn(pixels: ReadonlyArray<[number, number, number]>, shirtHex: string): Visibility {
  const share = blendShare(pixels, shirtHex);
  if (share >= DISAPPEARS_SHARE) return "disappears";
  if (share >= FAINT_SHARE) return "faint";
  return "clear";
}
