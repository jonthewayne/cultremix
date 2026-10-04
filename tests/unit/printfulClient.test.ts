import { describe, expect, it, vi } from "vitest";
import {
  PrintfulError,
  buildOrderRequest,
  createPrintful,
  hasShipped,
  isForward,
  printfulConfigFromEnv,
  shipmentFromPrintful,
  stateForStatus,
} from "../../convex/lib/printful/client";

const config = { token: "pf-token", storeId: "777" };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return respond(url, init);
  });
  return { fetch, calls };
}

const recipient = { name: "Rosa Diaz", address1: "12 Harbor St", city: "Portland", country_code: "US", zip: "97201" };

describe("printfulConfigFromEnv", () => {
  it("needs both the token and the store ID", () => {
    expect(printfulConfigFromEnv({})).toBeNull();
    expect(printfulConfigFromEnv({ PRINTFUL_API_TOKEN: "t" })).toBeNull();
    expect(printfulConfigFromEnv({ PRINTFUL_STORE_ID: "1" })).toBeNull();
    expect(printfulConfigFromEnv({ PRINTFUL_API_TOKEN: " t ", PRINTFUL_STORE_ID: " 1 " })).toEqual({ token: "t", storeId: "1" });
  });
});

describe("buildOrderRequest", () => {
  it("keys the order by the Shopify order ID and prints each line on the front", () => {
    const request = buildOrderRequest({
      shopifyOrderId: "5551234",
      recipient,
      lines: [
        { lineItemId: "11", catalogVariantId: 4012, quantity: 2, printUrl: "https://files.cultremix.test/works/101/002/print-abc/print.png" },
      ],
    });
    expect(request).toEqual({
      external_id: "5551234",
      shipping: "STANDARD",
      recipient,
      order_items: [
        {
          source: "catalog",
          catalog_variant_id: 4012,
          quantity: 2,
          external_id: "11",
          placements: [
            {
              placement: "front",
              technique: "dtg",
              layers: [{ type: "file", url: "https://files.cultremix.test/works/101/002/print-abc/print.png" }],
            },
          ],
        },
      ],
    });
  });
});

describe("createPrintful", () => {
  it("sends the token and store on every call and unwraps data", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ data: { id: 9, external_id: "5551234", status: "draft" } }));
    const printful = createPrintful({ config, fetch });
    const order = await printful.createOrder(buildOrderRequest({ shopifyOrderId: "5551234", recipient, lines: [] }));
    expect(order).toEqual({ id: 9, external_id: "5551234", status: "draft" });
    expect(calls[0]).toMatchObject({
      url: "https://api.printful.com/v2/orders",
      method: "POST",
      headers: { Authorization: "Bearer pf-token", "X-PF-Store-Id": "777", "Content-Type": "application/json" },
    });
    expect((calls[0].body as { external_id: string }).external_id).toBe("5551234");
  });

  it("looks an order up by external ID, and a 404 is no order", async () => {
    const { fetch, calls } = fakeFetch(() => new Response("{}", { status: 404 }));
    const printful = createPrintful({ config, fetch });
    expect(await printful.getOrderByExternalId("5551234")).toBeNull();
    expect(await printful.getOrder(9)).toBeNull();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.printful.com/v2/orders/@5551234",
      "GET https://api.printful.com/v2/orders/9",
    ]);
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("uses the v2 paths for confirm, delete, item changes, and shipments", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith("/shipments") ? Response.json({ data: [{ id: 3, shipped_at: "2026-10-05T00:00:00Z" }] }) : Response.json({ data: { id: 9, status: "pending" } }),
    );
    const printful = createPrintful({ config, fetch });
    expect(await printful.confirmOrder(9)).toMatchObject({ status: "pending" });
    await printful.deleteOrder(9);
    await printful.setItemQuantity(9, 21, 1);
    await printful.deleteItem(9, 22);
    expect(await printful.listShipments(9)).toHaveLength(1);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.printful.com", "")}`)).toEqual([
      "POST /v2/orders/9/confirmation",
      "DELETE /v2/orders/9",
      "PATCH /v2/orders/9/order-items/21",
      "DELETE /v2/orders/9/order-items/22",
      "GET /v2/orders/9/shipments",
    ]);
    expect(calls[2].body).toEqual({ quantity: 1 });
  });

  it("treats an already-deleted draft as done", async () => {
    const { fetch } = fakeFetch(() => new Response("", { status: 404 }));
    await expect(createPrintful({ config, fetch }).deleteOrder(9)).resolves.toBeUndefined();
  });

  it("marks network errors, 5xx, 409, and 429 as ambiguous, and other refusals as definite", async () => {
    const cases: Array<[() => Promise<Response>, number, boolean]> = [
      [() => Promise.reject(new TypeError("socket hang up")), 0, true],
      [async () => new Response("oops", { status: 502 }), 502, true],
      [async () => Response.json({ error: { message: "busy" } }, { status: 409 }), 409, true],
      [async () => new Response("", { status: 429 }), 429, true],
      [async () => Response.json({ error: { message: "Invalid recipient" } }, { status: 400 }), 400, false],
      [async () => new Response("", { status: 401 }), 401, false],
    ];
    for (const [respond, status, ambiguous] of cases) {
      const printful = createPrintful({ config, fetch: respond });
      const error = await printful.createOrder(buildOrderRequest({ shopifyOrderId: "1", recipient, lines: [] })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintfulError);
      expect(error).toMatchObject({ status, ambiguous });
    }
    const refused = await createPrintful({ config, fetch: async () => Response.json({ error: { message: "Invalid recipient" } }, { status: 400 }) })
      .createOrder(buildOrderRequest({ shopifyOrderId: "1", recipient, lines: [] }))
      .catch((e: Error) => e.message);
    expect(refused).toBe("Invalid recipient");
  });

  it("calls a create that answers without an order ambiguous", async () => {
    const printful = createPrintful({ config, fetch: async () => new Response("", { status: 200 }) });
    await expect(printful.createOrder(buildOrderRequest({ shopifyOrderId: "1", recipient, lines: [] }))).rejects.toMatchObject({
      ambiguous: true,
    });
  });
});

describe("statuses", () => {
  it("maps Printful statuses to fulfillment states", () => {
    expect(stateForStatus("draft")).toBe("draft");
    expect(stateForStatus("pending")).toBe("submitted");
    expect(stateForStatus("inreview")).toBe("submitted");
    expect(stateForStatus("onhold")).toBe("on_hold");
    expect(stateForStatus("inprocess")).toBe("in_production");
    expect(stateForStatus("partial")).toBe("partial");
    expect(stateForStatus("fulfilled")).toBe("shipped");
    expect(stateForStatus("canceled")).toBe("canceled");
    expect(stateForStatus("failed")).toBe("needs_attention");
    expect(stateForStatus("something-new")).toBeNull();
  });

  it("only moves forward, except into needs_attention", () => {
    expect(isForward("draft", "submitted")).toBe(true);
    expect(isForward("submitted", "on_hold")).toBe(true);
    expect(isForward("on_hold", "submitted")).toBe(true);
    expect(isForward("in_production", "submitted")).toBe(false);
    expect(isForward("in_production", "draft")).toBe(false);
    expect(isForward("partial", "shipped")).toBe(true);
    expect(isForward("shipped", "in_production")).toBe(false);
    expect(isForward("canceled", "draft")).toBe(false);
    expect(isForward("in_production", "needs_attention")).toBe(true);
    expect(isForward("creating", "draft")).toBe(true);
  });
});

describe("shipments", () => {
  it("counts a shipment once it has left", () => {
    expect(hasShipped({ id: 1, shipped_at: "2026-10-05T00:00:00Z" })).toBe(true);
    expect(hasShipped({ id: 1, status: "in_transit" })).toBe(true);
    expect(hasShipped({ id: 1, status: "pending" })).toBe(false);
    expect(hasShipped({ id: 1 })).toBe(false);
  });

  it("keeps the ship time, tracking, and items", () => {
    expect(
      shipmentFromPrintful(
        {
          id: 31,
          carrier: "USPS",
          tracking_number: "9400",
          tracking_url: "https://track.example/9400",
          shipped_at: "2026-10-05T00:00:00Z",
          shipment_items: [{ order_item_id: 21, quantity: 2 }],
        },
        0,
      ),
    ).toEqual({
      id: "31",
      shippedAt: Date.parse("2026-10-05T00:00:00Z"),
      carrier: "USPS",
      trackingNumber: "9400",
      trackingUrl: "https://track.example/9400",
      items: [{ printfulItemId: 21, quantity: 2 }],
    });
    expect(shipmentFromPrintful({ id: 32, tracking_number: null }, 1234)).toEqual({ id: "32", shippedAt: 1234, items: [] });
  });
});
