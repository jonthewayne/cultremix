import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { garmentReference } from "../../convex/lib/printImage";
import { designBox } from "../../src/lib/print/garmentMockup";
import { DEFAULT_PLACEMENT, toInches } from "../../src/lib/print/shirtPlacement";

const TEE_FRONT = { widthIn: 12, heightIn: 16 };

// A solid red design, 400 x 300.
async function redDesign() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#d0202a"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function pixel(png: Uint8Array, x: number, y: number) {
  const data = await sharp(png).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return [data[0], data[1], data[2]];
}

// The model photo's guide shows the garment's color and the design's real size and spot.
describe("garmentReference", () => {
  it("draws the design where the placement puts it, on a garment of the right color", async () => {
    const art = await redDesign();
    const png = await garmentReference({ kind: "tee", hex: "#1b1b1c", art, placement: DEFAULT_PLACEMENT, area: TEE_FRONT });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 1160]);
    const box = designBox("tee", toInches(DEFAULT_PLACEMENT, 0.75, TEE_FRONT), 0.75, TEE_FRONT);
    // Inside the design: red. Just below it, still on the shirt: the shirt's black.
    expect(await pixel(png, box.x + box.width / 2, box.y + box.height / 2)).toEqual([208, 32, 42]);
    const below = await pixel(png, box.x + box.width / 2, box.y + box.height + 40);
    expect(below.every((c) => c < 40)).toBe(true);
  });

  it("puts a smaller, lower placement smaller and lower", async () => {
    const art = await redDesign();
    const small = { side: "front" as const, size: 0.4, drop: 0.8 };
    const png = await garmentReference({ kind: "tee", hex: "#ffffff", art, placement: small, area: TEE_FRONT });
    const big = designBox("tee", toInches(DEFAULT_PLACEMENT, 0.75, TEE_FRONT), 0.75, TEE_FRONT);
    const box = designBox("tee", toInches(small, 0.75, TEE_FRONT), 0.75, TEE_FRONT);
    expect(box.width).toBeLessThan(big.width / 2);
    expect(box.y).toBeGreaterThan(big.y);
    expect(await pixel(png, box.x + box.width / 2, box.y + box.height / 2)).toEqual([208, 32, 42]);
    // Where the big one would have been, above the small one: the white shirt.
    expect(await pixel(png, big.x + big.width / 2, big.y + 10)).toEqual([255, 255, 255]);
  });
});
