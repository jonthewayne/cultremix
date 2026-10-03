// Removes metadata from a PNG without touching its pixels: the image model's C2PA content
// credential (a "caBX" chunk), text, EXIF, and timestamps. Critical chunks (IHDR, PLTE, IDAT,
// IEND) and the chunks that change how pixels look (transparency, color space, density) are kept
// byte for byte. Anything that isn't a PNG comes back unchanged.
const KEEP = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs"]);
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Array<Uint8Array> = [bytes.subarray(0, 8)];
  let offset = 8;
  let dropped = 0;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + view.getUint32(offset);
    // A damaged file is stored as it came.
    if (end > bytes.length) return bytes;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    // A chunk whose name starts with a capital letter is needed to read the image.
    const critical = bytes[offset + 4] >= 0x41 && bytes[offset + 4] <= 0x5a;
    if (critical || KEEP.has(type)) parts.push(bytes.subarray(offset, end));
    else dropped++;
    offset = end;
    if (type === "IEND") break;
  }
  if (dropped === 0) return bytes;
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
