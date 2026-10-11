// The CultRemix Gateway account's credit (convex/gatewayCredit.ts). Every design, image note, and
// model photo is paid from it; once it runs out, every new design fails. Below LOW, Admin warns and
// the owner and ops are told; at or below OUT, it's treated as run out. A batch costs about 13¢, and
// a judge using all 40 credits about $2.60.
export const LOW_CREDIT_CENTS = 1000;
export const OUT_CREDIT_CENTS = 50;
export const BATCH_CENTS = 13;

export type CreditLevel = "ok" | "low" | "out";

export function creditLevel(balanceCents: number): CreditLevel {
  if (balanceCents <= OUT_CREDIT_CENTS) return "out";
  return balanceCents < LOW_CREDIT_CENTS ? "low" : "ok";
}

const RANK: Record<CreditLevel, number> = { ok: 0, low: 1, out: 2 };

// Whether moving from one level to another is worth telling someone about.
export function creditWorsened(from: CreditLevel | undefined, to: CreditLevel) {
  return RANK[to] > RANK[from ?? "ok"];
}
