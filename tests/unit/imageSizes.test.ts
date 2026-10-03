import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { uprightSize, webpCopy } from "../../convex/lib/resize";

// The thumbnail and medium every stored image gets (convex/lib/sizes.ts). Designs are
// transparent PNGs, so the copies must keep their transparency.

async function transparentDesign() {
  const art = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 230, g: 40, b: 90, alpha: 1 } } })
    .png()
    .toBuffer();
  const design = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
  return new Uint8Array(design);
}

describe("image sizes", () => {
  it("makes WebP copies that fit each size and keep transparency", async () => {
    const design = await transparentDesign();
    const expected = { thumb: [267, 400], medium: [800, 1200] } as const;
    for (const size of ["thumb", "medium"] as const) {
      const copy = await webpCopy(design, size);
      const meta = await sharp(copy).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual(expected[size]);
      expect(meta.hasAlpha).toBe(true);
      const alpha = (await sharp(copy).stats()).channels[3];
      // The margins stay see-through and the art stays solid.
      expect(alpha.min).toBeLessThan(8);
      expect(alpha.max).toBeGreaterThan(247);
    }
  });

  it("never enlarges a small image", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
    const meta = await sharp(await webpCopy(new Uint8Array(small), "medium")).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("turns phone photos upright", async () => {
    // Stored 600 wide and 400 tall, with EXIF orientation 6: shown a quarter turn clockwise.
    const photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#888888" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await uprightSize(new Uint8Array(photo))).toEqual({ width: 400, height: 600 });
    const meta = await sharp(await webpCopy(new Uint8Array(photo), "thumb")).metadata();
    expect([meta.width, meta.height]).toEqual([267, 400]);
  });
});
