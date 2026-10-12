"use node";

import sharp from "sharp";
import { SIZES } from "./sizes";
import type { Rgba } from "./gridCut";
import type { SizeName } from "./sizes";

// Node actions run with 512 MB; libvips' cache only holds memory between calls here.
sharp.cache(false);

// Encoded bytes, or pixels straight from the grid cutter (no decode needed).
export type ImageInput = Uint8Array | Rgba;

function load(input: ImageInput) {
  if (input instanceof Uint8Array) return sharp(input, { failOn: "none" });
  const raw = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.length);
  return sharp(raw, { raw: { width: input.width, height: input.height, channels: 4 } });
}

// A WebP copy of an image that fits inside a square of the size's longest side. Phone photos are
// turned upright first (they record their rotation separately); transparency is kept; small
// images are never enlarged.
export async function webpCopy(input: ImageInput, size: SizeName) {
  const longSide = SIZES[size];
  const webp = await load(input)
    .rotate()
    .resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality: size === "thumb" ? 78 : 82, alphaQuality: 90 })
    .toBuffer();
  return new Uint8Array(webp);
}

// The original's width and height as it's shown, upright.
export async function uprightSize(input: ImageInput) {
  if (!(input instanceof Uint8Array)) return { width: input.width, height: input.height };
  const meta = await sharp(input, { failOn: "none" }).metadata();
  // EXIF orientations 5-8 turn the picture a quarter turn.
  const turned = (meta.orientation ?? 1) >= 5;
  return { width: (turned ? meta.height : meta.width) ?? 0, height: (turned ? meta.width : meta.height) ?? 0 };
}

// A PNG's pixels as RGBA for the grid cutter, and back. Native, so a 1920x1920 grid decodes in
// well under a second where the cutter's pure-JS decoder and encoder took most of 17 s on Convex.
export async function decodeToRgba(bytes: Uint8Array): Promise<Rgba> {
  const { data, info } = await sharp(bytes, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export async function encodePng(image: Rgba) {
  const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return new Uint8Array(await sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer());
}
