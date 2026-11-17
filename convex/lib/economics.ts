// Who earns from a sale, and how much (V1 plan KTD-18). Pure functions shared by the work page's
// Economics panel and order earnings, so both always agree. Amounts are USD integer cents.
//
// Per paid line: base = unit price x quantity - the line's allocated discounts (tax and shipping
// excluded). Pool = floor(base x creatorPoolBps / 10000). The pool is split per unit (units 1..n,
// remainder cents to the lowest unit numbers), and each unit's cents are split among the work's
// recipients by the table below, with any remainder to the work's own creator. One person in two
// roles receives the sum.
//
//   Original by A                                        A 100%
//   Variation by B in A's family (root A)                A 50% (family root), B 50%
//   Fork by C of a work by U                             U 30% (upstream), C 70%
//   Variation by D in a fork family rooted by C (fork of a work by U)
//                                                        U 20%, C 30%, D 50%
// Upstream credit travels one fork generation: a fork of a fork pays the parent's creator, never
// the grandparent's.
//
// Version 2 (October 13, 2026) adds two cuts on top of the creator pool, both out of CultRemix's
// share, so creators keep their 15%: affiliateBps of each line's base to the member whose link
// brought the buyer (the order's first-touch ref, never the buyer themselves), and a brand's rate
// (brandDefaultBps unless it agreed another) to the brand that owns or licenses the design's family.
// A v2 line's recipients carry their share of the base, and the line's pool is their total
// (saleRecipients); splitUnit divides by that total, so v1 lines split exactly as before.
//
// Version 3 (October 13, 2026) lets a brand's agreement set the creators' share in the families it
// owns or licenses, in whole percents from brandCreatorPoolMinBps up, in place of creatorPoolBps (a
// big brand might take 15% with creators at 10%). Everywhere else creators keep their 15%; the
// creators' pool still splits among them by the table above.
//
// Version 4 (October 14, 2026) makes a brand deal one number CultRemix sets: the family's share of
// each sale, the brand and the family's creators together, at most brandFamilyMaxBps. The brand
// splits it with the creators, who get at least brandCreatorPoolMinBps; a new deal starts at
// brandDefaultBps for the brand and brandCreatorDefaultBps for the creators. The sale math is v3's.
//
// Version 5 (November 2026) credits outside artists (docs/decisions.md, "Credit and a reserved share
// for outside artists"). A work can credit up to three artists who inspired it; each credit comes out
// of the part of the creator pool belonging to the creator of the work that added it, never from
// anyone else's part, CultRemix's share, or a brand's. artistShareBps of that part (one fifth) goes
// to the credited artists, split evenly in whole hundreds of basis points of the pool so every share
// stays a whole basis point of the price; any rounding stays with the creator. Credits travel with
// the lineage: a variation of a credited original pays the artist out of the family root's part.

export type EconomicRole = "creator" | "family_root" | "upstream" | "affiliate" | "brand" | "artist";

export type EconomicConfig = {
  version: number;
  // Share of each line's base that goes to creators, in basis points.
  creatorPoolBps: number;
  // From v2: share of each line's base paid to the member whose link brought the buyer.
  affiliateBps?: number;
  // From v2: a brand's share of each line's base in the families it owns or licenses, unless it
  // agreed its own rate.
  brandDefaultBps?: number;
  // From v3: the lowest creators' share of each line's base a brand's agreement can set in its
  // families, in place of creatorPoolBps.
  brandCreatorPoolMinBps?: number;
  // From v4: the most a brand's family gets of each line's base, the brand and the family's
  // creators together.
  brandFamilyMaxBps?: number;
  // From v4: the creators' share a new brand deal starts with; the brand can change it.
  brandCreatorDefaultBps?: number;
  // From v5: the share of a crediting creator's part of the pool that goes to the outside artists
  // they credited, in basis points of that part.
  artistShareBps?: number;
  // Days after a unit ships before its earnings become Available (when no refund holds it).
  maturityDays: number;
  // Shares of the pool, in basis points of 10000, by work kind.
  shares: {
    original: { creator: number };
    variation: { familyRoot: number; creator: number };
    fork: { upstream: number; creator: number };
    variationInFork: { upstream: number; familyRoot: number; creator: number };
  };
};

export const ECONOMIC_CONFIG_V1: EconomicConfig = {
  version: 1,
  creatorPoolBps: 1500,
  maturityDays: 30,
  shares: {
    original: { creator: 10000 },
    variation: { familyRoot: 5000, creator: 5000 },
    fork: { upstream: 3000, creator: 7000 },
    variationInFork: { upstream: 2000, familyRoot: 3000, creator: 5000 },
  },
};

export const ECONOMIC_CONFIG_V2: EconomicConfig = {
  ...ECONOMIC_CONFIG_V1,
  version: 2,
  affiliateBps: 500,
  brandDefaultBps: 1000,
};

export const ECONOMIC_CONFIG_V3: EconomicConfig = {
  ...ECONOMIC_CONFIG_V2,
  version: 3,
  brandCreatorPoolMinBps: 500,
};

export const ECONOMIC_CONFIG_V4: EconomicConfig = {
  ...ECONOMIC_CONFIG_V3,
  version: 4,
  brandDefaultBps: 1500,
  brandCreatorDefaultBps: 1000,
  brandFamilyMaxBps: 3000,
};

export const ECONOMIC_CONFIG_V5: EconomicConfig = {
  ...ECONOMIC_CONFIG_V4,
  version: 5,
  artistShareBps: 2000,
};

// The outside artists credited by each paid role's work, by recipient id (an artist's payee):
// creator for the work itself, family_root for its family's first work, upstream for the work a
// fork came from. Each list holds at most three.
export type ArtistCredits = Partial<Record<"creator" | "family_root" | "upstream", ReadonlyArray<string>>>;

// A work's lineage as economics needs it. Creators are opaque IDs (Convex user IDs).
export type EconomicLineage =
  | { kind: "original"; creator: string }
  | { kind: "fork"; creator: string; parentCreator: string }
  | {
      kind: "variation";
      creator: string;
      // The family's first work: an original, or a fork (with the creator of the work it forked).
      root: { kind: "original"; creator: string } | { kind: "fork"; creator: string; parentCreator: string };
    };

export type RecipientShare = { who: string; roles: Array<EconomicRole>; bps: number };

// Each recipient's share of the pool in basis points (summing to 10000), largest first. A person
// in two roles appears once with both roles.
export function recipientShares(
  lineage: EconomicLineage,
  config: EconomicConfig = ECONOMIC_CONFIG_V1,
  credits: ArtistCredits = {},
): Array<RecipientShare> {
  const parts: Array<{ who: string; role: EconomicRole; bps: number }> = [];
  if (lineage.kind === "original") {
    parts.push({ who: lineage.creator, role: "creator", bps: config.shares.original.creator });
  } else if (lineage.kind === "fork") {
    parts.push({ who: lineage.parentCreator, role: "upstream", bps: config.shares.fork.upstream });
    parts.push({ who: lineage.creator, role: "creator", bps: config.shares.fork.creator });
  } else if (lineage.root.kind === "original") {
    parts.push({ who: lineage.root.creator, role: "family_root", bps: config.shares.variation.familyRoot });
    parts.push({ who: lineage.creator, role: "creator", bps: config.shares.variation.creator });
  } else {
    const shares = config.shares.variationInFork;
    parts.push({ who: lineage.root.parentCreator, role: "upstream", bps: shares.upstream });
    parts.push({ who: lineage.root.creator, role: "family_root", bps: shares.familyRoot });
    parts.push({ who: lineage.creator, role: "creator", bps: shares.creator });
  }
  // From v5: each crediting creator's part gives artistShareBps to the artists it credits.
  if (config.artistShareBps) {
    for (const part of [...parts]) {
      const artists = [...new Set(credits[part.role as keyof ArtistCredits] ?? [])].slice(0, MAX_ARTIST_CREDITS);
      if (artists.length === 0) continue;
      const each = Math.floor((part.bps * config.artistShareBps) / 10000 / artists.length / 100) * 100;
      if (each <= 0) continue;
      part.bps -= each * artists.length;
      for (const who of artists) parts.push({ who, role: "artist", bps: each });
    }
  }
  const merged = new Map<string, RecipientShare>();
  for (const part of parts) {
    const existing = merged.get(part.who);
    if (existing) {
      existing.bps += part.bps;
      if (!existing.roles.includes(part.role)) existing.roles.push(part.role);
    } else {
      merged.set(part.who, { who: part.who, roles: [part.role], bps: part.bps });
    }
  }
  const total = [...merged.values()].reduce((sum, r) => sum + r.bps, 0);
  if (total !== 10000) throw new Error("Economic shares must sum to 10000 basis points.");
  return [...merged.values()].sort((a, b) => b.bps - a.bps);
}

// The most outside artists one work can credit.
export const MAX_ARTIST_CREDITS = 3;

// The creator pool for one paid line, split per unit: unit i (1-based) gets units[i - 1] cents.
export function linePool(
  args: { unitPriceCents: number; quantity: number; discountCents: number },
  config: EconomicConfig = ECONOMIC_CONFIG_V1,
): { baseCents: number; poolCents: number; units: Array<number> } {
  return linePoolAt(args, config.creatorPoolBps);
}

// A line's pool at poolBps of its base, split per unit the same way.
export function linePoolAt(
  args: { unitPriceCents: number; quantity: number; discountCents: number },
  poolBps: number,
): { baseCents: number; poolCents: number; units: Array<number> } {
  const { unitPriceCents, quantity, discountCents } = args;
  for (const n of [unitPriceCents, quantity, discountCents]) {
    if (!Number.isInteger(n) || n < 0) throw new Error("Line amounts must be non-negative integers.");
  }
  const baseCents = Math.max(0, unitPriceCents * quantity - discountCents);
  const poolCents = Math.floor((baseCents * poolBps) / 10000);
  const units: Array<number> = [];
  if (quantity > 0) {
    const each = Math.floor(poolCents / quantity);
    const extra = poolCents - each * quantity;
    for (let i = 0; i < quantity; i++) units.push(each + (i < extra ? 1 : 0));
  }
  return { baseCents, poolCents, units };
}

// The creators' share of a line's base: creatorPoolBps, or from v3 the share a brand agreed for its
// families when it's a whole percent from brandCreatorPoolMinBps up to 100% (from v4, up to
// brandFamilyMaxBps). Anything else falls back to creatorPoolBps, so a bad value can never stop an
// order from being recorded.
export function creatorPoolFor(config: EconomicConfig, brandCreatorBps?: number | null): number {
  const floor = config.brandCreatorPoolMinBps;
  if (floor === undefined || brandCreatorBps === undefined || brandCreatorBps === null) return config.creatorPoolBps;
  const whole = Number.isInteger(brandCreatorBps) && brandCreatorBps % 100 === 0;
  const ceiling = config.brandFamilyMaxBps ?? 10000;
  return whole && brandCreatorBps >= floor && brandCreatorBps <= ceiling ? brandCreatorBps : config.creatorPoolBps;
}

// The brand's share of a line's base: its rate, and from v4 no more than what brandFamilyMaxBps leaves
// after the family's creators, so a brand family never gets more than the published most.
export function brandShareFor(config: EconomicConfig, brandBps: number, creatorPoolBps: number): number {
  if (!Number.isInteger(brandBps) || brandBps <= 0) return 0;
  if (config.brandFamilyMaxBps === undefined) return brandBps;
  return Math.max(0, Math.min(brandBps, config.brandFamilyMaxBps - creatorPoolBps));
}

// Who one line of a sale pays, and its pool in basis points of the line's base. Under v1 that's the
// creator pool, split by recipientShares (summing to 10000). From v2 each recipient carries their
// share of the base: the creators' pool shares scaled to the creators' share (creatorPoolFor), the
// affiliate's affiliateBps, and the brand's rate; one person in several roles gets the sum.
export type SaleExtras = {
  affiliate?: string | null;
  // creatorBps: the creators' share the brand agreed for its families (v3), if any.
  brand?: { who: string; bps: number; creatorBps?: number | null } | null;
  // From v5: the outside artists each paid role's work credits (their payees).
  artists?: ArtistCredits;
};

export function saleRecipients(
  lineage: EconomicLineage,
  config: EconomicConfig,
  extras: SaleExtras = {},
): { recipients: Array<RecipientShare>; poolBps: number } {
  const creators = recipientShares(lineage, config, extras.artists);
  if (config.affiliateBps === undefined && config.brandDefaultBps === undefined) {
    return { recipients: creators, poolBps: config.creatorPoolBps };
  }
  const creatorPoolBps = creatorPoolFor(config, extras.brand ? extras.brand.creatorBps : null);
  const parts: Array<RecipientShare> = creators.map((share) => {
    const bps = (share.bps * creatorPoolBps) / 10000;
    if (!Number.isInteger(bps)) throw new Error("Creator shares must come to whole basis points of the price.");
    return { who: share.who, roles: [...share.roles], bps };
  });
  if (extras.affiliate && config.affiliateBps) parts.push({ who: extras.affiliate, roles: ["affiliate"], bps: config.affiliateBps });
  const brandBps = extras.brand ? brandShareFor(config, extras.brand.bps, creatorPoolBps) : 0;
  if (extras.brand && brandBps > 0) parts.push({ who: extras.brand.who, roles: ["brand"], bps: brandBps });
  const merged = new Map<string, RecipientShare>();
  for (const part of parts) {
    const existing = merged.get(part.who);
    if (!existing) {
      merged.set(part.who, { who: part.who, roles: [...part.roles], bps: part.bps });
      continue;
    }
    existing.bps += part.bps;
    for (const role of part.roles) if (!existing.roles.includes(role)) existing.roles.push(role);
  }
  const recipients = [...merged.values()];
  return { recipients, poolBps: recipients.reduce((sum, recipient) => sum + recipient.bps, 0) };
}

// One unit's cents split among recipients in proportion to their shares (v1 shares sum to 10000;
// v2 shares are of the base and sum to the line's pool); any remainder goes to the work's own creator.
export function splitUnit(cents: number, shares: Array<RecipientShare>): Array<{ who: string; cents: number }> {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("Cents must be a non-negative integer.");
  const total = shares.reduce((sum, share) => sum + share.bps, 0);
  const out = shares.map((share) => ({ who: share.who, cents: total > 0 ? Math.floor((cents * share.bps) / total) : 0 }));
  const remainder = cents - out.reduce((sum, r) => sum + r.cents, 0);
  const creator = shares.findIndex((share) => share.roles.includes("creator"));
  if (creator < 0) throw new Error("A work's recipients must include its creator.");
  out[creator].cents += remainder;
  return out;
}

// The canonical JSON for a config: keys sorted at every level, no whitespace. Its SHA-256 is what
// the registry records, and /economics/v<version>.json serves exactly these bytes.
export function canonicalConfigJson(config: EconomicConfig = ECONOMIC_CONFIG_V1): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, sort((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(sort(config));
}
