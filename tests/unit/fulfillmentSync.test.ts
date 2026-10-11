import { describe, expect, it } from "vitest";
import { carrierName, fulfillmentLines, lineItemGid } from "../../convex/lib/shopify/fulfillmentSync";

const node = (id: string, status: string, items: Array<[string, string, number]>) => ({
  id,
  status,
  lineItems: { nodes: items.map(([itemId, lineItem, remainingQuantity]) => ({ id: itemId, remainingQuantity, lineItem: { id: lineItem } })) },
});

describe("a shipment as a Shopify fulfillment", () => {
  it("covers the shipped lines, as far as each is still open", () => {
    const nodes = [
      node("gid://shopify/FulfillmentOrder/1", "OPEN", [
        ["gid://shopify/FulfillmentOrderLineItem/10", "gid://shopify/LineItem/11", 2],
        ["gid://shopify/FulfillmentOrderLineItem/20", "gid://shopify/LineItem/12", 1],
      ]),
      node("gid://shopify/FulfillmentOrder/2", "CLOSED", [["gid://shopify/FulfillmentOrderLineItem/30", "gid://shopify/LineItem/11", 5]]),
    ];
    expect(fulfillmentLines(nodes, [{ shopifyLineItemId: "11", quantity: 5 }])).toEqual([
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/10", quantity: 2 }] },
    ]);
  });

  it("covers everything open when the shipment named no lines, and nothing when all is fulfilled", () => {
    const nodes = [
      node("gid://shopify/FulfillmentOrder/1", "IN_PROGRESS", [
        ["gid://shopify/FulfillmentOrderLineItem/10", "gid://shopify/LineItem/11", 1],
        ["gid://shopify/FulfillmentOrderLineItem/20", "gid://shopify/LineItem/12", 0],
      ]),
    ];
    expect(fulfillmentLines(nodes, [])).toEqual([
      { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/10", quantity: 1 }] },
    ]);
    expect(fulfillmentLines([node("gid://shopify/FulfillmentOrder/1", "CLOSED", [])], [])).toEqual([]);
  });

  it("names carriers the way Shopify links them", () => {
    expect(carrierName("usps")).toBe("USPS");
    expect(carrierName("UPS Ground")).toBe("UPS");
    expect(carrierName("FEDEX")).toBe("FedEx");
    expect(carrierName("DHL eCommerce")).toBe("DHL Express");
    expect(carrierName("Asendia")).toBe("Asendia");
    expect(carrierName(undefined)).toBeUndefined();
    expect(lineItemGid("11")).toBe("gid://shopify/LineItem/11");
    expect(lineItemGid("gid://shopify/LineItem/11")).toBe("gid://shopify/LineItem/11");
  });
});

