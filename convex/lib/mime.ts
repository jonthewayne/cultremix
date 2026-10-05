// An image's type from its first bytes: JPEG, WebP, or (otherwise) PNG.
export function mimeOf(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/png";
}
