// What each paid call can cost at most, in whole cents, so the daily budget can hold a reservation
// before the call is made (plan KTD-4). Every number comes from billed amounts in
// docs/image-generation/README.md ("What a call costs"), measured 2026-09-30 to 2026-10-02 from the
// CultRemix Gateway's per-generation records and fal's price page. Bump PRICING_VERSION whenever a
// number here changes; each reservation records the version it was priced with.
//
// Pure TypeScript with no Convex imports, so tests and the browser can read it.

export const PRICING_VERSION = 2;

// The gateway's list prices for GPT Image 2.5, dollars per million tokens.
export const OUTPUT_DOLLARS_PER_M = 30;
export const IMAGE_INPUT_DOLLARS_PER_M = 8;
export const TEXT_INPUT_DOLLARS_PER_M = 5;

// Output tokens per call, as billed. High was only measured on the 1920x1920 grid (3,276 tokens,
// the largest of every call measured), so it bounds high quality on the smaller canvases too.
// Low was never measured; it is held to the medium bound.
const OUTPUT_TOKENS = {
  // One 1920x1920 grid of four: 819 at medium, 3,276 at high.
  grid: { medium: 819, high: 3276 },
  // One 1024x1536 design: 343 at medium. A 1024x1024 model photo is smaller, so the same bound holds.
  single: { medium: 343, high: 3276 },
} as const;

// Each input image: about 830 tokens for an image up to 1024 px and 1,630-1,690 measured for the
// largest; 1,700 bounds both.
export const INPUT_TOKENS_PER_IMAGE = 1700;
// The prompt's words: an instruction of up to 600 characters plus notes for up to 12 images stays
// well under 6,000 tokens. A model photo's prompt is under 1,000.
const STUDIO_PROMPT_TOKENS = 6000;
const PHOTO_PROMPT_TOKENS = 1000;
// The roles read before each grid (GPT-6 Luna, like image notes): 0.03-0.09 cents measured.
const ROLES_READ_CENTS = 0.5;
// Headroom over the sum above, for rounding and small changes in token counts.
const HEADROOM = 1.25;

// fal's Topaz Transparent upscale: $0.08 per started 24 megapixels of output (4x enlargement).
// A grid design comes out near 12 MP (8 cents); a 1024x1536 design is about 25 MP (16 cents).
export const TOPAZ_CENTS_PER_24MP = 8;

// Nano Banana 2.1 at 2K through the gateway, per call: 5.9-6.6 cents measured with no image or one
// (2026-10-06). It's priced per image, plus about 0.2 cents per input image; 12 covers eight.
export const NANO_BANANA_WORST_CENTS = 12;
// Recraft V4.1: 3.5 cents per image, the gateway's list price and every measured call.
export const RECRAFT_WORST_CENTS = 5;

export type Quality = "low" | "medium" | "high";

// The quality a call sends: GRID_QUALITY defaults to high, IMAGE_QUALITY and PHOTO_QUALITY to
// medium. Anything unrecognized (including "auto") is priced as high.
export function qualityOf(value: string | undefined, fallback: Quality): Quality {
  if (value === undefined || value === "") return fallback;
  return value === "low" || value === "medium" ? value : "high";
}

function outputTokens(canvas: keyof typeof OUTPUT_TOKENS, quality: Quality) {
  return quality === "high" ? OUTPUT_TOKENS[canvas].high : OUTPUT_TOKENS[canvas].medium;
}

function cents(outTokens: number, imageCount: number, promptTokens: number, extraCents = 0) {
  const dollars =
    (outTokens * OUTPUT_DOLLARS_PER_M +
      imageCount * INPUT_TOKENS_PER_IMAGE * IMAGE_INPUT_DOLLARS_PER_M +
      promptTokens * TEXT_INPUT_DOLLARS_PER_M) /
    1_000_000;
  return Math.ceil((dollars * 100 + extraCents) * HEADROOM);
}

// One studio batch made as a 2x2 grid (convex/imageGen.ts gridImage), with its roles read.
// At high: 17 cents from words, 38 cents with 12 images (measured 9.9 and 11.1 cents).
export function gridWorstCaseCents(imageCount: number, quality: Quality = "high") {
  return cents(outputTokens("grid", quality), imageCount, STUDIO_PROMPT_TOKENS, ROLES_READ_CENTS);
}

// One separate 1024x1536 design (the single layout). At medium: 6 cents from words, 7 with one
// image (measured 1.07 and 2.31 cents).
export function singleWorstCaseCents(imageCount: number, quality: Quality = "medium") {
  return cents(outputTokens("single", quality), imageCount, STUDIO_PROMPT_TOKENS);
}

// One 1024x1024 model photo: an edit with the design and the drawn garment as its two inputs (version
// 2; one input was 4 cents). 6 cents at medium.
export function photoWorstCaseCents(quality: Quality = "medium", images = 2) {
  return cents(outputTokens("single", quality), images, PHOTO_PROMPT_TOKENS);
}

// What fal charges for a Topaz output of the given size: 8 cents up to 24 MP, 16 up to 48, and so on.
export function topazCents(outputWidth: number, outputHeight: number) {
  const megapixels = (outputWidth * outputHeight) / 1_000_000;
  return TOPAZ_CENTS_PER_24MP * Math.max(1, Math.ceil(megapixels / 24));
}

// One Topaz upscale of a design of the given size (fal), 4x on each side.
// Removing a background with fal's BiRefNet v2 (convex/upscale.ts): billed by compute time,
// about $0.0008 a second, and a heavy pass at 2048 px takes a few seconds. Two cents is held and
// settled for each one, which bounds it.
export const CUTOUT_CENTS = 2;

export function topazWorstCaseCents(width: number, height: number) {
  return topazCents(width * 4, height * 4);
}

// The cost the gateway reported for one call, in cents to a hundredth of a cent, or undefined when it
// reported nothing usable. The gateway puts a dollar amount in providerMetadata.gateway.cost, usually as a
// string such as "0.0252"; some serializations hand over the gateway entry itself as JSON text.
export function gatewayCostCents(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object") return undefined;
  let entry: unknown = (providerMetadata as Record<string, unknown>).gateway;
  if (typeof entry === "string") {
    try {
      entry = JSON.parse(entry);
    } catch {
      return undefined;
    }
  }
  if (!entry || typeof entry !== "object") return undefined;
  const raw = (entry as Record<string, unknown>).cost;
  const dollars = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  // "0.0252" is 2.52 cents, not 2.5200000000000005.
  return Math.round(dollars * 10_000) / 100;
}
