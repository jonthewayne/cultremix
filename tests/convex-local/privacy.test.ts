import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { SHOP_ENV, makeUser, makeWork, postShopifyWebhook } from "./shopFixtures";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.useFakeTimers();
  for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const OWNER = { subject: "test|owner", issuer: "test" };
const DAY = 24 * 60 * 60 * 1000;
const RECIPIENT = { name: "Rosa Diaz", address1: "12 Harbor St", city: "Portland", stateCode: "OR", countryCode: "US", zip: "97201", email: "rosa@example.com" };

async function order(
  t: T,
  shopifyOrderId: string,
  fields: { printfulOrderId?: number; fulfillmentState?: "waiting" | "draft" | "shipped"; updatedAt?: number; workId?: Id<"works"> } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("orders", {
      shopifyOrderId,
      orderName: `#${shopifyOrderId.slice(-4)}`,
      shopDomain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN,
      isTest: false,
      simulated: false,
      financialState: "PAID",
      cancelled: false,
      currency: "USD",
      totalCents: 3600,
      recipient: RECIPIENT,
      fulfillmentState: fields.fulfillmentState ?? "waiting",
      ...(fields.printfulOrderId ? { printfulOrderId: fields.printfulOrderId } : {}),
      createdAt: now,
      updatedAt: fields.updatedAt ?? now,
    });
    await ctx.db.insert("orderItems", {
      orderId: id,
      shopifyLineItemId: "11",
      ...(fields.workId ? { workId: fields.workId } : {}),
      quantity: 1,
      unitPriceCents: 3600,
      discountCents: 0,
      configVersion: 1,
      recipients: [],
      baseCents: 3600,
      poolCents: 540,
      unitPoolCents: [540],
      createdAt: now,
    });
    // The raw body Shopify sent for it.
    await ctx.db.insert("webhookPayloads", { source: "shopify", eventKey: `wh-${shopifyOrderId}`, body: "{}", expiresAt: now + 30 * DAY });
    await ctx.db.insert("shopifyInbox", {
      shopifyOrderId,
      events: [{ topic: "orders/paid", webhookId: `wh-${shopifyOrderId}`, receivedAt: now, payloadKey: `wh-${shopifyOrderId}` }],
      hydration: "complete",
      attempts: 0,
      orderId: id,
      updatedAt: now,
    });
    return id;
  });
}

const getOrder = (t: T, id: Id<"orders">) => t.run((ctx) => ctx.db.get("orders", id));
const payloads = (t: T) => t.run((ctx) => ctx.db.query("webhookPayloads").collect());

describe("Shopify privacy webhooks", () => {
  it("records a data request once and shows the owner what CultRemix holds", async () => {
    const t = newTest();
    await t.run((ctx) => ctx.db.insert("users", { name: "Owner", authId: OWNER.subject, platformRole: "super_admin_owner" }));
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    await order(t, "5001", { workId });
    const body = { shop_id: 1, shop_domain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN, customer: { id: 191167, email: "rosa@example.com" }, orders_requested: [5001, 9999], data_request: { id: 9 } };
    const first = await postShopifyWebhook(t, { topic: "customers/data_request", body, webhookId: "priv-1" });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("OK");
    expect(await (await postShopifyWebhook(t, { topic: "customers/data_request", body, webhookId: "priv-1" })).text()).toBe("Duplicate");

    const [request] = await t.withIdentity(OWNER).query(api.privacy.requests, {});
    expect(request).toMatchObject({ topic: "customers/data_request", status: "open", customerId: "191167" });
    expect(request.held).toEqual([
      {
        shopifyOrderId: "5001",
        name: "#5001",
        createdAt: expect.any(Number),
        recipient: { name: "Rosa Diaz", address: "12 Harbor St, Portland, OR, 97201, US", email: "rosa@example.com" },
        redacted: false,
        lines: [{ cr: "101-001", quantity: 1, unitPriceCents: 3600 }],
      },
    ]);
    // The customer's email isn't stored with the request.
    const stored = await t.run((ctx) => ctx.db.query("privacyRequests").first());
    expect(JSON.stringify(stored)).not.toContain("rosa@example.com");

    await t.withIdentity(OWNER).mutation(api.privacy.markDone, { id: request.id });
    expect((await t.withIdentity(OWNER).query(api.privacy.requests, {}))[0].status).toBe("done");
    await expect(t.query(api.privacy.requests, {})).rejects.toThrow(/Owner only/u);
  });

  it("removes a customer's data from orders Printful has, and waits for one it doesn't have yet", async () => {
    const t = newTest();
    const sent = await order(t, "6001", { printfulOrderId: 77, fulfillmentState: "draft" });
    const waiting = await order(t, "6002");
    const response = await postShopifyWebhook(t, {
      topic: "customers/redact",
      body: { shop_id: 1, shop_domain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN, customer: { id: 5 }, orders_to_redact: [6001, 6002] },
    });
    expect(response.status).toBe(200);
    expect(await getOrder(t, sent)).toMatchObject({ redactedAt: expect.any(Number) });
    expect((await getOrder(t, sent))?.recipient).toBeUndefined();
    expect((await payloads(t)).map((row) => row.eventKey)).toEqual(["wh-6002"]);
    // Printful still needs this one's address.
    expect(await getOrder(t, waiting)).toMatchObject({ recipient: RECIPIENT, redactRequestedAt: expect.any(Number) });

    await t.run((ctx) => ctx.db.patch("orders", waiting, { printfulOrderId: 78, fulfillmentState: "draft" }));
    expect(await t.mutation(internal.privacy.sweep, {})).toBe(1);
    expect((await getOrder(t, waiting))?.recipient).toBeUndefined();
    expect(await payloads(t)).toEqual([]);
  });

  it("removes an address 30 days after the order shipped", async () => {
    const t = newTest();
    const old = await order(t, "7001", { printfulOrderId: 1, fulfillmentState: "shipped", updatedAt: Date.now() - 31 * DAY });
    const recent = await order(t, "7002", { printfulOrderId: 2, fulfillmentState: "shipped", updatedAt: Date.now() - 2 * DAY });
    expect(await t.mutation(internal.privacy.sweep, {})).toBe(1);
    expect((await getOrder(t, old))?.recipient).toBeUndefined();
    expect((await getOrder(t, recent))?.recipient).toEqual(RECIPIENT);
  });

  it("removes every order's data when the store asks", async () => {
    const t = newTest();
    const a = await order(t, "8001");
    const b = await order(t, "8002", { printfulOrderId: 3, fulfillmentState: "draft" });
    await postShopifyWebhook(t, { topic: "shop/redact", body: { shop_id: 1, shop_domain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await getOrder(t, a))?.recipient).toBeUndefined();
    expect((await getOrder(t, b))?.recipient).toBeUndefined();
    expect(await payloads(t)).toEqual([]);
  });

  it("refuses an unsigned privacy webhook", async () => {
    const t = newTest();
    const response = await postShopifyWebhook(t, { topic: "customers/redact", body: { orders_to_redact: [1] }, signature: "nope" });
    expect(response.status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("privacyRequests").collect())).toEqual([]);
  });
});

