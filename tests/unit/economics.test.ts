import { describe, expect, it } from "vitest";
import { canonicalConfigJson, linePool, recipientShares, splitUnit } from "../../convex/lib/economics";

describe("recipientShares (KTD-18 table)", () => {
  it("pays an original's creator everything", () => {
    expect(recipientShares({ kind: "original", creator: "A" })).toEqual([{ who: "A", roles: ["creator"], bps: 10000 }]);
  });
  it("splits a variation with its family root", () => {
    const shares = recipientShares({ kind: "variation", creator: "B", root: { kind: "original", creator: "A" } });
    expect(shares.map((s) => [s.who, s.bps])).toEqual([["A", 5000], ["B", 5000]]);
  });
  it("gives a fork's upstream 30%", () => {
    const shares = recipientShares({ kind: "fork", creator: "C", parentCreator: "U" });
    expect(shares.map((s) => [s.who, s.bps])).toEqual([["C", 7000], ["U", 3000]]);
  });
  it("splits a variation in a fork family three ways", () => {
    const shares = recipientShares({
      kind: "variation",
      creator: "D",
      root: { kind: "fork", creator: "C", parentCreator: "U" },
    });
    expect(shares.map((s) => [s.who, s.bps])).toEqual([["D", 5000], ["C", 3000], ["U", 2000]]);
  });
  it("merges one person in two roles", () => {
    const shares = recipientShares({ kind: "variation", creator: "A", root: { kind: "original", creator: "A" } });
    expect(shares).toEqual([{ who: "A", roles: ["family_root", "creator"], bps: 10000 }]);
  });
});

describe("linePool and splitUnit", () => {
  it("takes 15% of the line after discounts, remainder cents to the lowest units", () => {
    // 3 x $36 - $5 discount = $103.00; 15% = $15.45; units 515, 515, 515.
    expect(linePool({ unitPriceCents: 3600, quantity: 3, discountCents: 500 })).toEqual({
      baseCents: 10300,
      poolCents: 1545,
      units: [515, 515, 515],
    });
    // 2 x $39 = $78.00; 15% = $11.70; units 585, 585.
    expect(linePool({ unitPriceCents: 3900, quantity: 2, discountCents: 0 }).units).toEqual([585, 585]);
    // 3 x $0.07 = 21c; 15% = 3c (floor of 3.15); 1c each.
    expect(linePool({ unitPriceCents: 7, quantity: 3, discountCents: 0 }).units).toEqual([1, 1, 1]);
    // 2 units, 5c pool: 3c then 2c.
    expect(linePool({ unitPriceCents: 17, quantity: 2, discountCents: 0 }).units).toEqual([3, 2]);
  });
  it("gives the remainder of a unit to the work's creator", () => {
    const shares = recipientShares({ kind: "variation", creator: "D", root: { kind: "fork", creator: "C", parentCreator: "U" } });
    // 539c: floors are D 269, C 161, U 107 (537 total), so the 2c remainder goes to D, the creator.
    expect(splitUnit(539, shares)).toEqual([
      { who: "D", cents: 271 },
      { who: "C", cents: 161 },
      { who: "U", cents: 107 },
    ]);
    expect(splitUnit(539, shares).reduce((sum, r) => sum + r.cents, 0)).toBe(539);
  });
  it("refuses fractional or negative amounts", () => {
    expect(() => linePool({ unitPriceCents: 36.5, quantity: 1, discountCents: 0 })).toThrow();
    expect(() => splitUnit(-1, recipientShares({ kind: "original", creator: "A" }))).toThrow();
  });
});

describe("canonicalConfigJson", () => {
  it("sorts keys at every level so the hash is stable", () => {
    const json = canonicalConfigJson();
    expect(json.startsWith('{"creatorPoolBps":1500,"maturityDays":30,"shares":{"fork":')).toBe(true);
    expect(json).not.toContain(" ");
  });
});
