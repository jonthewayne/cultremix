import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";
import { SHOP_ENV } from "./shopFixtures";

type T = ReturnType<typeof newTest>;

const OWNER = { subject: "test|owner", issuer: "test" };
const SITE = "https://vibrant-rook-798.convex.site";
const KEY = "5f".repeat(32);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function owner(t: T) {
  await t.run((ctx) => ctx.db.insert("users", { name: "Owner", authId: OWNER.subject, platformRole: "super_admin_owner" }));
  return t.withIdentity(OWNER);
}

function fakePrintful() {
  const calls: Array<{ method: string; path: string; body: unknown; store: string | null }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, store: new Headers(init?.headers).get("X-PF-Store-Id") });
    if (url.pathname === "/v2/stores/777") return Response.json({ data: { id: 777, name: "CultRemix dev", type: "api" } });
    if (url.pathname === "/v2/webhooks") return Response.json({ data: { default_url: body.default_url, events: body.events, secret_key: KEY, public_key: "pk" } });
    if (url.pathname === "/mockup-generator/printfiles/146") {
      return Response.json({
        code: 200,
        result: {
          product_id: 146,
          available_placements: { front: "Front print", back: "Back print" },
          printfiles: [
            { printfile_id: 1, width: 1650, height: 1650, dpi: 150 },
            { printfile_id: 2, width: 2100, height: 2100, dpi: 150 },
            { printfile_id: 3, width: 1800, height: 2400, dpi: 150 },
          ],
          variant_printfiles: [
            { variant_id: 10, placements: { front: 1, back: 3 } },
            { variant_id: 11, placements: { front: 2, back: 3 } },
          ],
        },
      });
    }
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  });
  return calls;
}

describe("Connect Printful", () => {
  it("checks the store, sets every webhook to this deployment, and keeps the signing key for the route", async () => {
    const t = newTest();
    vi.stubEnv("PRINTFUL_API_TOKEN", "token");
    vi.stubEnv("PRINTFUL_STORE_ID", "777");
    vi.stubEnv("PRINTFUL_WEBHOOK_SECRET", "");
    const admin = await owner(t);
    const calls = fakePrintful();
    expect((await admin.query(api.integrations.status, {})).printful).toEqual({ configured: true, signingKey: "none" });

    expect(await admin.action(api.integrations.connectPrintful, {})).toEqual({ store: "CultRemix dev", url: `${SITE}/webhooks/printful`, events: 7 });
    const setup = calls.find((call) => call.path === "/v2/webhooks")!;
    expect(setup.store).toBe("777");
    expect(setup.body).toMatchObject({ default_url: `${SITE}/webhooks/printful` });
    expect((setup.body as { events: Array<unknown> }).events).toHaveLength(7);
    const status = await admin.query(api.integrations.status, {});
    expect(status.printful).toMatchObject({ configured: true, signingKey: "stored", note: `CultRemix dev: 7 webhooks to ${SITE}/webhooks/printful.` });
    // The key never leaves the server.
    expect(JSON.stringify(status)).not.toContain(KEY);

    // The webhook route now checks signatures with the stored key.
    const body = JSON.stringify({ type: "order_updated", store_id: 777, occurred_at: new Date().toISOString(), retries: 0, data: { order: { id: 1, external_id: "x", status: "draft" } } });
    const signed = await t.fetch("/webhooks/printful", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pf-webhook-signature": createHmac("sha256", Buffer.from(KEY, "hex")).update(body).digest("hex") },
      body,
    });
    expect(signed.status).toBe(200);
    const forged = await t.fetch("/webhooks/printful", { method: "POST", headers: { "content-type": "application/json", "x-pf-webhook-signature": "00" }, body });
    expect(forged.status).toBe(401);
  });

  it("says what's missing without Printful's keys, and is for admins only", async () => {
    const t = newTest();
    const admin = await owner(t);
    await expect(admin.action(api.integrations.connectPrintful, {})).rejects.toThrow(/PRINTFUL_API_TOKEN/u);
    await expect(t.action(api.integrations.connectPrintful, {})).rejects.toThrow();
  });
});

describe("Check with Printful", () => {
  it("sets a product's print areas from its largest print files", async () => {
    const t = newTest();
    vi.stubEnv("PRINTFUL_API_TOKEN", "token");
    vi.stubEnv("PRINTFUL_STORE_ID", "777");
    const admin = await owner(t);
    fakePrintful();
    const productId: Id<"merchProducts"> = await t.run((ctx) =>
      ctx.db.insert("merchProducts", {
        provider: "printful",
        productId: 146,
        name: "Unisex Heavy Blend Hoodie | Gildan 18500",
        colors: [],
        active: false,
        placements: [
          { id: "front", extraCents: 0 },
          { id: "back", extraCents: 595 },
        ],
        fetchedAt: 0,
      }),
    );
    expect(await admin.action(api.merch.adminCheckAreas, { productId })).toEqual({
      front: { widthIn: 14, heightIn: 14 },
      back: { widthIn: 12, heightIn: 16 },
    });
    const product = await t.run((ctx) => ctx.db.get("merchProducts", productId));
    expect(product).toMatchObject({
      frontArea: { widthIn: 14, heightIn: 14 },
      backArea: { widthIn: 12, heightIn: 16 },
      placements: [
        { id: "front", extraCents: 0 },
        { id: "back", extraCents: 595 },
      ],
      areasCheckedAt: expect.any(Number),
    });
    // Typing other areas in by hand means they're no longer Printful's.
    await admin.mutation(api.merch.adminSetSale, { productId, frontArea: { widthIn: 13, heightIn: 13 }, backArea: { widthIn: 12, heightIn: 16 } });
    expect((await t.run((ctx) => ctx.db.get("merchProducts", productId)))?.areasCheckedAt).toBeUndefined();
  });
});

describe("Connect Shopify", () => {
  it("checks the store and subscribes the order webhooks it doesn't have", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const admin = await owner(t);
    const created: Array<{ topic: string; uri: string; format: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "tok", expires_in: 86399 });
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: { topic: string; webhookSubscription: { uri: string; format: string } } };
      if (query.includes("CultRemixShopCheck")) {
        return Response.json({
          data: {
            shop: { name: "CultRemix Dev", myshopifyDomain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN },
            publications: { nodes: [{ id: "p1", name: "Online Store" }, { id: "p2", name: "Headless" }] },
            webhookSubscriptions: { nodes: [{ id: "w1", topic: "ORDERS_PAID", uri: `${SITE}/webhooks/shopify` }] },
          },
        });
      }
      created.push({ topic: variables.topic, ...variables.webhookSubscription });
      return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "w2", topic: variables.topic, uri: variables.webhookSubscription.uri }, userErrors: [] } } });
    });
    expect(await admin.action(api.integrations.connectShopify, {})).toEqual({
      shop: "CultRemix Dev",
      headless: true,
      created: ["ORDERS_CANCELLED", "REFUNDS_CREATE", "DISPUTES_CREATE", "DISPUTES_UPDATE"],
      existing: ["ORDERS_PAID"],
    });
    expect(created).toEqual(
      ["ORDERS_CANCELLED", "REFUNDS_CREATE", "DISPUTES_CREATE", "DISPUTES_UPDATE"].map((topic) => ({
        topic,
        uri: `${SITE}/webhooks/shopify`,
        format: "JSON",
      })),
    );
    expect((await admin.query(api.integrations.status, {})).shopify).toMatchObject({ configured: true, connectedAt: expect.any(Number) });
  });

  it("still connects when Shopify refuses the dispute webhooks, and says which scope is missing", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const admin = await owner(t);
    const asked: Array<string> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "tok", expires_in: 86399 });
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: { topic: string } };
      if (query.includes("CultRemixShopCheck")) {
        return Response.json({
          data: {
            shop: { name: "CultRemix Dev", myshopifyDomain: SHOP_ENV.SHOPIFY_SHOP_DOMAIN },
            publications: { nodes: [{ id: "p2", name: "Headless" }] },
            webhookSubscriptions: { nodes: [] },
          },
        });
      }
      asked.push(variables.topic);
      if (variables.topic.startsWith("DISPUTES_")) {
        return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ message: "Access denied for topic" }] } } });
      }
      return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "w", topic: variables.topic }, userErrors: [] } } });
    });
    const result = await admin.action(api.integrations.connectShopify, {});
    expect(result.created).toEqual(["ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"]);
    expect(result.disputesWarning).toBe(
      "Shopify refused the dispute webhooks (Access denied for topic). Give the app the read_shopify_payments_disputes scope, then connect again, so a chargeback holds its creators' earnings.",
    );
    // It stops asking after the first refusal.
    expect(asked).toEqual(["ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE", "DISPUTES_CREATE"]);
    expect((await admin.query(api.integrations.status, {})).shopify).toMatchObject({ connectedAt: expect.any(Number) });
  });
});

