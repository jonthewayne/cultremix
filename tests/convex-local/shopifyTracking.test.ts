import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";
import { SHOP_ENV } from "./shopFixtures";

type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// An order with one line of 2 shirts, and a Printful shipment of both with USPS tracking.
async function shipped(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      shopifyOrderId: "820982911946154508",
      shopDomain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN,
      isTest: false,
      simulated: false,
      financialState: "PAID",
      cancelled: false,
      currency: "USD",
      totalCents: 7200,
      fulfillmentState: "shipped",
      printfulOrderId: 9,
      createdAt: now,
      updatedAt: now,
    });
    const itemId = await ctx.db.insert("orderItems", {
      orderId,
      shopifyLineItemId: "466157049",
      quantity: 2,
      unitPriceCents: 3600,
      discountCents: 0,
      configVersion: 1,
      recipients: [],
      baseCents: 7200,
      poolCents: 1080,
      unitPoolCents: [540, 540],
      createdAt: now,
    });
    return await ctx.db.insert("orderShipments", {
      orderId,
      printfulShipmentId: "s1",
      shippedAt: now,
      lines: [{ orderItemId: itemId, fromUnit: 1, toUnit: 2 }],
      carrier: "USPS",
      trackingNumber: "9400100000000000000000",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000",
      shopifyState: "pending",
      shopifyAttempts: 0,
      shopifyNextAt: now,
    });
  });
}

function fakeShopify(openQuantity = 2) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "tok", expires_in: 86399 });
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(body);
    if (body.query.includes("CultRemixFulfillmentOrders")) {
      return Response.json({
        data: {
          order: {
            fulfillmentOrders: {
              nodes: [
                {
                  id: "gid://shopify/FulfillmentOrder/1",
                  status: openQuantity > 0 ? "OPEN" : "CLOSED",
                  lineItems: { nodes: [{ id: "gid://shopify/FulfillmentOrderLineItem/7", remainingQuantity: openQuantity, lineItem: { id: "gid://shopify/LineItem/466157049" } }] },
                },
              ],
            },
          },
        },
      });
    }
    return Response.json({ data: { fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/55", status: "SUCCESS" }, userErrors: [] } } });
  });
  return calls;
}

const shipmentOf = (t: T, id: Id<"orderShipments">) => t.run((ctx) => ctx.db.get("orderShipments", id));

describe("tracking to Shopify", () => {
  it("creates one fulfillment with the tracking and asks Shopify to email the buyer", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const calls = fakeShopify();
    const shipmentId = await shipped(t);
    expect(await t.action(internal.shopifyFulfill.run, { shipmentId })).toBe("done");
    const create = calls.find((call) => call.query.includes("fulfillmentCreate"))!;
    expect(create.variables).toEqual({
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/7", quantity: 2 }] },
        ],
        notifyCustomer: true,
        trackingInfo: {
          company: "USPS",
          number: "9400100000000000000000",
          url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000",
        },
      },
    });
    expect(await shipmentOf(t, shipmentId)).toMatchObject({ shopifyState: "done", shopifyFulfillmentId: "gid://shopify/Fulfillment/55" });
    // Never twice.
    expect(await t.action(internal.shopifyFulfill.run, { shipmentId })).toBe("skipped");
    expect(calls.filter((call) => call.query.includes("fulfillmentCreate"))).toHaveLength(1);
  });

  it("skips a shipment Shopify already has fulfilled", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const calls = fakeShopify(0);
    const shipmentId = await shipped(t);
    expect(await t.action(internal.shopifyFulfill.run, { shipmentId })).toBe("skipped");
    expect(calls.some((call) => call.query.includes("fulfillmentCreate"))).toBe(false);
    expect((await shipmentOf(t, shipmentId))?.shopifyState).toBe("skipped");
  });

  it("waits without counting attempts while Shopify isn't set up, then retries when due", async () => {
    const t = newTest();
    const shipmentId = await shipped(t);
    expect(await t.action(internal.shopifyFulfill.run, { shipmentId })).toBe("waiting");
    expect(await shipmentOf(t, shipmentId)).toMatchObject({ shopifyState: "pending", shopifyAttempts: 0, shopifyError: "Shopify is not configured yet." });
    await t.run((ctx) => ctx.db.patch("orderShipments", shipmentId, { shopifyNextAt: 0 }));
    expect(await t.mutation(internal.shopifyFulfill.retryDue, {})).toBe(1);
  });

  it("backs off after Shopify refuses, and stops for the owner after six tries", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("access_token") ? Response.json({ access_token: "tok", expires_in: 86399 }) : new Response("down", { status: 503 }),
    );
    const shipmentId = await shipped(t);
    for (let i = 0; i < 6; i++) expect(await t.action(internal.shopifyFulfill.run, { shipmentId })).toBe("failed");
    expect(await shipmentOf(t, shipmentId)).toMatchObject({ shopifyState: "failed", shopifyAttempts: 6 });
  });
});

