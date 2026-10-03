// Where images live in R2. Every image has its own folder, named for the SHA-256 of its original
// and holding every version of it:
//
//   designs/<sha256>/original.png    a design from the studio (publishing uses the same file)
//   designs/<sha256>/medium.webp     fits inside 1200 px: tiles, the feed, shop pages
//   designs/<sha256>/thumb.webp      fits inside 400 px: session cards, chips, pickers
//   designs/<sha256>/photos/<sha256>/original.png   a model photo of that design, with its own
//                                    medium.webp and thumb.webp
//   uploads/<sha256>/original.jpg    an image a member uploaded (png, jpg, or webp), with its copies
//
// The print upscale will sit in the same folder of the private bucket: designs/<sha256>/print.png.
// Keys from before folders (gen/, art/, photo/, inspo/, and sizes/<sha256>/) and Convex storage
// keys ("cvx:") are moved into this layout by sizing.organize.

// The longest side of each copy, in pixels. Smaller images are never enlarged.
export const SIZES = { thumb: 400, medium: 1200 } as const;
export type SizeName = keyof typeof SIZES;

const SHA = "[0-9a-f]{64}";
const ORIGINAL = new RegExp(String.raw`^((?:designs|uploads)/${SHA}(?:/photos/${SHA})?)/original\.(?:png|jpg|webp)$`, "u");
// Keys from before folders: gen/, art/, photo/, or inspo/ + <sha256>.<ext>.
const LEGACY = new RegExp(String.raw`^(gen|art|photo|inspo)/(${SHA})\.(png|jpg|webp)$`, "u");

export function designKey(sha256: string) {
  return `designs/${sha256}/original.png`;
}

export function uploadKey(sha256: string, extension: string) {
  return `uploads/${sha256}/original.${extension}`;
}

// A model photo goes in the folder of the design it shows.
export function photoKey(designSha256: string, sha256: string) {
  return `designs/${designSha256}/photos/${sha256}/original.png`;
}

// The folder of an original stored in this layout, or undefined.
export function folderOf(key: string) {
  return ORIGINAL.exec(key)?.[1];
}

// The SHA-256 a key names: the folder's for this layout, the file name's for older keys.
export function shaOf(key: string) {
  const folder = folderOf(key);
  if (folder) return folder.split("/").pop();
  return LEGACY.exec(key)?.[2];
}

// An older R2 key's kind and file extension.
export function legacyParts(key: string) {
  const match = LEGACY.exec(key);
  return match ? { prefix: match[1], sha256: match[2], extension: match[3] } : undefined;
}

// Where an original's thumbnail or medium goes: beside it in its folder. (An older key's copies
// go to sizes/<sha256>/ until sizing.organize moves it.)
export function sizeKey(originalKey: string, sha256: string, size: SizeName) {
  const folder = folderOf(originalKey);
  return folder ? `${folder}/${size}.webp` : `sizes/${sha256}/${size}.webp`;
}
