import { describe, expect, it } from "vitest";
import {
  ECONOMIC_CONFIG_V1,
  ECONOMIC_CONFIG_V2,
  ECONOMIC_CONFIG_V3,
  creatorPoolFor,
  linePoolAt,
  saleRecipients,
  splitUnit,
} from "../../convex/lib/economics";

// Economics v2 (October 13): creators keep 15% of the price; the member whose link brought the buyer
// gets 5%, and the brand behind the family its rate (10% unless agreed otherwise), both out of
// CultRemix's share. Every cut is exact to the cent.
const original = { kind: "original", creator: "ana" } as const;
const variation = { kind: "variation", creator: "ben", root: { kind: "original", creator: "ana" } } as const;

function sale(priceCents: number, poolBps: number, recipients: Parameters<typeof splitUnit>[1]) {
  const pool = linePoolAt({ unitPriceCents: priceCents, quantity: 1, discountCents: 0 }, poolBps);
  return { pool: pool.poolCents, split: splitUnit(pool.units[0], recipients) };
}

describe("economics v2: affiliate and brand cuts", () => {
  it("pays the creator 15%, the link's member 5%, and the brand 10% of a $24 shirt", () => {
    const { recipients, poolBps } = saleRecipients(original, ECONOMIC_CONFIG_V2, { affiliate: "cam", brand: { who: "nike", bps: 1000 } });
    expect(poolBps).toBe(3000);
    expect(recipients.map((r) => [r.who, r.roles, r.bps])).toEqual([
      ["ana", ["creator"], 1500],
      ["cam", ["affiliate"], 500],
      ["nike", ["brand"], 1000],
    ]);
    expect(sale(2400, poolBps, recipients)).toEqual({
      pool: 720,
      split: [
        { who: "ana", cents: 360 },
        { who: "cam", cents: 120 },
        { who: "nike", cents: 240 },
      ],
    });
  });

  it("splits a variation's creator share between its two creators, on a $26 2XL", () => {
    const { recipients, poolBps } = saleRecipients(variation, ECONOMIC_CONFIG_V2, { affiliate: "cam" });
    expect(poolBps).toBe(2000);
    expect(sale(2600, poolBps, recipients).split).toEqual([
      { who: "ana", cents: 195 },
      { who: "ben", cents: 195 },
      { who: "cam", cents: 130 },
    ]);
  });

  it("gives one person in two roles the sum: a creator sharing their own design's link", () => {
    const { recipients, poolBps } = saleRecipients(original, ECONOMIC_CONFIG_V2, { affiliate: "ana" });
    expect(recipients).toEqual([{ who: "ana", roles: ["creator", "affiliate"], bps: 2000 }]);
    expect(sale(2400, poolBps, recipients).split).toEqual([{ who: "ana", cents: 480 }]);
  });

  it("pays a brand its agreed rate instead of the default", () => {
    const { recipients, poolBps } = saleRecipients(original, ECONOMIC_CONFIG_V2, { brand: { who: "nike", bps: 1250 } });
    expect(sale(2400, poolBps, recipients).split).toEqual([
      { who: "ana", cents: 360 },
      { who: "nike", cents: 300 },
    ]);
  });

  it("leaves a v1 line exactly as it was: the creator pool alone, with shares of 10000", () => {
    const { recipients, poolBps } = saleRecipients(variation, ECONOMIC_CONFIG_V1, { affiliate: "cam", brand: { who: "nike", bps: 1000 } });
    expect(poolBps).toBe(1500);
    expect(recipients.map((r) => r.bps)).toEqual([5000, 5000]);
    expect(sale(2400, poolBps, recipients).split).toEqual([
      { who: "ana", cents: 180 },
      { who: "ben", cents: 180 },
    ]);
  });

  it("gives an odd cent to the work's own creator", () => {
    const { recipients, poolBps } = saleRecipients(original, ECONOMIC_CONFIG_V2, { affiliate: "cam", brand: { who: "nike", bps: 1000 } });
    const { pool, split } = sale(2399, poolBps, recipients);
    expect(pool).toBe(719);
    expect(split.reduce((sum, part) => sum + part.cents, 0)).toBe(719);
    expect(split.find((part) => part.who === "cam")?.cents).toBe(119);
    expect(split.find((part) => part.who === "nike")?.cents).toBe(239);
  });
});

// Economics v3 (October 13): a brand's agreement can set the creators' share in its families, never
// under 5% of the price.
describe("economics v3: a brand's creators' share", () => {
  it("pays a big brand 15% and its family's creator 10% of a $24 shirt", () => {
    const { recipients, poolBps } = saleRecipients(original, ECONOMIC_CONFIG_V3, {
      affiliate: "cam",
      brand: { who: "nike", bps: 1500, creatorBps: 1000 },
    });
    expect(poolBps).toBe(3000);
    expect(recipients.map((r) => [r.who, r.bps])).toEqual([
      ["ana", 1000],
      ["cam", 500],
      ["nike", 1500],
    ]);
    expect(sale(2400, poolBps, recipients).split).toEqual([
      { who: "ana", cents: 240 },
      { who: "cam", cents: 120 },
      { who: "nike", cents: 360 },
    ]);
  });

  it("splits the brand family's creators' share by lineage, on a $26 2XL", () => {
    const { recipients, poolBps } = saleRecipients(variation, ECONOMIC_CONFIG_V3, { brand: { who: "nike", bps: 1500, creatorBps: 1000 } });
    expect(poolBps).toBe(2500);
    expect(sale(2600, poolBps, recipients).split).toEqual([
      { who: "ana", cents: 130 },
      { who: "ben", cents: 130 },
      { who: "nike", cents: 390 },
    ]);
  });

  it("keeps the standard 15% without an agreement, below the 5% floor, off whole percents, and under v2", () => {
    expect(creatorPoolFor(ECONOMIC_CONFIG_V3, null)).toBe(1500);
    expect(creatorPoolFor(ECONOMIC_CONFIG_V3, 1000)).toBe(1000);
    expect(creatorPoolFor(ECONOMIC_CONFIG_V3, 500)).toBe(500);
    expect(creatorPoolFor(ECONOMIC_CONFIG_V3, 400)).toBe(1500);
    expect(creatorPoolFor(ECONOMIC_CONFIG_V3, 1050)).toBe(1500);
    expect(creatorPoolFor(ECONOMIC_CONFIG_V2, 1000)).toBe(1500);
    const { recipients } = saleRecipients(original, ECONOMIC_CONFIG_V2, { brand: { who: "nike", bps: 1000, creatorBps: 1000 } });
    expect(recipients.find((r) => r.who === "ana")?.bps).toBe(1500);
  });
});
