// Shopify Payments disputes (chargebacks and inquiries) and what they do to the earnings of the
// order they're on (the plan's INV-23). Pure, so the rules are tested without a deployment.
// The disputes webhooks (convex/disputes.ts) are the source; they carry the dispute's own status,
// so a dispute on an order of any age is seen (the order query's own disputes field is limited to
// recent orders without read_all_orders).

export type DisputeKind = "chargeback" | "inquiry";

// hold: the order's earnings don't mature while it's open. reverse: the buyer kept the money (a
// chargeback lost, or accepted by the store), so what's left of the earnings is taken back, the way
// a cancellation does. release: it's over and the money stayed with the store.
export type DisputeEffect = "hold" | "reverse" | "release";

// An inquiry never reverses on its own: any money it moves comes back as a refund, and the refund
// reverses through refunds/create. charge_refunded (deprecated) means the store refunded the charge,
// which also arrives as a refund. A status this code doesn't know holds, so nothing matures until
// someone looks.
export function disputeEffect(kind: string, status: string): DisputeEffect {
  const s = status.trim().toLowerCase();
  if (s === "needs_response" || s === "under_review") return "hold";
  if (s === "lost" || s === "accepted") return kind === "inquiry" ? "release" : "reverse";
  if (s === "won" || s === "prevented" || s === "charge_refunded") return "release";
  return "hold";
}

export type ParsedDispute = {
  shopifyDisputeId: string;
  shopifyOrderId: string;
  kind: DisputeKind;
  status: string;
  amountCents?: number;
  currency?: string;
  reason?: string;
  initiatedAt?: number;
  finalizedAt?: number;
};

const idOf = (value: unknown) =>
  typeof value === "number" || (typeof value === "string" && /^\d+$/u.test(value)) ? String(value) : null;

const timeOf = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
};

const shortText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

// The disputes/create and disputes/update payload (Shopify's Dispute resource): id, order_id, type
// ("chargeback" or "inquiry"), amount ("11.50"), currency, reason, status, initiated_at, finalized_on.
// Null without a dispute id and an order id. A missing status reads as needs_response (it holds).
export function parseDispute(payload: unknown): ParsedDispute | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const shopifyDisputeId = idOf(raw.id);
  const shopifyOrderId = idOf(raw.order_id);
  if (!shopifyDisputeId || !shopifyOrderId) return null;
  const amount = typeof raw.amount === "number" ? raw.amount : typeof raw.amount === "string" ? Number(raw.amount) : NaN;
  const status = shortText(raw.status, 40)?.toLowerCase() ?? "needs_response";
  const out: ParsedDispute = {
    shopifyDisputeId,
    shopifyOrderId,
    kind: String(raw.type ?? "").toLowerCase() === "inquiry" ? "inquiry" : "chargeback",
    status,
  };
  if (Number.isFinite(amount) && amount >= 0) out.amountCents = Math.round(amount * 100);
  const currency = shortText(raw.currency, 8);
  if (currency) out.currency = currency.toUpperCase();
  const reason = shortText(raw.reason, 80);
  if (reason) out.reason = reason;
  const initiatedAt = timeOf(raw.initiated_at);
  if (initiatedAt !== undefined) out.initiatedAt = initiatedAt;
  const finalizedAt = timeOf(raw.finalized_on);
  if (finalizedAt !== undefined) out.finalizedAt = finalizedAt;
  return out;
}

// "Chargeback, under review", for Admin, Orders.
export function disputeLabel(kind: string, status: string) {
  const words: Record<string, string> = {
    needs_response: "needs a response",
    under_review: "under review",
    charge_refunded: "refunded",
  };
  const s = status.trim().toLowerCase();
  return (kind === "inquiry" ? "Inquiry" : "Chargeback") + ", " + (words[s] ?? s.replace(/_/gu, " "));
}

