import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLACEMENT,
  EDGE_IN,
  MARK_MAX_HEIGHT_IN,
  MIN_SIZE,
  areaPlacement,
  clampRelative,
  fullWidthIn,
  markKeyOf,
  markPlacement,
  onFront,
  sameRelative,
  sizeKeyOf,
  sizeWords,
  toInches,
  toRelative,
  withoutMark,
} from "../../src/lib/print/shirtPlacement";

const TEE = { widthIn: 12, heightIn: 16 };
const HOODIE = { widthIn: 14, heightIn: 14 };

describe("one placement on every product", () => {
  it("puts the default Large near the top of a tee and a hoodie, each in its own inches", () => {
    expect(toInches(DEFAULT_PLACEMENT, 1, TEE)).toEqual({ side: "front", widthIn: 9.35, yIn: 0.95 });
    expect(toInches(DEFAULT_PLACEMENT, 1, HOODIE)).toEqual({ side: "front", widthIn: 11.05, yIn: 0.66 });
  });

  it("keeps the same share of each print area", () => {
    const medium = { side: "front" as const, size: 0.65, drop: 0.5 };
    const tee = toInches(medium, 1, TEE);
    const hoodie = toInches(medium, 1, HOODIE);
    expect(tee.widthIn / fullWidthIn(1, TEE)).toBeCloseTo(0.65, 2);
    expect(hoodie.widthIn / fullWidthIn(1, HOODIE)).toBeCloseTo(0.65, 2);
    // Halfway down the room left on each.
    expect(tee.yIn).toBeCloseTo(EDGE_IN + 0.5 * (TEE.heightIn - 2 * EDGE_IN - tee.widthIn), 1);
    expect(hoodie.yIn).toBeCloseTo(EDGE_IN + 0.5 * (HOODIE.heightIn - 2 * EDGE_IN - hoodie.widthIn), 1);
  });

  it("fits a tall design by its height and a wide one by its width", () => {
    expect(fullWidthIn(1.5, TEE)).toBe(10);
    expect(toInches({ side: "front", size: 1, drop: 1 }, 1.5, TEE)).toEqual({ side: "front", widthIn: 10, yIn: 0.5 });
    expect(fullWidthIn(0.4, TEE)).toBe(11);
    expect(fullWidthIn(1.5, HOODIE)).toBeCloseTo(8.67, 2);
  });

  it("never leaves the print area, whatever it's given", () => {
    for (const aspect of [0.25, 0.8, 1, 1.4, 2.5]) {
      for (const area of [TEE, HOODIE, { widthIn: 4, heightIn: 3 }]) {
        for (const size of [-1, 0, 0.3, 1, 9]) {
          for (const drop of [-2, 0, 0.5, 1, 3]) {
            const inches = toInches({ side: "back", size, drop }, aspect, area);
            const placed = areaPlacement(inches, area);
            expect(placed.xIn).toBeGreaterThanOrEqual(0);
            expect(placed.xIn + inches.widthIn).toBeLessThanOrEqual(area.widthIn + 0.01);
            expect(inches.yIn).toBeGreaterThanOrEqual(0);
            expect(inches.yIn + inches.widthIn * aspect).toBeLessThanOrEqual(area.heightIn + 0.02);
          }
        }
      }
    }
  });

  it("comes back from inches unchanged", () => {
    for (const placement of [DEFAULT_PLACEMENT, { side: "back" as const, size: 0.4, drop: 0.9 }, { side: "front" as const, size: 1, drop: 0 }]) {
      const again = toRelative(toInches(placement, 1.2, TEE), 1.2, TEE);
      expect(again.side).toBe(placement.side);
      expect(again.size).toBeCloseTo(placement.size, 2);
      if (placement.size < 1) expect(again.drop).toBeCloseTo(placement.drop, 1);
    }
  });

  it("cleans up anything a client sends", () => {
    expect(clampRelative(undefined)).toEqual(DEFAULT_PLACEMENT);
    expect(clampRelative({ side: "sideways" as never, size: 9, drop: -1 })).toEqual({ side: "front", size: 1, drop: 0 });
    expect(clampRelative({ side: "back", size: 0, drop: Number.NaN })).toEqual({ side: "back", size: MIN_SIZE, drop: DEFAULT_PLACEMENT.drop });
  });

  it("names the presets and centers the design", () => {
    expect(sizeKeyOf(0.65)).toBe("medium");
    expect(sizeKeyOf(1)).toBe("full");
    expect(sizeKeyOf(0.7)).toBeNull();
    expect(areaPlacement({ side: "front", widthIn: 9, yIn: 1 }, TEE)).toEqual({ xIn: 1.5, yIn: 1, widthIn: 9 });
  });
});

describe("sizeWords", () => {
  it("describes the print for the model photo", () => {
    expect(sizeWords(DEFAULT_PLACEMENT)).toBe("a large print centered on the upper chest");
    expect(sizeWords({ side: "back", size: 0.65, drop: 0.5 })).toBe("a medium-size print centered on the back");
    expect(sizeWords({ side: "front", size: 0.3, drop: 0 })).toBe("a small print centered on the upper chest, not off to one side");
    expect(sizeWords({ side: "back", size: 1, drop: 0 })).toBe("a big print filling most of the back");
  });
});

describe("a chest mark with a back print", () => {
  const back = { side: "back" as const, size: 0.9, drop: 0.05 };

  it("is kept only on a back print, between 2 and 5 inches wide", () => {
    expect(clampRelative({ ...back, mark: 3 })).toEqual({ ...back, mark: 3 });
    expect(clampRelative({ side: "front", size: 0.9, drop: 0.05, mark: 3 })).toEqual({ side: "front", size: 0.9, drop: 0.05 });
    expect(clampRelative({ ...back, mark: 9 }).mark).toBe(5);
    expect(clampRelative({ ...back, mark: 0.5 }).mark).toBe(2);
    expect(clampRelative({ ...back, mark: Number.NaN })).toEqual(back);
    expect(clampRelative(back)).toEqual(back);
  });

  it("counts as part of the placement, and leaves with a move to the front", () => {
    expect(sameRelative({ ...back, mark: 3 }, { ...back, mark: 3 })).toBe(true);
    expect(sameRelative({ ...back, mark: 3 }, back)).toBe(false);
    expect(sameRelative({ ...back, mark: 3 }, { ...back, mark: 4 })).toBe(false);
    expect(onFront({ ...back, mark: 3 })).toEqual({ side: "front", size: 0.9, drop: 0.05 });
    expect(withoutMark({ ...back, mark: 3 })).toEqual(back);
    expect(markKeyOf(3)).toBe("small");
    expect(markKeyOf(4)).toBe("medium");
    expect(markKeyOf(3.6)).toBeNull();
  });

  it("sits over the wearer's left chest: right of center as you face it, near the top", () => {
    expect(markPlacement(3, 1, TEE)).toEqual({ xIn: 7.5, yIn: 2, widthIn: 3 });
    expect(markPlacement(3, 1, HOODIE)).toEqual({ xIn: 9, yIn: 2, widthIn: 3 });
  });

  it("stays on its half of the print area and holds a tall design to a chest mark's height", () => {
    for (const area of [TEE, HOODIE, { widthIn: 9, heightIn: 11 }]) {
      for (const aspect of [0.3, 1, 2.5]) {
        for (const mark of [2, 3, 4, 5]) {
          const placed = markPlacement(mark, aspect, area);
          expect(placed.xIn).toBeGreaterThanOrEqual(area.widthIn / 2);
          expect(placed.xIn + placed.widthIn).toBeLessThanOrEqual(area.widthIn - EDGE_IN + 0.001);
          expect(placed.yIn + placed.widthIn * aspect).toBeLessThanOrEqual(area.heightIn - EDGE_IN + 0.001);
          expect(placed.widthIn * aspect).toBeLessThanOrEqual(MARK_MAX_HEIGHT_IN + 0.01);
        }
      }
    }
    expect(markPlacement(4, 2, TEE).widthIn).toBe(2.25);
  });
});
