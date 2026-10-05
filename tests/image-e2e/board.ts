import sharp from "sharp";
import type { OverlayOptions } from "sharp";

// A review board for one case: its inputs and request on top, then its designs, each marked with
// whether it passed every check and which checks it missed.

const esc = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

function wrap(text: string, width: number) {
  const lines: Array<string> = [];
  let line = "";
  for (const word of text.split(/\s+/u)) {
    if ((line + " " + word).trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

export async function caseBoard(args: {
  title: string;
  lines: Array<string>;
  inputs: Array<{ label: string; bytes: Uint8Array }>;
  designs: Array<{ bytes: Uint8Array | null; ok: boolean; misses: Array<string> }>;
  out: string;
}) {
  const W = 1200;
  const pad = 20;
  const thumb = 200;
  const head = 320;
  const cols = args.designs.length > 1 ? 2 : 1;
  const tile = cols === 2 ? Math.floor((W - pad * 3) / 2) : W - pad * 2;
  const strip = 64;
  const rows = Math.ceil(args.designs.length / cols);
  const H = head + rows * (tile + strip + pad) + pad;
  const layers: Array<OverlayOptions> = [];
  const textX = pad + Math.min(args.inputs.length, 3) * (thumb + pad);
  const textWidth = Math.max(28, Math.floor((W - textX - pad) / 13));
  const body = args.lines.flatMap((line) => wrap(line, textWidth)).slice(0, 9);
  const svg =
    `<svg width="${W}" height="${head}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="${textX}" y="48" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="800" fill="#111">${esc(args.title)}</text>` +
    body.map((line, i) => `<text x="${textX}" y="${88 + i * 26}" font-family="Helvetica, Arial, sans-serif" font-size="21" fill="#222">${esc(line)}</text>`).join("") +
    "</svg>";
  layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  for (const [i, input] of args.inputs.slice(0, 3).entries()) {
    const left = pad + i * (thumb + pad);
    const fit = await sharp(input.bytes).resize(thumb - 12, thumb - 40, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    layers.push({ input: { create: { width: thumb, height: thumb, channels: 4, background: "#ece8df" } }, top: pad, left });
    layers.push({ input: fit, top: pad + 6, left: left + 6 });
    const label = `<svg width="${thumb}" height="30" xmlns="http://www.w3.org/2000/svg"><text x="8" y="22" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#111">${esc(input.label.slice(0, 22))}</text></svg>`;
    layers.push({ input: Buffer.from(label), top: pad + thumb - 32, left });
  }
  for (const [i, design] of args.designs.entries()) {
    const top = head + Math.floor(i / cols) * (tile + strip + pad);
    const left = pad + (i % cols) * (tile + pad);
    layers.push({ input: { create: { width: tile, height: tile, channels: 4, background: "#ece8df" } }, top, left });
    if (design.bytes) {
      const fit = await sharp(design.bytes).resize(tile - 24, tile - 24, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      layers.push({ input: fit, top: top + 12, left: left + 12 });
    }
    const color = design.ok ? "#127a3a" : "#b3261e";
    const mark = design.ok ? "PASS" : "MISS";
    const note = design.bytes ? (design.ok ? "every check" : design.misses.join(", ")) : "no design";
    const stripSvg =
      `<svg width="${tile}" height="${strip}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="10" width="78" height="36" rx="18" fill="${color}"/>` +
      `<text x="39" y="35" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="800" fill="#fff">${mark}</text>` +
      `<text x="92" y="35" font-family="Helvetica, Arial, sans-serif" font-size="19" fill="#222">${esc(note.slice(0, 48))}</text></svg>`;
    layers.push({ input: Buffer.from(stripSvg), top: top + tile, left });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: "#ffffff" } }).composite(layers).png().toFile(args.out);
}
