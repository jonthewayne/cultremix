// Tags a PNG for print: a pHYs chunk saying 300 pixels per inch and an sRGB chunk, placed right
// after IHDR. Any color-space or density chunks already there are dropped so the two can't
// disagree. Pixels are untouched, so the same pixels always give the same bytes (and hash).

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const REPLACED = new Set(["pHYs", "sRGB", "iCCP", "gAMA", "cHRM"]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
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

// Pixels per meter for a DPI, as PNG stores it (300 DPI is 11811).
export function pixelsPerMeter(dpi: number) {
  return Math.round(dpi / 0.0254);
}

export function isPng(bytes: Uint8Array) {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

type Chunk = { type: string; start: number; end: number };

export function pngChunks(bytes: Uint8Array): Array<Chunk> {
  if (!isPng(bytes)) throw new Error("Not a PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Array<Chunk> = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + view.getUint32(offset);
    if (end > bytes.length) throw new Error("Damaged PNG.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, start: offset, end });
    offset = end;
    if (type === "IEND") break;
  }
  return chunks;
}

export function tagForPrint(png: Uint8Array, dpi: number) {
  const chunks = pngChunks(png);
  const ppm = pixelsPerMeter(dpi);
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  phys[8] = 1; // unit: meter
  // Rendering intent 0, perceptual.
  const srgb = chunk("sRGB", new Uint8Array([0]));
  const parts: Array<Uint8Array> = [png.subarray(0, 8)];
  for (const c of chunks) {
    if (REPLACED.has(c.type)) continue;
    parts.push(png.subarray(c.start, c.end));
    if (c.type === "IHDR") parts.push(srgb, chunk("pHYs", phys));
  }
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// What a PNG says about its density and color space, and its size and color type.
export function readPrintTags(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = pngChunks(png);
  const phys = chunks.find((c) => c.type === "pHYs");
  const ppm = phys && png[phys.start + 16] === 1 ? view.getUint32(phys.start + 8) : undefined;
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    colorType: png[25],
    srgb: chunks.some((c) => c.type === "sRGB"),
    dpi: ppm === undefined ? undefined : Math.round(ppm * 0.0254),
  };
}
