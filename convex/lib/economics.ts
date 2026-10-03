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

export type EconomicRole = "creator" | "family_root" | "upstream";

export type EconomicConfig = {
  version: number;
  // Share of each line's base that goes to creators, in basis points.
  creatorPoolBps: number;
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
export function recipientShares(lineage: EconomicLineage, config: EconomicConfig = ECONOMIC_CONFIG_V1): Array<RecipientShare> {
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
  const merged = new Map<string, RecipientShare>();
  for (const part of parts) {
    const existing = merged.get(part.who);
    if (existing) {
      existing.bps += part.bps;
      existing.roles.push(part.role);
    } else {
      merged.set(part.who, { who: part.who, roles: [part.role], bps: part.bps });
    }
  }
  const total = [...merged.values()].reduce((sum, r) => sum + r.bps, 0);
  if (total !== 10000) throw new Error("Economic shares must sum to 10000 basis points.");
  return [...merged.values()].sort((a, b) => b.bps - a.bps);
}

// The creator pool for one paid line, split per unit: unit i (1-based) gets units[i - 1] cents.
export function linePool(
  args: { unitPriceCents: number; quantity: number; discountCents: number },
  config: EconomicConfig = ECONOMIC_CONFIG_V1,
): { baseCents: number; poolCents: number; units: Array<number> } {
  const { unitPriceCents, quantity, discountCents } = args;
  for (const n of [unitPriceCents, quantity, discountCents]) {
    if (!Number.isInteger(n) || n < 0) throw new Error("Line amounts must be non-negative integers.");
  }
  const baseCents = Math.max(0, unitPriceCents * quantity - discountCents);
  const poolCents = Math.floor((baseCents * config.creatorPoolBps) / 10000);
  const units: Array<number> = [];
  if (quantity > 0) {
    const each = Math.floor(poolCents / quantity);
    const extra = poolCents - each * quantity;
    for (let i = 0; i < quantity; i++) units.push(each + (i < extra ? 1 : 0));
  }
  return { baseCents, poolCents, units };
}

// One unit's cents split among recipients; any remainder goes to the work's own creator.
export function splitUnit(cents: number, shares: Array<RecipientShare>): Array<{ who: string; cents: number }> {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("Cents must be a non-negative integer.");
  const out = shares.map((share) => ({ who: share.who, cents: Math.floor((cents * share.bps) / 10000) }));
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
