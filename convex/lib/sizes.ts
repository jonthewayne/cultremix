// Where images live in R2: one public bucket per environment, organized the way the product is.
// Anything that isn't public on a page carries a random 128-bit code in its path (26 lowercase
// base32 characters, convex/lib/storage.ts randomCode), so nobody can open it without the exact
// link, and the bucket can't be listed through its public address. Published works use readable
// paths, since their pages show them anyway.
//
//   members/<member>/uploads/<date>-<code>/original.jpg                    an image a member uploaded
//   members/<member>/sessions/<date>-<session>/batch-01/grid-<code>.png    the grid a batch was cut from
//   members/<member>/sessions/<date>-<session>/batch-01/design-1-<code>/original.png
//   works/<family>/<expression>/original.png                               a published work's art
//   works/<family>/<expression>/photos/<n>/original.png                    its model photos (n never reused)
//   works/<family>/<expression>/print-<code>/print.png                     its print file
//
// Every original has medium.webp and thumb.webp beside it in its folder (grids and print files
// don't). <member> and <session> are Convex IDs; <date> is the Pacific date the session started or
// the upload arrived, so folders list in order. Images from the image model are stored without its
// metadata (convex/lib/pngMeta.ts). Older layouts (one folder per SHA-256 under designs/, uploads/,
// and grids/; flat gen/, art/, photo/, inspo/ files; Convex storage "cvx:" keys) are moved here by
// sizing.organize.

// The longest side of each copy, in pixels. Smaller images are never enlarged.
export const SIZES = { thumb: 400, medium: 1200 } as const;
export type SizeName = keyof typeof SIZES;

export const CODE_LENGTH = 26;
const CODE = "[a-z2-7]{26}";
const ID = "[a-z0-9]{10,40}";
const DATE = "\\d{4}-\\d{2}-\\d{2}";
const EXT = "(?:png|jpg|webp)";

const UPLOAD = new RegExp(String.raw`^members/(${ID})/uploads/(${DATE})-(${CODE})/original\.(png|jpg|webp)$`, "u");
const SESSION_FOLDER = String.raw`members/(${ID})/sessions/(${DATE})-(${ID})/batch-(\d{2,})`;
const DESIGN = new RegExp(String.raw`^${SESSION_FOLDER}/design-(\d+)-(${CODE})/original\.png$`, "u");
const GRID = new RegExp(String.raw`^${SESSION_FOLDER}/grid-(${CODE})\.png$`, "u");
const WORK_ART = /^works\/(\d+)\/(\d{3,})\/original\.png$/u;
const WORK_PHOTO = /^works\/(\d+)\/(\d{3,})\/photos\/(\d+)\/original\.png$/u;
const PRINT = new RegExp(String.raw`^works/(\d+)/(\d{3,})/print-(${CODE})/print\.png$`, "u");
const TEST = new RegExp(String.raw`^tests/(${DATE})-(${CODE})/original\.png$`, "u");

// Older layouts, read only by sizing.organize.
const SHA = "[0-9a-f]{64}";
const OLD_FOLDER = new RegExp(String.raw`^((?:designs|uploads)/${SHA}(?:/photos/${SHA})?)/original\.${EXT}$`, "u");
const OLD_GRID = new RegExp(String.raw`^grids/${SHA}/original\.png$`, "u");
const FLAT = new RegExp(String.raw`^(gen|art|photo|inspo)/(${SHA})\.(png|jpg|webp)$`, "u");

// The Pacific date of a moment, as YYYY-MM-DD.
export function pacificDate(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

function checkCode(code: string) {
  if (!new RegExp(`^${CODE}$`, "u").test(code)) throw new Error("A storage code is 26 base32 characters.");
  return code;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function uploadKey(memberId: string, at: number, code: string, extension: string) {
  return `members/${memberId}/uploads/${pacificDate(at)}-${checkCode(code)}/original.${extension}`;
}

// Where one batch's files go: its member's session folder, numbered in the order batches were made.
export type BatchPlace = { memberId: string; sessionId: string; sessionStartedAt: number; batchNumber: number };

export function batchFolder(place: BatchPlace) {
  const session = `${pacificDate(place.sessionStartedAt)}-${place.sessionId}`;
  return `members/${place.memberId}/sessions/${session}/batch-${pad(place.batchNumber, 2)}`;
}

// designNumber is 1-4, in grid order (top left, top right, bottom left, bottom right).
export function designKey(place: BatchPlace, designNumber: number, code: string) {
  return `${batchFolder(place)}/design-${designNumber}-${checkCode(code)}/original.png`;
}

export function gridKey(place: BatchPlace, code: string) {
  return `${batchFolder(place)}/grid-${checkCode(code)}.png`;
}

export function workFolder(family: number, expression: number) {
  return `works/${family}/${pad(expression, 3)}`;
}

export function workArtKey(family: number, expression: number) {
  return `${workFolder(family, expression)}/original.png`;
}

// A model photo: photo n of the work. A reshoot takes the next number, so a cached photo never
// changes under its link.
export function workPhotoKey(family: number, expression: number, n: number) {
  return `${workFolder(family, expression)}/photos/${n}/original.png`;
}

export function printKey(family: number, expression: number, code: string) {
  return `${workFolder(family, expression)}/print-${checkCode(code)}/print.png`;
}

// A diagnostic image from imageGen.selfTest.
export function testImageKey(at: number, code: string) {
  return `tests/${pacificDate(at)}-${checkCode(code)}/original.png`;
}

// The photo number in a model photo's key, or undefined.
export function photoNumberOf(key: string | undefined) {
  const match = key ? WORK_PHOTO.exec(key) : null;
  return match ? Number(match[3]) : undefined;
}

// The folder an original sits in (it holds the original's medium.webp and thumb.webp), or
// undefined for a key that isn't an original in a folder.
export function folderOf(key: string) {
  return /^(.+)\/original\.(?:png|jpg|webp)$/u.exec(key)?.[1];
}

// What a key is, by layout.
export type KeyKind = "upload" | "design" | "grid" | "work" | "photo" | "print" | "test";
export function currentKind(key: string): KeyKind | undefined {
  if (UPLOAD.test(key)) return "upload";
  if (DESIGN.test(key)) return "design";
  if (GRID.test(key)) return "grid";
  if (WORK_ART.test(key)) return "work";
  if (WORK_PHOTO.test(key)) return "photo";
  if (PRINT.test(key)) return "print";
  if (TEST.test(key)) return "test";
  return undefined;
}

// Stored in the current layout (sizing.organize leaves it where it is).
export function isCurrentLayout(key: string) {
  return currentKind(key) !== undefined;
}

// A key in an older layout, which sizing.organize moves.
export function isOldLayout(key: string) {
  return OLD_FOLDER.test(key) || OLD_GRID.test(key) || FLAT.test(key) || key.startsWith("cvx:");
}

// A key a member may bring into the studio as an image: an upload, a design, or a published work's
// art, in the current layout or an older one.
export function isImageKey(key: string) {
  const kind = currentKind(key);
  if (kind === "upload" || kind === "design" || kind === "work") return true;
  return (OLD_FOLDER.test(key) && !key.includes("/photos/")) || /^(gen|art|inspo)\//u.test(key) && FLAT.test(key) || /^cvx:[A-Za-z0-9_-]{8,64}$/u.test(key);
}

// An older flat key's kind, SHA-256, and file extension.
export function legacyParts(key: string) {
  const match = FLAT.exec(key);
  return match ? { prefix: match[1], sha256: match[2], extension: match[3] } : undefined;
}

// The file extension of an image key, or undefined.
export function extensionOf(key: string) {
  return /\.(png|jpg|webp)$/u.exec(key)?.[1];
}

// Where an original's thumbnail or medium goes: beside it in its folder. (An older flat key's
// copies go to sizes/<sha256>/ until sizing.organize moves it.)
export function sizeKey(originalKey: string, sha256: string, size: SizeName) {
  const folder = folderOf(originalKey);
  return folder ? `${folder}/${size}.webp` : `sizes/${sha256}/${size}.webp`;
}
