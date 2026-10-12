import { describe, expect, it } from "vitest";
import { moneyCents, normalizeOrder } from "../../convex/lib/shopify/orderQuery";
import { listUpdatedOrders } from "../../convex/lib/shopify/reconcile";
import { rawOrder } from "../fixtures/shopifyOrder";

describe("normalizeOrder", () => {
  it("reads lines, payment time, and the shipping recipient", () => {
    const order = normalizeOrder(
      rawOrder({
        ref: "friend",
        lines: [{ id: 11, variant: 1003, quantity: 2, price: "36.00", discount: "7.20", sku: "CR-101-001-BLACK-L" }],
      }),
    );
    expect(order).toMatchObject({
      shopifyOrderId: "5551234",
      name: "#1001",
      test: false,
      cancelledAt: null,
      economicEventAt: Date.parse("2026-10-01T17:00:00Z"),
      totalCents: 6480,
      ref: "friend",
      lines: [
        {
          lineItemId: "11",
          variantId: "gid://shopify/ProductVariant/1003",
          sku: "CR-101-001-BLACK-L",
          quantity: 2,
          unitPriceCents: 3600,
          discountCents: 720,
        },
      ],
    });
    expect(order.recipient).toMatchObject({ name: "Rosa Diaz", city: "Portland", stateCode: "OR", countryCode: "US", email: "buyer@example.com" });
  });

  it("has no economic event until a sale or capture succeeds", () => {
    expect(normalizeOrder(rawOrder({ paid: false, lines: [] })).economicEventAt).toBeNull();
  });

  it("reads refund status from the refund's own transactions", () => {
    const order = normalizeOrder(
      rawOrder({
        lines: [{ id: 11, variant: 1003, quantity: 1, price: "36.00" }],
        refunds: [
          { id: 1, total: "10.00", transactionStatus: "PENDING" },
          { id: 2, total: "10.00", transactionStatus: "FAILURE" },
          { id: 3, total: "36.00", lines: [{ lineItem: 11, quantity: 1, subtotal: "36.00" }], transactionStatus: "SUCCESS" },
          { id: 4, total: "0.00", lines: [{ lineItem: 11, quantity: 1, subtotal: "0.00" }], transactionStatus: null },
          { id: 5, total: "5.95", shipping: "5.95" },
        ],
      }),
    );
    expect(order.refunds.map((r) => [r.refundId, r.status])).toEqual([
      ["1", "pending"],
      ["2", "failed"],
      ["3", "succeeded"],
      ["4", "succeeded"],
      ["5", "succeeded"],
    ]);
    expect(order.refunds[2].lines).toEqual([{ lineItemId: "11", quantity: 1, subtotalCents: 3600, taxCents: 0 }]);
    expect(order.refunds[4].shippingCents).toBe(595);
  });

  it("treats a missing address as no recipient", () => {
    expect(normalizeOrder(rawOrder({ address: false, lines: [] })).recipient).toBeNull();
  });

  it("rounds money strings to the cent", () => {
    expect(moneyCents({ shopMoney: { amount: "19.995" } })).toBe(2000);
    expect(moneyCents(null)).toBe(0);
    expect(() => moneyCents({ shopMoney: { amount: "abc" } })).toThrow();
  });
});

describe("listUpdatedOrders", () => {
  it("pages through orders updated since the cursor", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const admin = {
      graphql: async <T>(_query: string, variables?: Record<string, unknown>) => {
        calls.push(variables ?? {});
        const page = calls.length;
        return {
          orders: {
            nodes: [{ id: `gid://shopify/Order/${page}`, updatedAt: `2026-10-0${page}T00:00:00Z` }],
            pageInfo: { hasNextPage: page < 2, endCursor: page < 2 ? "c1" : null },
          },
        } as T;
      },
    };
    const result = await listUpdatedOrders(admin, Date.parse("2026-09-30T00:00:00Z"));
    expect(result.complete).toBe(true);
    expect(result.orders.map((o) => o.shopifyOrderId)).toEqual(["1", "2"]);
    expect(calls[0]).toEqual({ query: "updated_at:>='2026-09-30T00:00:00.000Z'", after: null });
    expect(calls[1].after).toBe("c1");
  });
});
