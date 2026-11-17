import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { PRINT_PRODUCT } from "../../shared/config/print-products";
import { rawOrder } from "../fixtures/shopifyOrder";
import { newTest } from "./setup";
import { SHOP_ENV, deliver, fakeShopify, makeOnSale, makeUser, makeWork } from "./shopFixtures";
import type { Id } from "../../convex/_generated/dataModel";

// Costs first, end to end (economics v6, docs/decisions.md): a sale saves what it recovered and
// shares only what's left; a sale below cost, or without a saved cost, shares nothing and staff hear.
type T = ReturnType<typeof newTest>;
vi.setConfig({ testTimeout: 30_000 });

let shopify: ReturnType<typeof fakeShopify>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));
  for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("DEPLOYMENT_ENV", "staging");
  vi.stubEnv("ECONOMICS_VERSION", "6");
  shopify = fakeShopify();
  vi.stubGlobal("fetch", shopify.fetchFake);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(t: T, costCents: number | null) {
  const owner = await makeUser(t, { name: "Owner", platformRole: "super_admin_owner" });
  const a = await makeUser(t, { name: "A", creatorNumber: 2 });
  const work = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
  await makeOnSale(t, work, "101-001", 1000, 5000);
  if (costCents !== null) {
    await t.run((ctx) =>
      ctx.db.insert("merchProducts", {
        provider: "printful",
        productId: PRINT_PRODUCT.printful.productId,
        name: PRINT_PRODUCT.name,
        colors: [
          {
            key: "white",
            name: "White",
            hex: "#ffffff",
            variants: Array.from({ length: 60 }, (_, i) => ({ size: "M", id: 5000 + i, costCents })),
            inStock: true,
            offered: false,
          },
        ],
        active: false,
        offered: false,
        fetchedAt: 0,
      }),
    );
  }
  return { owner, a };
}

async function earningsFor(t: T, who: Id<"users">) {
  return await t.run((ctx) => ctx.db.query("earnings").withIndex("by_recipient_created", (q) => q.eq("recipientId", who)).collect());
}

describe("costs before sharing", () => {
  it("saves what a sale recovered and shares only what's left", async () => {
    const t = newTest();
    const { a } = await setup(t, 1295);
    shopify.set(rawOrder({ id: 7001, lines: [{ id: 11, variant: 1002, quantity: 1, price: "36.00" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: 7001 } });
    const item = await t.run(async (ctx) => (await ctx.db.query("orderItems").collect())[0]);
    // Total paid $36.00 (the fixture has no shipping line): fee 104 + 30; flat shipping covers Printful's.
    expect(item.configVersion).toBe(6);
    expect(item.costs).toEqual({ productionCents: 1295, feeCents: 134, shippingCents: 0, allowanceCents: 100, distributableCents: 2071, belowCost: false, known: true });
    // 15% of $20.71, not of $36.
    expect(item.poolCents).toBe(310);
    expect((await earningsFor(t, a)).map((r) => r.amountCents)).toEqual([310]);
  });

  it("shares nothing when a discount takes a sale below cost, and holds it from printing", async () => {
    const t = newTest();
    const { a } = await setup(t, 1295);
    shopify.set(rawOrder({ id: 7002, name: "#2002", lines: [{ id: 12, variant: 1002, quantity: 1, price: "36.00", discount: "24.00" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: 7002 } });
    const item = await t.run(async (ctx) => (await ctx.db.query("orderItems").collect())[0]);
    expect(item.costs).toMatchObject({ distributableCents: 0, belowCost: true });
    expect(item.poolCents).toBe(0);
    expect(await earningsFor(t, a)).toHaveLength(0);
    // Printing waits for the owner (convex/fulfillment.ts createPlan).
    const order = await t.run(async (ctx) => (await ctx.db.query("orders").collect())[0]);
    await t.mutation(internal.fulfillment.advance, { orderId: order._id });
    const held = await t.run((ctx) => ctx.db.get("orders", order._id));
    expect(held).toMatchObject({ fulfillmentState: "needs_attention", attentionReason: expect.stringMatching(/less than it costs/u) });
  });

  it("shares nothing until a product's cost is saved", async () => {
    const t = newTest();
    const { a } = await setup(t, null);
    shopify.set(rawOrder({ id: 7003, lines: [{ id: 13, variant: 1002, quantity: 1, price: "36.00" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: 7003 } });
    const item = await t.run(async (ctx) => (await ctx.db.query("orderItems").collect())[0]);
    expect(item.costs).toMatchObject({ known: false, distributableCents: 0 });
    expect(await earningsFor(t, a)).toHaveLength(0);
  });

  it("refuses a product price that can't cover what a sale costs", async () => {
    const t = newTest();
    const { owner } = await setup(t, 1295);
    await t.run((ctx) => ctx.db.patch("users", owner, { authId: "auth-owner" }));
    const productId = await t.run(async (ctx) => (await ctx.db.query("merchProducts").first())!._id);
    const admin = t.withIdentity({ subject: "auth-owner", issuer: "test" });
    await expect(admin.mutation(api.merch.adminSetSale, { productId, priceCents: 1400, largePriceCents: 2600 })).rejects.toThrow(/at least \$/u);
    await admin.mutation(api.merch.adminSetSale, { productId, priceCents: 2400, largePriceCents: 2600 });
  });
});
