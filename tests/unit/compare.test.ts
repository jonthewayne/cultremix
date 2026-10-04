import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX,
  canCompare,
  clampPair,
  compareParam,
  pairHolding,
  parseCompare,
  phonePairs,
  sharedScale,
  togglePick,
} from "../../src/lib/compare";

describe("the compare address", () => {
  it("reads ids in order, without blanks or repeats, and at most four", () => {
    expect(parseCompare("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseCompare(" a, ,b,a,,c ")).toEqual(["a", "b", "c"]);
    expect(parseCompare("a,b,c,d,e,f")).toEqual(["a", "b", "c", "d"]);
    expect(parseCompare("a,a,a,a,b")).toEqual(["a", "b"]);
    expect(COMPARE_MAX).toBe(4);
  });

  it("ignores anything that isn't a string", () => {
    expect(parseCompare(undefined)).toEqual([]);
    expect(parseCompare(12)).toEqual([]);
    expect(parseCompare(["a", "b"])).toEqual([]);
    expect(parseCompare("")).toEqual([]);
  });

  it("writes ids back, and leaves the address clean when empty", () => {
    expect(compareParam(["a", "b"])).toBe("a,b");
    expect(compareParam([])).toBeUndefined();
    expect(parseCompare(compareParam(["x", "y", "z"]))).toEqual(["x", "y", "z"]);
  });

  it("opens with two or more", () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(["a"])).toBe(false);
    expect(canCompare(["a", "b"])).toBe(true);
  });
});

describe("picking", () => {
  it("adds in the order tapped and takes one back out", () => {
    let picks: Array<string> = [];
    picks = togglePick(picks, "a").picks;
    picks = togglePick(picks, "c").picks;
    picks = togglePick(picks, "b").picks;
    expect(picks).toEqual(["a", "c", "b"]);
    expect(togglePick(picks, "c")).toEqual({ picks: ["a", "b"], full: false });
  });

  it("stops at four and says so", () => {
    const picks = ["a", "b", "c", "d"];
    expect(togglePick(picks, "e")).toEqual({ picks, full: true });
    expect(togglePick(picks, "a")).toEqual({ picks: ["b", "c", "d"], full: false });
  });
});

describe("phone pairs", () => {
  it("steps through two at a time", () => {
    expect(phonePairs(0)).toEqual([]);
    expect(phonePairs(1)).toEqual([]);
    expect(phonePairs(2)).toEqual([[0, 1]]);
    expect(phonePairs(4)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("pairs an odd one out with the one before it", () => {
    expect(phonePairs(3)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("stays on a pair that still exists after a drop", () => {
    expect(clampPair(1, 4)).toBe(1);
    expect(clampPair(1, 3)).toBe(1);
    expect(clampPair(1, 2)).toBe(0);
    expect(clampPair(-1, 4)).toBe(0);
  });

  it("finds the pair a design is in", () => {
    expect(pairHolding(4, 3)).toBe(1);
    expect(pairHolding(4, 0)).toBe(0);
    expect(pairHolding(3, 2)).toBe(1);
    expect(pairHolding(3, 9)).toBe(0);
  });
});

describe("one scale for all", () => {
  it("fits the largest design and draws the rest at the same scale", () => {
    const box = { width: 400, height: 600 };
    // 1024×1536 fits at 0.390625; the 512×512 one is drawn at that scale too (200×200), not blown up.
    expect(sharedScale([{ width: 1024, height: 1536 }, { width: 512, height: 512 }], box)).toBeCloseTo(0.390625);
    // A wide design is limited by width.
    expect(sharedScale([{ width: 2000, height: 1000 }, { width: 1024, height: 1536 }], box)).toBeCloseTo(0.2);
  });

  it("skips unknown sizes and gives 0 when none are known", () => {
    expect(sharedScale([undefined, { width: 800, height: 800 }], { width: 400, height: 400 })).toBe(0.5);
    expect(sharedScale([undefined, { width: 0, height: 10 }], { width: 400, height: 400 })).toBe(0);
    expect(sharedScale([], { width: 400, height: 400 })).toBe(0);
  });
});
