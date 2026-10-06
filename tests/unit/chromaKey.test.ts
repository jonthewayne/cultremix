import { describe, expect, it } from "vitest";
import { clearShare, keyOut } from "../../convex/lib/chromaKey";
import { keyFor, keyedPrompt } from "../../convex/lib/prompts";
import type { Rgba } from "../../convex/lib/gridCut";

// A 60x60 image on the slightly-off magenta Nano Banana really paints (254, 27, 254): a dark gray
// ring (radius 12-22) with a soft outer edge blended into the background, the background showing
// through its middle (a hole, like the inside of an O), and a hot pink dot drawn on the ring.
const KEY: [number, number, number] = [254, 27, 254];
const GRAY: [number, number, number] = [60, 60, 60];
const HOT_PINK: [number, number, number] = [255, 105, 180];

function scene(): Rgba {
  const width = 60;
  const height = 60;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      const r = Math.hypot(x - 30, y - 30);
      // Coverage of the gray ring: solid from 12 to 20, fading to nothing at 22.
      const a = r < 12 ? 0 : r <= 20 ? 1 : r < 22 ? (22 - r) / 2 : 0;
      for (let c = 0; c < 3; c++) data[d + c] = Math.round(a * GRAY[c] + (1 - a) * KEY[c]);
      data[d + 3] = 255;
      if (Math.hypot(x - 30, y - 14) < 2) {
        data[d] = HOT_PINK[0];
        data[d + 1] = HOT_PINK[1];
        data[d + 2] = HOT_PINK[2];
      }
    }
  }
  return { width, height, data };
}

const at = (image: Rgba, x: number, y: number) => {
  const d = (y * image.width + x) * 4;
  return [...image.data.slice(d, d + 4)];
};

describe("keyOut", () => {
  it("clears the background and the hole, unmixes soft edges, and keeps a pink detail", () => {
    const out = keyOut(scene(), "magenta");
    // Background and the hole in the middle are clear.
    expect(at(out, 2, 2)[3]).toBe(0);
    expect(at(out, 30, 30)[3]).toBe(0);
    // The ring itself is untouched.
    expect(at(out, 30, 46)).toEqual([60, 60, 60, 255]);
    // Its soft edge (half coverage at radius 21) comes back gray, half transparent, with no pink.
    const edge = at(out, 51, 30);
    expect(edge[3]).toBeGreaterThan(100);
    expect(edge[3]).toBeLessThan(160);
    expect(Math.max(edge[0], edge[2]) - edge[1]).toBeLessThan(12);
    // The hot pink dot on the ring stays.
    expect(at(out, 30, 14)).toEqual([...HOT_PINK, 255]);
    expect(clearShare(out)).toBeGreaterThan(0.5);
  });

  it("leaves an image alone when its border isn't the key color", () => {
    const image = scene();
    for (let i = 0; i < image.data.length; i += 4) image.data.set([20, 20, 20, 255], i);
    expect(keyOut(image, "magenta").data).toEqual(image.data);
  });
});

describe("keyed prompts", () => {
  it("swaps the transparent background for a flat key color", () => {
    const text = keyedPrompt("Arrange them in a 2x2 grid on a fully transparent background: one each.", "magenta");
    expect(text).toContain("on a perfectly flat, solid magenta (#FF00FF) background that fills the whole canvas");
    expect(text).not.toContain("transparent background");
    expect(text).toContain("Never use magenta or hot pink in the graphics themselves.");
  });

  it("picks green when the prompt leans pink or purple", () => {
    expect(keyFor("A raccoon in a crown")).toBe("magenta");
    expect(keyFor("electric pink hair, lavender skin, purple shadows")).toBe("green");
    expect(keyFor("pink flowers on green leaves with green moss")).toBe("magenta");
  });
});

