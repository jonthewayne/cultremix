import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { COMFORT_COLORS_1717 } from "../../shared/config/print-products";
import { canvasPx, pixelRect } from "../../src/lib/print/placement";
import {
  alphaPlane,
  knockoutImage,
  measureImage,
  pngCarriesAlpha,
  previewWebp,
  renderPrintFile,
  trimImage,
} from "../../convex/lib/printImage";
import { crc32, pixelsPerMeter, readPrintTags, tagForPrint } from "../../convex/lib/printPng";

const product = COMFORT_COLORS_1717;

// A transparent design: a solid disc with soft edges, off center, with clear margins.
async function design(width = 600, height = 400) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <circle cx="${width * 0.4}" cy="${height / 2}" r="${height * 0.3}" fill="#d0202a"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

// The same design on a solid cream background (no transparency).
async function onBackground() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
    <rect width="300" height="200" fill="#f4ecd8"/>
    <circle cx="150" cy="100" r="60" fill="#111111"/>
    <circle cx="150" cy="100" r="20" fill="#f4ecd8"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

describe("PNG print tags", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes 300 DPI and sRGB after IHDR, replacing older tags, pixels untouched", async () => {
    const original = new Uint8Array(await sharp(await design()).withMetadata({ density: 72 }).png().toBuffer());
    const tagged = tagForPrint(original, 300);
    const tags = readPrintTags(tagged);
    expect(tags.dpi).toBe(300);
    expect(tags.srgb).toBe(true);
    expect(pixelsPerMeter(300)).toBe(11811);
    const [a, b] = await Promise.all([sharp(original).raw().toBuffer(), sharp(tagged).raw().toBuffer()]);
    expect(Buffer.compare(a, b)).toBe(0);
    // Tagging twice gives the same bytes.
    expect(Buffer.compare(Buffer.from(tagForPrint(tagged, 300)), Buffer.from(tagged))).toBe(0);
  });
});

describe("measuring", () => {
  it("measures alpha from the alpha channel alone", async () => {
    const { width, height, metrics } = await measureImage(await design());
    expect([width, height]).toEqual([600, 400]);
    expect(metrics.hasAlpha).toBe(true);
    expect(metrics.solid).toBeGreaterThan(0);
    expect(metrics.haze).toBe(0);
  });

  it("sees an opaque image as having no transparency", async () => {
    const { metrics } = await measureImage(await onBackground());
    expect(metrics.hasAlpha).toBe(false);
  });

  it("reads whether a PNG carries an alpha channel", async () => {
    expect(pngCarriesAlpha(await design())).toBe(true);
    const rgb = new Uint8Array(await sharp(await onBackground()).removeAlpha().png().toBuffer());
    expect(pngCarriesAlpha(rgb)).toBe(false);
    expect(pngCarriesAlpha(new Uint8Array(await sharp(await design()).jpeg().toBuffer()))).toBe(false);
  });
});

describe("tools never enlarge", () => {
  it("trim crops to what shows", async () => {
    const source = await design();
    const trimmed = await trimImage(source);
    expect(trimmed).not.toBeNull();
    const meta = await sharp(trimmed!.bytes).metadata();
    expect(meta.width).toBeLessThan(600);
    expect(meta.height).toBeLessThan(400);
    expect(meta.width).toBe(trimmed!.box.width);
    // Already trimmed: nothing more to take off.
    expect(await trimImage(trimmed!.bytes)).toBeNull();
  });

  it("knockout keeps the size, clears the background, and keeps the enclosed cream", async () => {
    const result = await knockoutImage(await onBackground(), {
      color: { r: 0xf4, g: 0xec, b: 0xd8 },
      tolerance: 8,
      fromEdges: true,
    });
    expect([result.width, result.height]).toEqual([300, 200]);
    expect(result.cleared).toBeGreaterThan(0);
    const { alpha } = await alphaPlane(result.bytes);
    expect(alpha[0]).toBe(0);
    expect(alpha[100 * 300 + 150]).toBe(255); // the cream center inside the black ring stays
    const { metrics } = await measureImage(result.bytes);
    expect(metrics.hasAlpha).toBe(true);
  });

  it("preview fits inside 1200 px and never grows a small image", async () => {
    const meta = await sharp(await previewWebp(await design())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(600);
    expect(meta.hasAlpha).toBe(true);
  });
});

describe("print file render", () => {
  it("is the exact print-area canvas at 300 DPI, transparent, with a stable hash", async () => {
    const source = await design(600, 400);
    const placement = { xIn: 3, yIn: 0.5, widthIn: 3 };
    const rect = pixelRect(placement, 400 / 600, product);
    const canvas = canvasPx(product);
    const first = await renderPrintFile(source, rect, canvas, product.dpi);
    const second = await renderPrintFile(source, rect, canvas, product.dpi);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const tags = readPrintTags(first.bytes);
    expect([tags.width, tags.height]).toEqual([4500, 5100]);
    expect(tags.dpi).toBe(300);
    expect(tags.srgb).toBe(true);
    expect(tags.colorType).toBe(6);

    const { alpha, width } = await alphaPlane(first.bytes);
    // Outside the placed rectangle: fully clear.
    expect(alpha[0]).toBe(0);
    expect(alpha[(rect.top + rect.height + 10) * width + 10]).toBe(0);
    // The disc's center: solid.
    const cx = rect.left + Math.round(rect.width * 0.4);
    const cy = rect.top + Math.round(rect.height / 2);
    expect(alpha[cy * width + cx]).toBe(255);
    expect(first.designMetrics.hasAlpha).toBe(true);
    expect([first.designMetrics.width, first.designMetrics.height]).toEqual([900, 600]);
  });

  it("rounds the model's near-solid alpha up to solid", async () => {
    const raw = Buffer.alloc(200 * 200 * 4);
    for (let i = 0; i < 200 * 200; i++) raw.set([10, 20, 30, i % 200 < 100 ? 245 : 0], i * 4);
    const source = new Uint8Array(await sharp(raw, { raw: { width: 200, height: 200, channels: 4 } }).png().toBuffer());
    const rect = { left: 0, top: 0, width: 600, height: 600 };
    const out = await renderPrintFile(source, rect, canvasPx(product), 300);
    const { alpha, width } = await alphaPlane(out.bytes);
    expect(alpha[300 * width + 100]).toBe(255);
  });
});
