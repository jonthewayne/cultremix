"use node";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { measureAlpha, roundSolid } from "../../src/lib/print/alpha";
import { designBox, garmentSvg } from "../../src/lib/print/garmentMockup";
import { applyKnockout } from "../../src/lib/print/knockout";
import { toInches } from "../../src/lib/print/shirtPlacement";
import { visibleBox } from "../../src/lib/print/trim";
import { isPng, tagForPrint } from "./printPng";
import type { GarmentKind } from "../../shared/config/print-products";
import type { AlphaMetrics } from "../../src/lib/print/alpha";
import type { KnockoutParams } from "../../src/lib/print/knockout";
import type { PrintArea, RelativePlacement } from "../../src/lib/print/shirtPlacement";
import type { Box } from "../../src/lib/print/trim";

// Print Studio's image work on the server, with sharp: measuring, trimming, knocking out, and the
// print file render. Node actions only; tests/unit runs these directly.

sharp.cache(false);

const PREVIEW_SIDE = 1200;
// The work page's art: sharp on a Retina screen at the page's widest.
const LARGE_SIDE = 2400;

function load(bytes: Uint8Array) {
  return sharp(bytes, { failOn: "none", limitInputPixels: 80_000_000 });
}

function fromRaw(data: Uint8Array, width: number, height: number) {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.length), { raw: { width, height, channels: 4 } });
}

export function sha256Of(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// PNG color types 4 and 6 carry an alpha channel; 3 (palette) may carry it in tRNS.
export function pngCarriesAlpha(bytes: Uint8Array) {
  if (!isPng(bytes) || bytes.length < 26) return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  return colorType === 3 && Buffer.from(bytes).includes(Buffer.from("tRNS"));
}

// The alpha channel alone: a 6000 px upscale is 36 MB here, not 144.
export async function alphaPlane(bytes: Uint8Array) {
  const { data, info } = await load(bytes).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, alpha: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export async function measureImage(bytes: Uint8Array): Promise<{ width: number; height: number; metrics: AlphaMetrics }> {
  const { width, height, alpha } = await alphaPlane(bytes);
  return { width, height, metrics: measureAlpha(alpha, width, height) };
}

async function rgba(bytes: Uint8Array) {
  const { data, info } = await load(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

async function png(data: Uint8Array, width: number, height: number) {
  return new Uint8Array(await fromRaw(data, width, height).png({ compressionLevel: 6 }).toBuffer());
}

// Crops to the pixels that show. Null when there's nothing to take off (or nothing shows).
export async function trimImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; box: Box } | null> {
  const { width, height, alpha } = await alphaPlane(bytes);
  const box = visibleBox(alpha, width, height);
  if (!box || (box.width === width && box.height === height)) return null;
  const out = await load(bytes)
    .ensureAlpha()
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return { bytes: new Uint8Array(out), box };
}

// Clears the background color. Same size, same pixels otherwise.
export async function knockoutImage(bytes: Uint8Array, params: KnockoutParams) {
  const image = await rgba(bytes);
  const cleared = applyKnockout(image.data, image.width, image.height, params);
  return { bytes: await png(image.data, image.width, image.height), cleared, width: image.width, height: image.height };
}

// A WebP that fits inside 1200 px, for pages that don't need every pixel.
export async function previewWebp(bytes: Uint8Array) {
  const out = await load(bytes)
    .resize({ width: PREVIEW_SIDE, height: PREVIEW_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 95 })
    .toBuffer();
  return new Uint8Array(out);
}

export async function largeWebp(bytes: Uint8Array) {
  const out = await load(bytes)
    .resize({ width: LARGE_SIDE, height: LARGE_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 95 })
    .toBuffer();
  return new Uint8Array(out);
}

// The model photo's guide: the drawn garment in its color with the design at its real size and spot,
// the same drawing Publish shows (src/lib/print/garmentMockup.ts) without the print area's outline.
// 1000 x 1160 px, about a size L laid flat at 32 px to the inch.
export async function garmentReference(args: {
  kind: GarmentKind;
  hex: string;
  art: Uint8Array;
  placement: RelativePlacement;
  area: PrintArea;
}) {
  const meta = await load(args.art).metadata();
  const aspect = meta.width && meta.height ? meta.height / meta.width : 1;
  const inches = toInches(args.placement, aspect, args.area);
  const box = designBox(args.kind, inches, aspect, args.area);
  const garment = await sharp(Buffer.from(garmentSvg(args.kind, inches.side, args.hex))).png().toBuffer();
  const design = await load(args.art)
    .resize({ width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)), fit: "inside" })
    .png()
    .toBuffer();
  const out = await sharp(garment)
    .composite([{ input: design, left: Math.max(0, Math.round(box.x)), top: Math.max(0, Math.round(box.y)) }])
    .png()
    .toBuffer();
  return new Uint8Array(out);
}

export type Rect = { left: number; top: number; width: number; height: number };

// The print file: the design resampled to its placed size (Lanczos3, then a light unsharp mask),
// near-solid alpha rounded to solid, on a transparent canvas the size of the whole print area,
// tagged 300 DPI and sRGB. The same source and placement always give the same bytes.
export async function renderPrintFile(source: Uint8Array, rect: Rect, canvas: { width: number; height: number }, dpi: number) {
  const placed = await load(source)
    .ensureAlpha()
    .resize(rect.width, rect.height, { fit: "fill", kernel: "lanczos3" })
    .sharpen({ sigma: 0.6, m1: 0.5, m2: 1.5 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const design = new Uint8Array(placed.data.buffer, placed.data.byteOffset, placed.data.length);
  // The model's 240-254 "solid" prints solid.
  for (let i = 3; i < design.length; i += 4) if (design[i] >= 240) design[i] = 255;

  const encoded = await sharp({
    create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from(design.buffer, design.byteOffset, design.length), raw: { width: rect.width, height: rect.height, channels: 4 }, left: rect.left, top: rect.top }])
    .png({ compressionLevel: 6, adaptiveFiltering: false })
    .toBuffer();
  const bytes = tagForPrint(new Uint8Array(encoded), dpi);

  // What actually came out, for the server's own check.
  const alpha = new Uint8Array(rect.width * rect.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = design[i * 4 + 3];
  roundSolid(alpha);
  const designMetrics = measureAlpha(alpha, rect.width, rect.height);
  return { bytes, sha256: sha256Of(bytes), designMetrics };
}
