import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { rawOrder, type FixtureLine, type FixtureRefund } from "../fixtures/shopifyOrder";
import { newTest } from "./setup";
import { SHOP_ENV, deliver, fakeShopify, makeOnSale, makeUser, makeWork, postShopifyWebhook, setFlag } from "./shopFixtures";

// Printful fulfillment against a fake Printful v2 API and a fake Shopify Admin API. No network.

type T = ReturnType<typeof newTest>;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ORDER_ID = 5551234;
const STORE_ID = "777";
const WEBHOOK_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const PRINT_KEY = "works/101/002/print-abcdefghijklmnopqrstuvwxyz/print.png";

vi.setConfig({ testTimeout: 30_000 });

type FakeOrder = {
  id: number;
  external_id: string;
  store_id: number;
  status: string;
  order_items: Array<{ id: number; external_id: string; catalog_variant_id: number; quantity: number }>;
};
type CreateMode = "ok" | "refuse" | "unreachable" | "made-but-unanswered";

// A fake Printful v2: orders by ID, looked up by external_id, with a switchable create outcome.
function fakePrintful() {
  const orders = new Map<number, FakeOrder>();
  const shipments = new Map<number, Array<Record<string, unknown>>>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let nextId = 900;
  let nextItem = 2100;
  let createMode: CreateMode = "ok";

  const make = (body: { external_id: string; order_items: Array<{ external_id: string; catalog_variant_id: number; quantity: number }> }) => {
    const order: FakeOrder = {
      id: ++nextId,
      external_id: body.external_id,
      store_id: Number(STORE_ID),
      status: "draft",
      order_items: body.order_items.map((item) => ({ id: ++nextItem, ...item })),
    };
    orders.set(order.id, order);
    return order;
  };

  const handle = (url: string, init: RequestInit = {}): Response => {
    const method = init.method ?? "GET";
    const path = url.replace("https://api.printful.com", "");
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, path, body });
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== "Bearer pf-token" || headers["X-PF-Store-Id"] !== STORE_ID) {
      return Response.json({ error: { message: "bad auth" } }, { status: 401 });
    }
    let m: RegExpMatchArray | null;
    if (method === "GET" && (m = path.match(/^\/v2\/orders\/@(.+)$/u))) {
      const found = [...orders.values()].find((o) => o.external_id === decodeURIComponent(m![1]));
      return found ? Response.json({ data: found }) : Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    if (method === "POST" && path === "/v2/orders") {
      if (createMode === "refuse") return Response.json({ error: { message: "Invalid recipient" } }, { status: 400 });
      if (createMode === "unreachable") throw new TypeError("connection reset");
      const order = make(body);
      if (createMode === "made-but-unanswered") return new Response("upstream timeout", { status: 504 });
      return Response.json({ data: order });
    }
    if ((m = path.match(/^\/v2\/orders\/(\d+)\/confirmation$/u)) && method === "POST") {
      const order = orders.get(Number(m[1]))!;
      order.status = "pending";
      return Response.json({ data: order });
    }
    if ((m = path.match(/^\/v2\/orders\/(\d+)\/shipments$/u))) {
      return Response.json({ data: shipments.get(Number(m[1])) ?? [] });
    }
    if ((m = path.match(/^\/v2\/orders\/(\d+)\/order-items\/(\d+)$/u))) {
      const order = orders.get(Number(m[1]))!;
      const itemId = Number(m[2]);
      if (method === "DELETE") order.order_items = order.order_items.filter((i) => i.id !== itemId);
      else order.order_items.find((i) => i.id === itemId)!.quantity = (body as { quantity: number }).quantity;
      return Response.json({ data: order });
    }
    if ((m = path.match(/^\/v2\/orders\/(\d+)$/u))) {
      const order = orders.get(Number(m[1]));
      if (method === "DELETE") {
        orders.delete(Number(m[1]));
        return new Response(null, { status: 204 });
      }
      return order ? Response.json({ data: order }) : Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    throw new Error(`Unexpected Printful call: ${method} ${path}`);
  };

  return {
    handle,
    calls,
    orders,
    shipments,
    setCreateMode: (mode: CreateMode) => {
      createMode = mode;
    },
    // An order already in Printful (made by an earlier, unanswered create, or by hand).
    add: (externalId: string, items: Array<{ external_id: string; quantity: number }>) =>
      make({ external_id: externalId, order_items: items.map((i) => ({ ...i, catalog_variant_id: 5002 })) }),
    count: (method: string, pattern: RegExp) => calls.filter((c) => c.method === method && pattern.test(c.path)).length,
  };
}

let shopify: ReturnType<typeof fakeShopify>;
let printful: ReturnType<typeof fakePrintful>;

const creates = () => printful.count("POST", /^\/v2\/orders$/u);
const confirms = () => printful.count("POST", /\/confirmation$/u);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
  for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("DEPLOYMENT_ENV", "staging");
  vi.stubEnv("PRINTFUL_API_TOKEN", "pf-token");
  vi.stubEnv("PRINTFUL_STORE_ID", STORE_ID);
  vi.stubEnv("PRINTFUL_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("PRINTFUL_AUTO_CONFIRM", "true");
  shopify = fakeShopify();
  printful = fakePrintful();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://api.printful.com") ? printful.handle(String(input), init) : shopify.fetchFake(input, init),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function prod() {
  vi.stubEnv("DEPLOYMENT_ENV", "prod");
}

// Runs whatever is due now (and up to `ms` ahead), leaving later work scheduled.
async function settle(t: T, ms = 0) {
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  if (ms > 0) {
    vi.advanceTimersByTime(ms);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  }
}

async function onSale(t: T, opts: { printKey?: string | null; printfulBase?: number | null } = {}) {
  const a = await makeUser(t, { name: "A", creatorNumber: 1 });
  const b = await makeUser(t, { name: "B", creatorNumber: 2 });
  const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
  const work = await makeWork(t, {
    creatorId: b,
    family: 101,
    expression: 2,
    parent: root,
    root,
    printKey: opts.printKey === null ? undefined : (opts.printKey ?? PRINT_KEY),
  });
  await makeOnSale(t, work, "101-002", 1000, opts.printfulBase === undefined ? 5000 : opts.printfulBase);
  return { a, b, work };
}

const line = (quantity: number, extra: Partial<FixtureLine> = {}): FixtureLine => ({ id: 11, variant: 1002, quantity, price: "36.00", ...extra });

type OrderArgs = { lines?: Array<FixtureLine>; paidAt?: string; cancelledAt?: string; refunds?: Array<FixtureRefund>; test?: boolean; address?: boolean; updatedAt?: string };
function setOrder(args: OrderArgs = {}) {
  shopify.set(rawOrder({ lines: args.lines ?? [line(1)], ...args }));
}

async function paid(t: T, args: OrderArgs = {}, opts: { now?: boolean } = {}) {
  setOrder(args);
  if (opts.now) {
    await postShopifyWebhook(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    await settle(t);
  } else {
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
  }
}

async function theOrder(t: T) {
  const orders = await t.run((ctx) => ctx.db.query("orders").collect());
  expect(orders).toHaveLength(1);
  return orders[0];
}

async function items(t: T, orderId: Id<"orders">) {
  return t.run((ctx) => ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect());
}

let pfEvent = 0;
async function printfulWebhook(
  t: T,
  payload: Record<string, unknown>,
  opts: { signature?: string | null; raw?: string } = {},
) {
  const body = opts.raw ?? JSON.stringify({ retries: 0, store_id: Number(STORE_ID), occurred_at: new Date(Date.now() + ++pfEvent).toISOString(), ...payload });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature =
    opts.signature === undefined ? createHmac("sha256", Buffer.from(WEBHOOK_SECRET, "hex")).update(body).digest("hex") : opts.signature;
  if (signature !== null) headers["x-pf-webhook-signature"] = signature;
  const response = await t.fetch("/webhooks/printful", { method: "POST", headers, body });
  await settle(t);
  return response;
}

describe("creating the Printful order", () => {
  it("makes one draft per paid order, keyed by the Shopify order, and staging never confirms it", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t, { lines: [line(2)] });

    expect(creates()).toBe(1);
    const sent = printful.calls.find((c) => c.method === "POST" && c.path === "/v2/orders")!.body;
    expect(sent).toEqual({
      external_id: String(ORDER_ID),
      shipping: "STANDARD",
      recipient: { name: "Rosa Diaz", address1: "12 Harbor St", address2: "Apt 4", city: "Portland", state_code: "OR", country_code: "US", zip: "97201", email: "buyer@example.com" },
      order_items: [
        {
          source: "catalog",
          catalog_variant_id: 5002,
          quantity: 2,
          external_id: "11",
          placements: [{ placement: "front", technique: "dtg", layers: [{ type: "file", url: `https://files.cultremix.test/${PRINT_KEY}` }] }],
        },
      ],
    });
    // Looked up by external_id before the create.
    expect(printful.calls[0]).toMatchObject({ method: "GET", path: `/v2/orders/@${ORDER_ID}` });

    const order = await theOrder(t);
    expect(order).toMatchObject({ fulfillmentState: "draft", printfulStatus: "draft", printfulStoreId: STORE_ID });
    expect(order.printfulOrderId).toBe([...printful.orders.keys()][0]);
    expect((await items(t, order._id))[0].printfulItemId).toBe(printful.orders.get(order.printfulOrderId!)!.order_items[0].id);
    // PRINTFUL_AUTO_CONFIRM is on, but this isn't production.
    expect(confirms()).toBe(0);
  });

  it("keeps one Printful order across replays, other topics, and reconciliation", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t);
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, webhookId: "replay-1" });
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, webhookId: "replay-1" });
    await deliver(t, { topic: "orders/updated", body: { id: ORDER_ID } });
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(creates()).toBe(1);
    expect(printful.orders.size).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("draft");
  });

  it("finds an order an earlier create already made instead of making another", async () => {
    const t = newTest();
    await onSale(t);
    const existing = printful.add(String(ORDER_ID), [{ external_id: "11", quantity: 1 }]);
    await paid(t);

    expect(creates()).toBe(0);
    const order = await theOrder(t);
    expect(order).toMatchObject({ printfulOrderId: existing.id, fulfillmentState: "draft" });
    expect((await items(t, order._id))[0].printfulItemId).toBe(existing.order_items[0].id);
  });

  it("after an unanswered create only looks the order up, and links it when it shows", async () => {
    const t = newTest();
    await onSale(t);
    printful.setCreateMode("unreachable");
    await paid(t, {}, { now: true });

    let order = await theOrder(t);
    expect(order.fulfillmentState).toBe("creating");
    expect(order.createAmbiguousSince).toBe(Date.now());
    expect(creates()).toBe(1);

    // Printful did make it after all; the next lookups find it.
    printful.setCreateMode("ok");
    await settle(t, MINUTE);
    expect(creates()).toBe(1);
    const made = printful.add(String(ORDER_ID), [{ external_id: "11", quantity: 1 }]);
    await settle(t, MINUTE);

    order = await theOrder(t);
    expect(creates()).toBe(1);
    expect(order).toMatchObject({ printfulOrderId: made.id, fulfillmentState: "draft" });
    expect(order.createAmbiguousSince).toBeUndefined();
  });

  it("an unanswered create that never shows goes to the owner after 15 minutes, without a second create", async () => {
    const t = newTest();
    await onSale(t);
    printful.setCreateMode("unreachable");
    setOrder();
    await postShopifyWebhook(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    await t.finishAllScheduledFunctions(vi.runAllTimers, 400);

    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("needs_attention");
    expect(order.attentionReason).toContain("Check Printful");
    expect(creates()).toBe(1);
    expect(printful.count("GET", /^\/v2\/orders\/@/u)).toBeGreaterThanOrEqual(15);

    // Neither the sweep nor a new Shopify event creates it again.
    printful.setCreateMode("ok");
    await t.action(internal.fulfillment.reconcile, {});
    await deliver(t, { topic: "orders/updated", body: { id: ORDER_ID } });
    expect(creates()).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("needs_attention");
  });

  it("a 5xx after Printful made the order links it on the next lookup", async () => {
    const t = newTest();
    await onSale(t);
    printful.setCreateMode("made-but-unanswered");
    await paid(t);

    expect(creates()).toBe(1);
    expect(printful.orders.size).toBe(1);
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "draft", printfulOrderId: [...printful.orders.keys()][0] });
  });

  it("a refused create goes to the owner and isn't retried by the sweep", async () => {
    const t = newTest();
    await onSale(t);
    printful.setCreateMode("refuse");
    await paid(t);

    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("needs_attention");
    expect(order.attentionReason).toBe("Printful refused the order: Invalid recipient");
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(creates()).toBe(1);
  });

  it("waits, without looping, while Printful isn't configured", async () => {
    vi.stubEnv("PRINTFUL_API_TOKEN", "");
    const t = newTest();
    await onSale(t);
    await paid(t);

    const order = await theOrder(t);
    expect(order).toMatchObject({ fulfillmentState: "waiting", fulfillmentError: "Printful is not configured yet." });
    expect(printful.calls).toHaveLength(0);

    // Keys arrive; the next sweep makes the draft.
    vi.stubEnv("PRINTFUL_API_TOKEN", "pf-token");
    vi.advanceTimersByTime(30 * MINUTE);
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(creates()).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("draft");
  });
});

describe("orders that can't go to Printful automatically", () => {
  it("a work with no print file needs attention and calls nothing", async () => {
    const t = newTest();
    await onSale(t, { printKey: null });
    await paid(t);
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "needs_attention", attentionReason: "CR 101-002 has no print file." });
    expect(printful.calls).toHaveLength(0);
  });

  it("a variant without a Printful catalog ID needs attention", async () => {
    const t = newTest();
    await onSale(t, { printfulBase: null });
    await paid(t);
    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("needs_attention");
    expect(order.attentionReason).toMatch(/^CR 101-002 \S+ \S+ has no Printful variant yet\.$/u);
    expect(creates()).toBe(0);
  });

  it("no shipping address is manual, and the order made by hand is linked by its external ID", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t, { address: false });
    let order = await theOrder(t);
    expect(order.fulfillmentState).toBe("manual_required");
    expect(order.attentionReason).toContain(`external ID ${ORDER_ID}`);
    expect(creates()).toBe(0);

    const byHand = printful.add(String(ORDER_ID), [{ external_id: "11", quantity: 1 }]);
    const response = await printfulWebhook(t, { type: "order_created", data: { order: byHand } });
    expect(response.status).toBe(200);
    order = await theOrder(t);
    expect(order).toMatchObject({ fulfillmentState: "draft", printfulOrderId: byHand.id });
    expect(creates()).toBe(0);
  });

  it("a test order in production is never printed", async () => {
    prod();
    const t = newTest();
    await onSale(t);
    await paid(t, { test: true });
    expect((await theOrder(t)).fulfillmentState).toBe("test_ignored");
    await t.action(internal.fulfillment.reconcile, {});
    expect(printful.calls).toHaveLength(0);
  });

  it("a test order in staging makes a draft, which is never confirmed", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t, { test: true });
    expect(await theOrder(t)).toMatchObject({ simulated: true, fulfillmentState: "draft" });
    expect(confirms()).toBe(0);
  });
});

describe("the hold and confirmation", () => {
  it("production confirms after the 1-hour hold", async () => {
    prod();
    const t = newTest();
    await onSale(t);
    await paid(t, { paidAt: "2026-10-02T00:00:00Z" }, { now: true });

    let order = await theOrder(t);
    expect(order.fulfillmentState).toBe("draft");
    expect(order.holdUntil).toBe(Date.parse("2026-10-02T01:00:00Z"));
    await settle(t, 59 * MINUTE);
    expect(confirms()).toBe(0);

    await settle(t, MINUTE);
    expect(confirms()).toBe(1);
    order = await theOrder(t);
    expect(order).toMatchObject({ fulfillmentState: "submitted", printfulStatus: "pending" });
    expect(order.confirmedAt).toBe(Date.parse("2026-10-02T01:00:00Z"));
  });

  it("production waits for PRINTFUL_AUTO_CONFIRM and the fulfillment.autoConfirm flag", async () => {
    prod();
    vi.stubEnv("PRINTFUL_AUTO_CONFIRM", "");
    const t = newTest();
    await onSale(t);
    await paid(t);
    expect((await theOrder(t)).fulfillmentState).toBe("draft");
    expect(confirms()).toBe(0);

    vi.stubEnv("PRINTFUL_AUTO_CONFIRM", "true");
    await setFlag(t, "fulfillment.autoConfirm", false);
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(confirms()).toBe(0);

    await setFlag(t, "fulfillment.autoConfirm", true);
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(confirms()).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("submitted");
  });

  it("a cancellation during the hold deletes the draft", async () => {
    prod();
    const t = newTest();
    await onSale(t);
    await paid(t, { paidAt: "2026-10-02T00:00:00Z" }, { now: true });
    const printfulOrderId = (await theOrder(t)).printfulOrderId!;

    await settle(t, 20 * MINUTE);
    setOrder({ paidAt: "2026-10-02T00:00:00Z", cancelledAt: "2026-10-02T00:20:00Z", updatedAt: "2026-10-02T00:20:00Z" });
    await postShopifyWebhook(t, { topic: "orders/cancelled", body: { id: ORDER_ID } });
    await settle(t);

    expect(printful.count("DELETE", new RegExp(`^/v2/orders/${printfulOrderId}$`, "u"))).toBe(1);
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "canceled", printfulStatus: "deleted" });
    await settle(t, 2 * HOUR);
    expect(confirms()).toBe(0);
  });

  it("a cancellation after confirmation goes to the owner", async () => {
    prod();
    const t = newTest();
    await onSale(t);
    await paid(t);
    expect((await theOrder(t)).fulfillmentState).toBe("submitted");

    setOrder({ cancelledAt: "2026-10-02T03:00:00Z", updatedAt: "2026-10-02T03:00:00Z" });
    await deliver(t, { topic: "orders/cancelled", body: { id: ORDER_ID } });
    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("needs_attention");
    expect(order.attentionReason).toContain("Cancelled in Shopify after Printful confirmed it");
    expect(printful.count("DELETE", /.*/u)).toBe(0);
  });
});

describe("refunds on a draft", () => {
  it("a partial refund lowers the Printful quantity once; a full refund deletes the draft", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t, { lines: [line(3)] });
    const order = await theOrder(t);
    const itemId = (await items(t, order._id))[0].printfulItemId!;

    const one: FixtureRefund = { id: 900, lines: [{ lineItem: 11, quantity: 1, subtotal: "36.00" }], total: "36.00" };
    setOrder({ lines: [line(3)], refunds: [one], updatedAt: "2026-10-02T01:00:00Z" });
    await deliver(t, { topic: "refunds/create", body: { id: 900, order_id: ORDER_ID } });
    await deliver(t, { topic: "refunds/create", body: { id: 900, order_id: ORDER_ID } });

    const patches = printful.calls.filter((c) => c.method === "PATCH");
    expect(patches).toEqual([{ method: "PATCH", path: `/v2/orders/${order.printfulOrderId}/order-items/${itemId}`, body: { quantity: 2 } }]);
    expect((await t.run((ctx) => ctx.db.query("refunds").collect()))[0].appliedAt).toBeDefined();
    expect((await theOrder(t)).fulfillmentState).toBe("draft");

    const rest: FixtureRefund = { id: 901, createdAt: "2026-10-02T13:00:00Z", lines: [{ lineItem: 11, quantity: 2, subtotal: "72.00" }], total: "72.00" };
    setOrder({ lines: [line(3)], refunds: [one, rest], updatedAt: "2026-10-02T02:00:00Z" });
    await deliver(t, { topic: "refunds/create", body: { id: 901, order_id: ORDER_ID } });
    expect(printful.count("DELETE", new RegExp(`^/v2/orders/${order.printfulOrderId}$`, "u"))).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("canceled");
  });

  it("a refund after confirmation goes to the owner", async () => {
    prod();
    const t = newTest();
    await onSale(t);
    await paid(t, { lines: [line(2)] });
    expect((await theOrder(t)).fulfillmentState).toBe("submitted");

    setOrder({ lines: [line(2)], refunds: [{ id: 900, lines: [{ lineItem: 11, quantity: 1, subtotal: "36.00" }], total: "36.00" }], updatedAt: "2026-10-02T03:00:00Z" });
    await deliver(t, { topic: "refunds/create", body: { id: 900, order_id: ORDER_ID } });
    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("needs_attention");
    expect(order.attentionReason).toContain("Refunded after Printful confirmed it");
    expect(printful.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

describe("POST /webhooks/printful", () => {
  async function drafted(t: T) {
    const { b } = await onSale(t);
    await paid(t, { lines: [line(2)] });
    const order = await theOrder(t);
    return { b, order, pf: printful.orders.get(order.printfulOrderId!)! };
  }

  it("refuses a bad or missing signature and writes nothing", async () => {
    const t = newTest();
    const { pf } = await drafted(t);
    const payload = { type: "order_updated", data: { order: { ...pf, status: "pending" } } };
    expect((await printfulWebhook(t, payload, { signature: null })).status).toBe(401);
    expect((await printfulWebhook(t, payload, { signature: "00".repeat(32) })).status).toBe(401);
    expect((await printfulWebhook(t, payload, { signature: "not-hex" })).status).toBe(401);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").withIndex("by_source_key", (q) => q.eq("source", "printful")).collect());
    expect(events).toHaveLength(0);
    expect((await theOrder(t)).fulfillmentState).toBe("draft");
  });

  it("answers 503 before the webhook secret is set, and 400 for a malformed body", async () => {
    const t = newTest();
    expect((await printfulWebhook(t, { type: "order_updated" }, { raw: "{not json" })).status).toBe(400);
    expect((await printfulWebhook(t, {}, { raw: JSON.stringify({ data: {} }) })).status).toBe(400);
    vi.stubEnv("PRINTFUL_WEBHOOK_SECRET", "");
    expect((await printfulWebhook(t, { type: "order_updated" }, { signature: "00" })).status).toBe(503);
  });

  it("ignores another store's events", async () => {
    const t = newTest();
    const { pf } = await drafted(t);
    const response = await printfulWebhook(t, { type: "order_updated", store_id: 999, data: { order: { ...pf, status: "fulfilled" } } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Ignored");
    expect((await theOrder(t)).fulfillmentState).toBe("draft");
  });

  it("applies an event once, even when Printful retries it", async () => {
    const t = newTest();
    const { pf } = await drafted(t);
    const body = { type: "order_updated", store_id: Number(STORE_ID), occurred_at: "2026-10-02T05:00:00Z", data: { order: { ...pf, status: "inprocess" } } };
    expect(await (await printfulWebhook(t, {}, { raw: JSON.stringify({ ...body, retries: 0 }) })).text()).toBe("OK");
    expect(await (await printfulWebhook(t, {}, { raw: JSON.stringify({ retries: 2, ...body }) })).text()).toBe("Duplicate");
    expect((await theOrder(t)).fulfillmentState).toBe("in_production");
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").withIndex("by_source_key", (q) => q.eq("source", "printful")).collect());
    expect(events).toHaveLength(1);
  });

  it("ignores events that arrive out of order or move backwards", async () => {
    const t = newTest();
    const { pf } = await drafted(t);
    const at = (iso: string, status: string) => ({
      type: "order_updated",
      occurred_at: iso,
      data: { order: { ...pf, status } },
    });
    await printfulWebhook(t, at("2026-10-02T06:00:00Z", "inprocess"));
    // Older than the last applied status.
    await printfulWebhook(t, at("2026-10-02T05:00:00Z", "pending"));
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "in_production", printfulStatus: "inprocess" });
    // Newer, but backwards.
    await printfulWebhook(t, at("2026-10-02T07:00:00Z", "draft"));
    expect((await theOrder(t)).fulfillmentState).toBe("in_production");
    // A failure always reaches the owner, with Printful's reason.
    await printfulWebhook(t, { type: "order_failed", occurred_at: "2026-10-02T08:00:00Z", data: { order: { ...pf, status: "failed" }, reason: "Print file too small" } });
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "needs_attention", attentionReason: "Printful couldn't make this order: Print file too small" });
  });

  it("records a shipment once and starts its earnings maturing", async () => {
    const t = newTest();
    const { b, pf } = await drafted(t);
    const shippedAt = "2026-10-04T12:00:00Z";
    const shipment = {
      id: 31,
      carrier: "USPS",
      tracking_number: "9400",
      tracking_url: "https://track.example/9400",
      shipped_at: shippedAt,
      shipment_items: [{ order_item_id: pf.order_items[0].id, quantity: 1 }],
    };
    const event = { type: "shipment_sent", occurred_at: shippedAt, data: { order: { ...pf, status: "partial" }, shipment } };
    expect((await printfulWebhook(t, event)).status).toBe(200);
    // The same shipment again, as a different delivery.
    await printfulWebhook(t, { ...event, occurred_at: "2026-10-04T12:05:00Z" });

    const order = await theOrder(t);
    expect(order.fulfillmentState).toBe("partial");
    const shipments = await t.run((ctx) => ctx.db.query("orderShipments").collect());
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({ printfulShipmentId: "31", shippedAt: Date.parse(shippedAt), trackingNumber: "9400" });
    expect(shipments[0].lines).toEqual([{ orderItemId: (await items(t, order._id))[0]._id, fromUnit: 1, toUnit: 1 }]);

    const sales = await t.run((ctx) =>
      ctx.db.query("earnings").withIndex("by_recipient_created", (q) => q.eq("recipientId", b)).collect(),
    );
    expect(sales.find((r) => r.unit === 1)!.maturesAt).toBe(Date.parse(shippedAt) + 30 * DAY);
    expect(sales.find((r) => r.unit === 2)!.maturesAt).toBeUndefined();
  });

  it("ignores events for orders it doesn't know", async () => {
    const t = newTest();
    const response = await printfulWebhook(t, { type: "order_updated", data: { order: { id: 4242, external_id: "999", status: "pending" } } });
    expect(await response.text()).toBe("Ignored");
  });
});

describe("reconciliation", () => {
  it("polls Printful for a status and shipments a webhook missed", async () => {
    const t = newTest();
    const { b } = await onSale(t);
    await paid(t);
    const order = await theOrder(t);
    const pf = printful.orders.get(order.printfulOrderId!)!;
    pf.status = "fulfilled";
    printful.shipments.set(pf.id, [
      { id: 41, status: "shipped", shipped_at: "2026-10-05T00:00:00Z", shipment_items: [{ order_item_id: pf.order_items[0].id, quantity: 1 }] },
      { id: 42, status: "pending", shipment_items: [] },
    ]);

    const result = await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(result.polled).toBe(1);
    expect((await theOrder(t)).fulfillmentState).toBe("shipped");
    const shipments = await t.run((ctx) => ctx.db.query("orderShipments").collect());
    expect(shipments.map((s) => s.printfulShipmentId)).toEqual(["41"]);
    const sales = await t.run((ctx) => ctx.db.query("earnings").withIndex("by_recipient_created", (q) => q.eq("recipientId", b)).collect());
    expect(sales[0].maturesAt).toBe(Date.parse("2026-10-05T00:00:00Z") + 30 * DAY);

    // Polling again records nothing new.
    await t.action(internal.fulfillment.reconcile, {});
    expect(await t.run((ctx) => ctx.db.query("orderShipments").collect())).toHaveLength(1);
  });

  it("flags an order Printful no longer has", async () => {
    const t = newTest();
    await onSale(t);
    await paid(t);
    printful.orders.clear();
    await t.action(internal.fulfillment.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await theOrder(t)).toMatchObject({ fulfillmentState: "needs_attention", attentionReason: "Printful no longer has this order." });
  });
});
