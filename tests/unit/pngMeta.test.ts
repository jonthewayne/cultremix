import { decode, encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { stripPngMetadata } from "../../convex/lib/pngMeta";

// The image model adds a C2PA content credential to every PNG; we store images without it.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function chunkTypes(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types = [];
  for (let offset = 8; offset < png.length; offset += 12 + view.getUint32(offset)) {
    types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
  }
  return types;
}

// The PNG with extra chunks right after its header chunk.
function withChunks(png: Uint8Array, extra: Array<Uint8Array>) {
  const afterHeader = 8 + 12 + 13;
  const parts = [png.subarray(0, afterHeader), ...extra, png.subarray(afterHeader)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const pixels = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) % 256);
const plain = encode({ width: 4, height: 4, data: pixels, channels: 4, depth: 8 });

describe("PNG metadata", () => {
  it("drops the content credential and text, leaving the image byte for byte", () => {
    const tagged = withChunks(plain, [
      chunk("caBX", new Uint8Array(64).fill(7)),
      chunk("tEXt", new TextEncoder().encode("Software\0image model")),
    ]);
    expect(chunkTypes(tagged)).toContain("caBX");
    const stripped = stripPngMetadata(tagged);
    expect(stripped).toEqual(plain);
    expect(decode(stripped).data).toEqual(pixels);
  });

  it("keeps the chunks that change how the image looks", () => {
    const tagged = withChunks(plain, [chunk("sRGB", new Uint8Array([0])), chunk("caBX", new Uint8Array(8))]);
    expect(chunkTypes(stripPngMetadata(tagged))).toEqual(["IHDR", "sRGB", ...chunkTypes(plain).slice(1)]);
  });

  it("returns files without metadata, and other formats, unchanged", () => {
    expect(stripPngMetadata(plain)).toBe(plain);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    expect(stripPngMetadata(jpeg)).toBe(jpeg);
  });
});
