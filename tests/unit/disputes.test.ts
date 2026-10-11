import { describe, expect, it } from "vitest";
import { disputeEffect, disputeLabel, parseDispute } from "../../convex/lib/disputes";

// What a Shopify Payments dispute does to its order's earnings (INV-23), and reading its webhook.

describe("what a dispute does to its order's earnings", () => {
  it("holds while it's open, takes back a chargeback the buyer kept, and releases otherwise", () => {
    expect(disputeEffect("chargeback", "needs_response")).toBe("hold");
    expect(disputeEffect("chargeback", "UNDER_REVIEW")).toBe("hold");
    expect(disputeEffect("chargeback", "lost")).toBe("reverse");
    expect(disputeEffect("chargeback", "accepted")).toBe("reverse");
    expect(disputeEffect("chargeback", "won")).toBe("release");
    expect(disputeEffect("chargeback", "prevented")).toBe("release");
    expect(disputeEffect("chargeback", "charge_refunded")).toBe("release");
  });

  it("never takes earnings back for an inquiry: its money comes back as a refund", () => {
    expect(disputeEffect("inquiry", "under_review")).toBe("hold");
    expect(disputeEffect("inquiry", "lost")).toBe("release");
    expect(disputeEffect("inquiry", "accepted")).toBe("release");
  });

  it("holds on a status it doesn't know, until someone looks", () => {
    expect(disputeEffect("chargeback", "escalated")).toBe("hold");
  });
});

describe("reading a disputes webhook", () => {
  it("reads its ids, kind, status, amount, and dates", () => {
    expect(
      parseDispute({
        id: 5915223416966,
        order_id: "6210448720006",
        type: "chargeback",
        amount: "11.50",
        currency: "usd",
        reason: "fraudulent",
        status: "under_review",
        initiated_at: "2026-10-05T10:00:00Z",
        finalized_on: null,
      }),
    ).toEqual({
      shopifyDisputeId: "5915223416966",
      shopifyOrderId: "6210448720006",
      kind: "chargeback",
      status: "under_review",
      amountCents: 1150,
      currency: "USD",
      reason: "fraudulent",
      initiatedAt: Date.parse("2026-10-05T10:00:00Z"),
    });
  });

  it("needs both ids, and reads anything missing or odd on the safe side", () => {
    expect(parseDispute({ id: 1 })).toBeNull();
    expect(parseDispute({ order_id: 2 })).toBeNull();
    expect(parseDispute(null)).toBeNull();
    // An unknown type counts as a chargeback and a missing status as needing a response, so both hold.
    expect(parseDispute({ id: 1, order_id: 2, type: "mystery", amount: "n/a" })).toEqual({
      shopifyDisputeId: "1",
      shopifyOrderId: "2",
      kind: "chargeback",
      status: "needs_response",
    });
  });

  it("labels them for Admin, Orders", () => {
    expect(disputeLabel("chargeback", "needs_response")).toBe("Chargeback, needs a response");
    expect(disputeLabel("inquiry", "won")).toBe("Inquiry, won");
  });
});

