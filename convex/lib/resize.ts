"use node";

import sharp from "sharp";
import { SIZES } from "./sizes";
import type { SizeName } from "./sizes";

// A WebP copy of an image that fits inside a square of the size's longest side. Phone photos are
// turned upright first (they record their rotation separately); transparency is kept; small
// images are never enlarged.
export async function webpCopy(bytes: Uint8Array, size: SizeName) {
  const longSide = SIZES[size];
  const webp = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality: size === "thumb" ? 78 : 82, alphaQuality: 90 })
    .toBuffer();
  return new Uint8Array(webp);
}

// The original's width and height as it's shown, upright.
export async function uprightSize(bytes: Uint8Array) {
  const meta = await sharp(bytes, { failOn: "none" }).metadata();
  // EXIF orientations 5-8 turn the picture a quarter turn.
  const turned = (meta.orientation ?? 1) >= 5;
  return { width: (turned ? meta.height : meta.width) ?? 0, height: (turned ? meta.width : meta.height) ?? 0 };
}
