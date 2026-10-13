// Where print files and print versions live in the public bucket. Nothing here is listed or
// linked publicly, so each file sits in a folder named for a random 128-bit code: 26 lowercase
// base32 characters from crypto random bytes, never guessable from the work's CR number.
//
//   works/<family>/<expression, 3 digits>/print-<code>/print.png        the print file
//   works/<family>/<expression, 3 digits>/print-<code>/version-<n>.png  a Print Studio version
//   …/print-<code>/print-preview.webp, version-<n>-preview.webp           their smaller copies
//
// A kept design (family 0, no public number) has no works/ folder; its art lives with its
// creator's, so its print files do too: members/<creator>/kept/<keep number, 3 digits>/print-<code>/.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const CODE_LENGTH = 26;
export const CODE_PATTERN = /^[a-z2-7]{26}$/u;

// 16 random bytes as base32, 5 bits a character (the last character carries 3 bits).
export function encodeCode(bytes: Uint8Array) {
  if (bytes.length !== 16) throw new Error("A print code is 16 bytes.");
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function randomCode() {
  return encodeCode(crypto.getRandomValues(new Uint8Array(16)));
}

// A Convex user id, as folder names use them.
const OWNER_ID = /^[a-z0-9]{16,64}$/u;

function workFolder(family: number, expression: number, code: string, keptBy?: string) {
  if (!Number.isInteger(expression) || expression < 1) throw new Error("Not a CR number.");
  if (!CODE_PATTERN.test(code)) throw new Error("Not a print code.");
  const number = String(expression).padStart(3, "0");
  if (family === 0) {
    if (!keptBy || !OWNER_ID.test(keptBy)) throw new Error("Not a CR number.");
    return `members/${keptBy}/kept/${number}/print-${code}`;
  }
  if (!Number.isInteger(family) || family < 1) throw new Error("Not a CR number.");
  return `works/${family}/${number}/print-${code}`;
}

// keptBy: the creator of a kept design (family 0), whose folder holds its files.
export function printFileKey(family: number, expression: number, code: string, keptBy?: string) {
  return `${workFolder(family, expression, code, keptBy)}/print.png`;
}

export function printVersionKey(family: number, expression: number, code: string, version: number, keptBy?: string) {
  if (!Number.isInteger(version) || version < 1) throw new Error("Not a version number.");
  return `${workFolder(family, expression, code, keptBy)}/version-${version}.png`;
}

// The smaller copy beside a print file or version, for pages that don't need every pixel.
export function printPreviewKey(key: string) {
  return key.replace(/\/[^/]+\.png$/u, (name) => name.replace(/\.png$/u, "-preview.webp"));
}

// The 2400 px copy beside an upscale of the published art, which the work page shows.
export function printLargeKey(key: string) {
  return key.replace(/\/[^/]+\.png$/u, (name) => name.replace(/\.png$/u, "-large.webp"));
}

const PRINT_FILE = /^(?:works\/[1-9]\d*|members\/[a-z0-9]{16,64}\/kept)\/\d{3,}\/print-[a-z2-7]{26}\/print\.png$/u;
export function isPrintFileKey(key: string) {
  return PRINT_FILE.test(key);
}
