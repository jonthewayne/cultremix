import { gidTail } from "../../../shared/config/shopify";

// Hydration (V1 plan, order ingestion): webhooks only say "look at order N"; the full order, its
// transactions, and its refunds are read from the Admin API and normalized here. The query and the
// field names are the pinned API version's (shared/config/shopify.ts); U0(e) recaptures the
// fixture in tests/unit/shopifyOrder.test.ts if the version changes.

export const ORDER_QUERY = `#graphql
query HydrateOrder($id: ID!) {
  order(id: $id) {
    id
    name
    test
    email
    cancelledAt
    updatedAt
    displayFinancialStatus
    currencyCode
    totalPriceSet { shopMoney { amount currencyCode } }
    customAttributes { key value }
    shippingAddress { name company address1 address2 city provinceCode countryCodeV2 zip phone }
    lineItems(first: 100) {
      nodes {
        id
        quantity
        sku
        variant { id }
        customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount } }
        discountAllocations { allocatedAmountSet { shopMoney { amount } } }
      }
    }
    transactions(first: 50) { id kind status processedAt createdAt amountSet { shopMoney { amount } } }
    refunds(first: 50) {
      id
      createdAt
      totalRefundedSet { shopMoney { amount } }
      refundLineItems(first: 100) {
        nodes {
          lineItem { id }
          quantity
          subtotalSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
        }
      }
      refundShippingLines(first: 10) {
        nodes { subtotalAmountSet { shopMoney { amount } } taxAmountSet { shopMoney { amount } } }
      }
      transactions(first: 20) { nodes { id kind status amountSet { shopMoney { amount } } } }
    }
  }
}`;

type Money = { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null | undefined;
type Attr = { key: string; value: string | null };

export type RawOrder = {
  id: string;
  name?: string | null;
  test?: boolean | null;
  email?: string | null;
  cancelledAt?: string | null;
  updatedAt?: string | null;
  displayFinancialStatus?: string | null;
  currencyCode?: string | null;
  totalPriceSet?: Money;
  customAttributes?: Array<Attr> | null;
  shippingAddress?: {
    name?: string | null;
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    countryCodeV2?: string | null;
    zip?: string | null;
    phone?: string | null;
  } | null;
  lineItems?: {
    nodes: Array<{
      id: string;
      quantity: number;
      sku?: string | null;
      variant?: { id: string } | null;
      customAttributes?: Array<Attr> | null;
      originalUnitPriceSet?: Money;
      discountAllocations?: Array<{ allocatedAmountSet?: Money }> | null;
    }>;
  } | null;
  transactions?: Array<{
    id?: string;
    kind: string;
    status: string;
    processedAt?: string | null;
    createdAt?: string | null;
    amountSet?: Money;
  }> | null;
  refunds?: Array<{
    id: string;
    createdAt?: string | null;
    totalRefundedSet?: Money;
    refundLineItems?: {
      nodes: Array<{ lineItem?: { id: string } | null; quantity: number; subtotalSet?: Money; totalTaxSet?: Money }>;
    } | null;
    refundShippingLines?: { nodes: Array<{ subtotalAmountSet?: Money; taxAmountSet?: Money }> } | null;
    transactions?: { nodes: Array<{ kind: string; status: string; amountSet?: Money }> } | null;
  }> | null;
};

export type RefundStatus = "pending" | "succeeded" | "failed";

export type HydratedOrder = {
  shopifyOrderId: string;
  name: string;
  test: boolean;
  cancelledAt: number | null;
  updatedAt: number | null;
  financialState: string;
  currency: string;
  totalCents: number;
  ref: string | null;
  // processedAt of the first successful SALE or CAPTURE (KTD-18); null means no earnings.
  economicEventAt: number | null;
  recipient: {
    name: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    stateCode?: string;
    countryCode: string;
    zip: string;
    phone?: string;
    email?: string;
  } | null;
  lines: Array<{
    lineItemId: string;
    variantId: string | null;
    sku: string | null;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    workIdAttr: string | null;
    crAttr: string | null;
  }>;
  refunds: Array<{
    refundId: string;
    createdAt: number;
    status: RefundStatus;
    lines: Array<{ lineItemId: string; quantity: number; subtotalCents: number; taxCents: number }>;
    shippingCents: number;
    totalCents: number;
  }>;
};

// "36.00" -> 3600. Shopify money strings are decimal; round to the cent.
export function moneyCents(money: Money): number {
  const amount = money?.shopMoney?.amount;
  if (amount === null || amount === undefined || amount === "") return 0;
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Bad money amount "${amount}".`);
  return Math.round(value * 100);
}

function attr(list: Array<Attr> | null | undefined, key: string): string | null {
  const value = list?.find((a) => a.key === key)?.value;
  return value ? value : null;
}

function time(text: string | null | undefined): number | null {
  if (!text) return null;
  const value = Date.parse(text);
  return Number.isFinite(value) ? value : null;
}

function clean(text: string | null | undefined): string | undefined {
  const value = text?.trim();
  return value ? value : undefined;
}

const PAYMENT_KINDS = new Set(["SALE", "CAPTURE"]);
const FAILED = new Set(["FAILURE", "ERROR"]);

function refundStatus(transactions: Array<{ kind: string; status: string }>): RefundStatus {
  const refunds = transactions.filter((t) => t.kind === "REFUND");
  // A refund with no money movement (restock only) is complete as recorded.
  if (refunds.length === 0) return "succeeded";
  if (refunds.some((t) => t.status === "SUCCESS")) return "succeeded";
  if (refunds.every((t) => FAILED.has(t.status))) return "failed";
  return "pending";
}

export function normalizeOrder(raw: RawOrder): HydratedOrder {
  const transactions = raw.transactions ?? [];
  const paidAt = transactions
    .filter((t) => PAYMENT_KINDS.has(t.kind) && t.status === "SUCCESS")
    .map((t) => time(t.processedAt) ?? time(t.createdAt))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];

  const address = raw.shippingAddress;
  const recipient =
    address?.address1 && address.city && address.countryCodeV2 && address.zip
      ? {
          name: clean(address.name) ?? "Customer",
          company: clean(address.company),
          address1: address.address1.trim(),
          address2: clean(address.address2),
          city: address.city.trim(),
          stateCode: clean(address.provinceCode),
          countryCode: address.countryCodeV2.trim(),
          zip: address.zip.trim(),
          phone: clean(address.phone),
          email: clean(raw.email),
        }
      : null;

  return {
    shopifyOrderId: gidTail(raw.id),
    name: raw.name ?? `#${gidTail(raw.id)}`,
    test: raw.test === true,
    cancelledAt: time(raw.cancelledAt),
    updatedAt: time(raw.updatedAt),
    financialState: raw.displayFinancialStatus ?? "UNKNOWN",
    currency: raw.currencyCode ?? raw.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
    totalCents: moneyCents(raw.totalPriceSet),
    ref: attr(raw.customAttributes, "_ref"),
    economicEventAt: paidAt ?? null,
    recipient,
    lines: (raw.lineItems?.nodes ?? []).map((line) => ({
      lineItemId: gidTail(line.id),
      variantId: line.variant?.id ?? null,
      sku: line.sku ?? null,
      quantity: line.quantity,
      unitPriceCents: moneyCents(line.originalUnitPriceSet),
      discountCents: (line.discountAllocations ?? []).reduce((sum, d) => sum + moneyCents(d.allocatedAmountSet), 0),
      workIdAttr: attr(line.customAttributes, "_work_id"),
      crAttr: attr(line.customAttributes, "_cr"),
    })),
    refunds: (raw.refunds ?? []).map((refund) => {
      const moneyTransactions = refund.transactions?.nodes ?? [];
      const lines = (refund.refundLineItems?.nodes ?? [])
        .filter((l) => l.lineItem?.id)
        .map((l) => ({
          lineItemId: gidTail(l.lineItem!.id),
          quantity: l.quantity,
          subtotalCents: moneyCents(l.subtotalSet),
          taxCents: moneyCents(l.totalTaxSet),
        }));
      const transactionCents = moneyTransactions
        .filter((t) => t.kind === "REFUND" && !FAILED.has(t.status))
        .reduce((sum, t) => sum + moneyCents(t.amountSet), 0);
      return {
        refundId: gidTail(refund.id),
        createdAt: time(refund.createdAt) ?? 0,
        status: refundStatus(moneyTransactions),
        lines,
        shippingCents: (refund.refundShippingLines?.nodes ?? []).reduce(
          (sum, s) => sum + moneyCents(s.subtotalAmountSet) + moneyCents(s.taxAmountSet),
          0,
        ),
        totalCents: Math.max(moneyCents(refund.totalRefundedSet), transactionCents),
      };
    }),
  };
}

export const ORDERS_UPDATED_QUERY = `#graphql
query OrdersUpdated($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) {
    nodes { id updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;
