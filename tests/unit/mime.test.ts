import { describe, expect, it } from "vitest";
import { imageTypeOf } from "../../convex/lib/mime";

// Uploads land in a public bucket, so only real images go in, stored as what their bytes are.
describe("an upload's image type", () => {
  const bytes = (...values: Array<number | string>) =>
    new Uint8Array(values.flatMap((value) => (typeof value === "string" ? [...value].map((c) => c.charCodeAt(0)) : [value])));

  it("reads PNG, JPEG, and WebP from their signatures", () => {
    expect(imageTypeOf(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe("image/png");
    expect(imageTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toBe("image/jpeg");
    expect(imageTypeOf(bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses anything else, whatever it's called", () => {
    expect(imageTypeOf(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageTypeOf(bytes("GIF89a", 1, 0, 1, 0))).toBeNull();
    expect(imageTypeOf(bytes("%PDF-1.7"))).toBeNull();
    expect(imageTypeOf(bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt "))).toBeNull();
    expect(imageTypeOf(bytes(0x89, "PN"))).toBeNull();
    expect(imageTypeOf(new Uint8Array())).toBeNull();
  });
});
