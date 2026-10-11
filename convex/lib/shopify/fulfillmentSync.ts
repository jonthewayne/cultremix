// Turning a Printful shipment into a Shopify fulfillment with tracking, so Shopify sends the buyer
// its shipping email (convex/shopifyFulfill.ts). The fulfillment covers the lines the shipment
// carried, matched by Shopify line item, as far as each fulfillment order still has them open.

export const FULFILLMENT_ORDERS_QUERY = `query CultRemixFulfillmentOrders($id: ID!) {
  order(id: $id) {
    fulfillmentOrders(first: 20) {
      nodes {
        id
        status
        lineItems(first: 100) { nodes { id remainingQuantity lineItem { id } } }
      }
    }
  }
}`;

export const FULFILLMENT_CREATE_MUTATION = `mutation CultRemixFulfill($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id status }
    userErrors { field message }
  }
}`;

export type FulfillmentOrderNode = {
  id: string;
  status: string;
  lineItems: { nodes: Array<{ id: string; remainingQuantity: number; lineItem: { id: string } }> };
};

export type ShippedLine = { shopifyLineItemId: string; quantity: number };

const OPEN = new Set(["OPEN", "IN_PROGRESS", "SCHEDULED"]);

export function lineItemGid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/LineItem/${id}`;
}

// The fulfillment orders and line items a shipment covers. With no lines to match (a shipment
// Printful listed without items), everything still open is covered.
export function fulfillmentLines(nodes: ReadonlyArray<FulfillmentOrderNode>, shipped: ReadonlyArray<ShippedLine>) {
  const wanted = new Map<string, number>();
  for (const line of shipped) wanted.set(lineItemGid(line.shopifyLineItemId), (wanted.get(lineItemGid(line.shopifyLineItemId)) ?? 0) + line.quantity);
  const out: Array<{ fulfillmentOrderId: string; fulfillmentOrderLineItems: Array<{ id: string; quantity: number }> }> = [];
  for (const node of nodes) {
    if (!OPEN.has(node.status)) continue;
    const items: Array<{ id: string; quantity: number }> = [];
    for (const item of node.lineItems.nodes) {
      if (item.remainingQuantity <= 0) continue;
      if (wanted.size === 0) {
        items.push({ id: item.id, quantity: item.remainingQuantity });
        continue;
      }
      const left = wanted.get(item.lineItem.id) ?? 0;
      const quantity = Math.min(left, item.remainingQuantity);
      if (quantity <= 0) continue;
      items.push({ id: item.id, quantity });
      wanted.set(item.lineItem.id, left - quantity);
    }
    if (items.length > 0) out.push({ fulfillmentOrderId: node.id, fulfillmentOrderLineItems: items });
  }
  return out;
}

// Shopify links tracking for the carriers it knows by these names.
export function carrierName(carrier: string | undefined) {
  if (!carrier) return undefined;
  const key = carrier.toLowerCase().replace(/[^a-z]/gu, "");
  if (key.startsWith("usps")) return "USPS";
  if (key.startsWith("ups")) return "UPS";
  if (key.startsWith("fedex")) return "FedEx";
  if (key.startsWith("dhl")) return "DHL Express";
  if (key.includes("canadapost")) return "Canada Post";
  if (key.includes("royalmail")) return "Royal Mail";
  return carrier;
}

