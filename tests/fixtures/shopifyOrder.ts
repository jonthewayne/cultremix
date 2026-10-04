import type { RawOrder } from "../../convex/lib/shopify/orderQuery";

// A HydrateOrder response in the shape the pinned Admin API version returns (2026-07): GIDs,
// MoneyBag shopMoney strings, connection nodes for line items and refund lines, and a plain list
// for transactions. U0(e) recaptures this from a real test order before launch.

export type FixtureLine = { id: number; variant: number | null; quantity: number; price: string; discount?: string; sku?: string };
export type FixtureRefund = {
  id: number;
  createdAt?: string;
  lines?: Array<{ lineItem: number; quantity: number; subtotal: string; tax?: string }>;
  shipping?: string;
  total: string;
  transactionStatus?: "SUCCESS" | "PENDING" | "FAILURE" | null;
};

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });

export function rawOrder(args: {
  id?: number;
  name?: string;
  test?: boolean;
  paid?: boolean;
  paidAt?: string;
  cancelledAt?: string | null;
  updatedAt?: string;
  lines: Array<FixtureLine>;
  refunds?: Array<FixtureRefund>;
  address?: boolean;
  ref?: string;
}): RawOrder {
  const id = args.id ?? 5551234;
  const subtotal = args.lines.reduce((sum, l) => sum + Number(l.price) * l.quantity - Number(l.discount ?? "0"), 0);
  return {
    id: `gid://shopify/Order/${id}`,
    name: args.name ?? "#1001",
    test: args.test ?? false,
    email: "buyer@example.com",
    cancelledAt: args.cancelledAt ?? null,
    updatedAt: args.updatedAt ?? "2026-10-01T18:00:00Z",
    displayFinancialStatus: args.paid === false ? "PENDING" : "PAID",
    currencyCode: "USD",
    totalPriceSet: money(subtotal.toFixed(2)),
    customAttributes: args.ref ? [{ key: "_ref", value: args.ref }] : [],
    shippingAddress:
      args.address === false
        ? null
        : {
            name: "Rosa Diaz",
            company: null,
            address1: "12 Harbor St",
            address2: "Apt 4",
            city: "Portland",
            provinceCode: "OR",
            countryCodeV2: "US",
            zip: "97201",
            phone: null,
          },
    lineItems: {
      nodes: args.lines.map((line) => ({
        id: `gid://shopify/LineItem/${line.id}`,
        quantity: line.quantity,
        sku: line.sku ?? null,
        variant: line.variant === null ? null : { id: `gid://shopify/ProductVariant/${line.variant}` },
        customAttributes: [],
        originalUnitPriceSet: money(line.price),
        discountAllocations: line.discount ? [{ allocatedAmountSet: money(line.discount) }] : [],
      })),
    },
    transactions:
      args.paid === false
        ? [{ id: "gid://shopify/OrderTransaction/1", kind: "AUTHORIZATION", status: "PENDING", processedAt: null, createdAt: "2026-10-01T17:00:00Z", amountSet: money(subtotal.toFixed(2)) }]
        : [
            {
              id: "gid://shopify/OrderTransaction/1",
              kind: "SALE",
              status: "SUCCESS",
              processedAt: args.paidAt ?? "2026-10-01T17:00:00Z",
              createdAt: "2026-10-01T16:59:58Z",
              amountSet: money(subtotal.toFixed(2)),
            },
          ],
    refunds: (args.refunds ?? []).map((refund) => ({
      id: `gid://shopify/Refund/${refund.id}`,
      createdAt: refund.createdAt ?? "2026-10-02T12:00:00Z",
      totalRefundedSet: money(refund.transactionStatus === "FAILURE" ? "0.00" : refund.total),
      refundLineItems: {
        nodes: (refund.lines ?? []).map((l) => ({
          lineItem: { id: `gid://shopify/LineItem/${l.lineItem}` },
          quantity: l.quantity,
          subtotalSet: money(l.subtotal),
          totalTaxSet: money(l.tax ?? "0.00"),
        })),
      },
      refundShippingLines: {
        nodes: refund.shipping ? [{ subtotalAmountSet: money(refund.shipping), taxAmountSet: money("0.00") }] : [],
      },
      transactions: {
        nodes:
          refund.transactionStatus === null
            ? []
            : [{ id: `gid://shopify/OrderTransaction/${refund.id}`, kind: "REFUND", status: refund.transactionStatus ?? "SUCCESS", amountSet: money(refund.total) }],
      },
    })),
  };
}
