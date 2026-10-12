import { describe, expect, it } from "vitest";
import { cutGrid, decodeRgba, encodeRgba } from "../../convex/lib/gridCut";
import type { Rgba } from "../../convex/lib/gridCut";

type Pixel = [number, number, number, number];
const CLEAR: Pixel = [0, 0, 0, 0];
const COLORS: Array<Pixel> = [
  [220, 40, 40, 255],
  [40, 160, 60, 255],
  [40, 80, 200, 255],
  [240, 200, 40, 255],
];

function paint(size: number, pixel: (x: number, y: number) => Pixel): Rgba {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data.set(pixel(x, y), (y * size + x) * 4);
  }
  return { width: size, height: size, data };
}

// Solid blocks from `from` to `to` (exclusive) inside each 200 px quarter of a 400 px grid.
function blocks(from: number, to: number, background: Pixel = CLEAR, skip: Array<number> = []) {
  return paint(400, (x, y) => {
    const cell = (y >= 200 ? 2 : 0) + (x >= 200 ? 1 : 0);
    const inside = x % 200 >= from && x % 200 < to && y % 200 >= from && y % 200 < to;
    return inside && !skip.includes(cell) ? COLORS[cell] : background;
  });
}

function at(image: Rgba, x: number, y: number) {
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
}

describe("grid cutter", () => {
  it("cuts four solid color blocks that have clear space between them", () => {
    const cells = cutGrid(blocks(30, 170), { margin: 4 });
    for (const cell of cells) {
      expect(cell.reason).toBeUndefined();
      expect(cell.tile?.width).toBe(148);
      expect(cell.tile?.height).toBe(148);
      expect(at(cell.tile!, 0, 0)).toEqual(CLEAR);
      expect(at(cell.tile!, 74, 74)).toEqual(COLORS[cell.index]);
    }
    expect(cells[3].box).toEqual({ x: 230, y: 230, width: 140, height: 140 });
  });

  it("refuses blocks that touch across the middle instead of slicing through them", () => {
    const cells = cutGrid(paint(400, (x, y) => {
      const inside = x >= 30 && x < 370 && y >= 30 && y < 370;
      return inside ? COLORS[(y >= 200 ? 2 : 0) + (x >= 200 ? 1 : 0)] : CLEAR;
    }));
    expect(cells.map((cell) => cell.reason)).toEqual(["merged", "merged", "merged", "merged"]);
    expect(cells.every((cell) => cell.tile === null)).toBe(true);
  });

  it("keys out a flat backdrop when the grid comes back with no transparency", () => {
    const cells = cutGrid(blocks(30, 170, [255, 255, 255, 255]), { margin: 4 });
    for (const cell of cells) {
      expect(cell.tile?.width).toBe(148);
      expect(at(cell.tile!, 1, 1)).toEqual(CLEAR);
      expect(at(cell.tile!, 74, 74)).toEqual(COLORS[cell.index]);
    }
  });

  it("separates two designs joined by a thin bridge across the middle", () => {
    const base = blocks(30, 170);
    const joined = paint(400, (x, y) => (y >= 97 && y < 103 && x >= 160 && x < 240 ? COLORS[0] : (at(base, x, y) as Pixel)));
    const cells = cutGrid(joined, { margin: 4 });
    expect(cells.map((cell) => cell.reason)).toEqual([undefined, undefined, undefined, undefined]);
    expect(cells[0].box?.x).toBe(30);
    expect(cells[1].box?.x).toBeGreaterThanOrEqual(190);
  });

  it("reports an empty quarter", () => {
    const cells = cutGrid(blocks(30, 170, CLEAR, [3]));
    expect(cells.map((cell) => cell.reason)).toEqual([undefined, undefined, undefined, "empty"]);
  });

  it("round-trips PNG bytes", () => {
    const image = blocks(30, 170);
    const back = decodeRgba(encodeRgba(image));
    expect(back.width).toBe(400);
    expect(at(back, 100, 100)).toEqual(COLORS[0]);
  });
});
