import { describe, expect, it } from "vitest";
import { costFor, shirtMath } from "../../src/lib/shirtMath";

// The per-shirt money in Admin, Brands, on the Bella+Canvas 3001 at $24 (Printful $11.92 for S to
// XL), checked by hand on October 13: the buyer pays $29.95 with shipping, Printful takes $17.27 with
// its shipping, the card fee is $1.17, and $11.51 is left before any shares.
describe("one shirt's money", () => {
  it("keeps $6.71 with creators at 15% and a share link at 5%", () => {
    const math = shirtMath(2400, 1192, { creatorBps: 1500, brandBps: 0, linkBps: 500 });
    expect(math).toEqual({
      priceCents: 2400,
      paidCents: 2995,
      printfulCents: 1727,
      cardFeeCents: 117,
      creatorCents: 360,
      brandCents: 0,
      linkCents: 120,
      keepCents: 671,
    });
  });

  it("keeps $4.31 on a brand deal of 25% (brand 15%, creators 10%), and loses money at 50%", () => {
    expect(shirtMath(2400, 1192, { creatorBps: 1000, brandBps: 1500, linkBps: 500 }).keepCents).toBe(431);
    expect(shirtMath(2400, 1192, { creatorBps: 2500, brandBps: 2500, linkBps: 500 }).keepCents).toBe(-169);
    // A 2XL at $26 costs Printful $13.92: the tightest shirt at the 30% cap still keeps $2.35.
    expect(shirtMath(2600, 1392, { creatorBps: 1000, brandBps: 2000, linkBps: 500 }).keepCents).toBe(235);
  });

  it("prices a size group at its most expensive size", () => {
    const sizes = [
      { size: "S", cents: 1192 },
      { size: "XL", cents: 1225 },
      { size: "2XL", cents: 1392 },
    ];
    expect(costFor(sizes, ["S", "M", "L", "XL"])).toBe(1225);
    expect(costFor(sizes, ["2XL"])).toBe(1392);
    expect(costFor(sizes, ["3XL"])).toBeNull();
  });
});
