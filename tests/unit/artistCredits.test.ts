import { describe, expect, it } from "vitest";
import { ECONOMIC_CONFIG_V4, ECONOMIC_CONFIG_V5, linePoolAt, recipientShares, saleRecipients, splitUnit } from "../../convex/lib/economics";
import { claimCode, cleanArtistInputs, linkKey, normalizeLink, slugBase } from "../../convex/lib/artistCredits";

// Outside artists' credits (economics v5, docs/decisions.md): a fifth of the crediting creator's
// part of the creator pool, never anyone else's.
const cents = (shares: ReturnType<typeof recipientShares>, pool: number) =>
  Object.fromEntries(splitUnit(pool, shares).map((part) => [part.who, part.cents]));

describe("artist credits in the creator pool (v5)", () => {
  it("takes a fifth of an original creator's part, as in the decision's table", () => {
    const shares = recipientShares({ kind: "original", creator: "A" }, ECONOMIC_CONFIG_V5, { creator: ["X"] });
    expect(shares).toEqual([
      { who: "A", roles: ["creator"], bps: 8000 },
      { who: "X", roles: ["artist"], bps: 2000 },
    ]);
    // $1.50 pool: creator $1.20, artist $0.30.
    expect(cents(shares, 150)).toEqual({ A: 120, X: 30 });
  });

  it("takes an inherited credit from the family root's part, leaving the variation's creator whole", () => {
    const shares = recipientShares({ kind: "variation", creator: "B", root: { kind: "original", creator: "A" } }, ECONOMIC_CONFIG_V5, {
      family_root: ["X"],
    });
    expect(cents(shares, 150)).toEqual({ A: 60, X: 15, B: 75 });
  });

  it("takes a variation creator's own credit from their part only", () => {
    const shares = recipientShares({ kind: "variation", creator: "B", root: { kind: "original", creator: "A" } }, ECONOMIC_CONFIG_V5, {
      creator: ["Y"],
    });
    expect(cents(shares, 150)).toEqual({ A: 75, B: 60, Y: 15 });
  });

  it("splits a credit evenly among up to three artists, in whole hundreds of the pool", () => {
    const two = recipientShares({ kind: "original", creator: "A" }, ECONOMIC_CONFIG_V5, { creator: ["X", "Y"] });
    expect(two.map((s) => [s.who, s.bps])).toEqual([["A", 8000], ["X", 1000], ["Y", 1000]]);
    // 2000 / 3 rounds down to 600 each; the 200 left stays with the creator.
    const three = recipientShares({ kind: "original", creator: "A" }, ECONOMIC_CONFIG_V5, { creator: ["X", "Y", "Z", "W"] });
    expect(three.map((s) => [s.who, s.bps])).toEqual([["A", 8200], ["X", 600], ["Y", 600], ["Z", 600]]);
  });

  it("credits a fork's upstream from the upstream part", () => {
    const shares = recipientShares({ kind: "fork", creator: "C", parentCreator: "U" }, ECONOMIC_CONFIG_V5, { upstream: ["X"] });
    expect(shares.map((s) => [s.who, s.bps])).toEqual([["C", 7000], ["U", 2400], ["X", 600]]);
  });

  it("ignores credits under rules without artist shares, and keeps brands and links whole", () => {
    expect(recipientShares({ kind: "original", creator: "A" }, ECONOMIC_CONFIG_V4, { creator: ["X"] })).toEqual([
      { who: "A", roles: ["creator"], bps: 10000 },
    ]);
    const split = saleRecipients({ kind: "original", creator: "A" }, ECONOMIC_CONFIG_V5, {
      affiliate: "L",
      brand: { who: "R", bps: 1500, creatorBps: 1000 },
      artists: { creator: ["X"] },
    });
    // Creators' 10% of the price: 8% to the creator, 2% to the artist; the brand's 15% and the link's 5% untouched.
    expect(Object.fromEntries(split.recipients.map((r) => [r.who, r.bps]))).toEqual({ A: 800, X: 200, L: 500, R: 1500 });
    expect(linePoolAt({ unitPriceCents: 2400, quantity: 1, discountCents: 0 }, split.poolBps).poolCents).toBe(720);
  });

  it("keeps every share a whole basis point of the price at any creators' share a brand can set", () => {
    for (const creatorBps of [500, 700, 1000, 1300, 1500, 3000]) {
      for (const lineage of [
        { kind: "original" as const, creator: "A" },
        { kind: "fork" as const, creator: "C", parentCreator: "U" },
        { kind: "variation" as const, creator: "D", root: { kind: "fork" as const, creator: "C", parentCreator: "U" } },
      ]) {
        expect(() =>
          saleRecipients(lineage, ECONOMIC_CONFIG_V5, {
            brand: { who: "R", bps: 500, creatorBps },
            artists: { creator: ["X", "Y", "Z"], family_root: ["Q"], upstream: ["P", "S"] },
          }),
        ).not.toThrow();
      }
    }
  });
});

describe("artist credit inputs", () => {
  it("normalizes and matches links", () => {
    expect(normalizeLink("instagram.com/jane")).toBe("https://instagram.com/jane");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
    expect(linkKey("https://www.Instagram.com/Jane/?hl=en")).toBe(linkKey("https://instagram.com/jane"));
    // A query that names the page keeps two artists apart; tracking parameters don't.
    expect(linkKey("https://youtube.com/watch?v=abc")).not.toBe(linkKey("https://youtube.com/watch?v=xyz"));
    expect(linkKey("https://facebook.com/profile.php?id=1&utm_source=x")).toBe(linkKey("https://facebook.com/profile.php?id=1"));
    expect(linkKey("https://facebook.com/profile.php?id=1")).not.toBe(linkKey("https://facebook.com/profile.php?id=2"));
    // A shared site's front page can't stand for an artist.
    expect(cleanArtistInputs([{ name: "Jane", link: "instagram.com" }])).toMatchObject({ ok: false });
    expect(cleanArtistInputs([{ name: "Jane", link: "https://www.instagram.com/?hl=en" }])).toMatchObject({ ok: false });
    expect(cleanArtistInputs([{ name: "Jane", link: "janedoe.art" }])).toMatchObject({ ok: true });
  });

  it("needs a name and a link for each artist, at most three, and drops repeats", () => {
    expect(cleanArtistInputs([{ name: " Jane  Doe ", link: "janedoe.art" }])).toEqual({
      ok: true,
      artists: [{ name: "Jane Doe", link: "https://janedoe.art/", key: "janedoe.art" }],
    });
    expect(cleanArtistInputs([{ name: "", link: "" }])).toEqual({ ok: true, artists: [] });
    expect(cleanArtistInputs([{ name: "Jane", link: "" }])).toMatchObject({ ok: false });
    expect(cleanArtistInputs([{ name: "", link: "janedoe.art" }])).toMatchObject({ ok: false });
    const four = ["a.com", "b.com", "c.com", "d.com"].map((link, i) => ({ name: `Artist ${i}`, link }));
    expect(cleanArtistInputs(four)).toMatchObject({ ok: false });
    expect(cleanArtistInputs([{ name: "Jane", link: "janedoe.art" }, { name: "Jane D", link: "https://www.janedoe.art/" }])).toMatchObject({
      ok: true,
      artists: [{ name: "Jane" }],
    });
  });

  it("makes page slugs and claim codes", () => {
    expect(slugBase("Zoë Kravitz-Ono!")).toBe("zoe-kravitz-ono");
    expect(slugBase("!!!")).toBe("artist");
    expect(claimCode(() => 0)).toBe("cultremix-aaaaaa");
    expect(claimCode()).toMatch(/^cultremix-[a-z2-9]{6}$/u);
  });
});
