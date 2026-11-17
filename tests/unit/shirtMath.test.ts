import { describe, expect, it } from "vitest";
import { costFor, shirtMath } from "../../src/lib/shirtMath";

// The per-shirt money in Admin, Brands, on the Bella+Canvas 3001 at $24 (Printful $11.92 for S to
// XL). Costs first (economics v6): the buyer pays $29.95 with shipping, Printful takes $17.27 with its
// shipping, the card fee is $1.17, and $9.91 is left to share after Printful's $11.92, the fee, and
// the $1 allowance (shipping is covered).
describe("one shirt's money", () => {
  it("keeps $9.54 with creators at 15% and a share link at 5% of what's left", () => {
    const math = shirtMath(2400, 1192, { creatorBps: 1500, brandBps: 0, linkBps: 500 });
    expect(math).toEqual({
      priceCents: 2400,
      paidCents: 2995,
      distributableCents: 991,
      printfulCents: 1727,
      cardFeeCents: 117,
      creatorCents: 148,
      brandCents: 0,
      linkCents: 49,
      keepCents: 954,
    });
  });

  it("can't lose money on a deal, because shares are of what's left after costs", () => {
    // Brand 15%, creators 10%.
    expect(shirtMath(2400, 1192, { creatorBps: 1000, brandBps: 1500, linkBps: 500 }).keepCents).toBe(855);
    // Even half to the brand and half to creators leaves CultRemix its costs and allowance back.
    expect(shirtMath(2400, 1192, { creatorBps: 2500, brandBps: 2500, linkBps: 500 }).keepCents).toBe(608);
    // A 2XL at $26 costs Printful $13.92: at the 30% cap it keeps $8.01.
    expect(shirtMath(2600, 1392, { creatorBps: 1000, brandBps: 2000, linkBps: 500 }).keepCents).toBe(801);
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
