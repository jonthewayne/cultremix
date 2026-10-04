import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { addToCart, type CartContext } from "../../src/server/cart";
import { createStorefront } from "../../src/server/storefront";
import { SHOP_ENV, makeOnSale, makeUser, makeWork, setFlag } from "./shopFixtures";

function fakeShopify() {
  const queries: Array<string> = [];
  const productSets: Array<Array<string>> = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/admin/oauth/access_token")) {
      return Response.json({ access_token: "tok", expires_in: 86399 });
    }
    const { query, variables } = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: { input?: { variants?: Array<{ inventoryItem: { sku: string } }> } };
    };
    queries.push(query);
    if (query.includes("productSet")) {
      // Shopify answers with the variants it was given.
      const skus = (variables?.input?.variants ?? []).map((v) => v.inventoryItem.sku);
      productSets.push(skus);
      return Response.json({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/77",
              handle: "cr-101-001",
              variants: {
                nodes: skus.map((sku, i) => ({
                  id: `gid://shopify/ProductVariant/${700 + i}`,
                  sku,
                  selectedOptions: [],
                })),
              },
            },
            userErrors: [],
          },
        },
      });
    }
    if (query.includes("publications")) {
      return Response.json({ data: { publications: { nodes: [{ id: "gid://shopify/Publication/3", name: "Headless" }] } } });
    }
    return Response.json({ data: { publishablePublish: { userErrors: [] } } });
  });
  return { fetchFake, queries, productSets };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Shopify product sync", () => {
  it("does nothing on publish while checkout is off", async () => {
    const t = newTest();
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    expect(await t.mutation(internal.shopify.onPublished, { workId })).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("shopProducts").collect());
    expect(rows).toHaveLength(0);
  });

  it("puts a published work on sale and records every variant", async () => {
    const t = newTest();
    vi.useFakeTimers();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, queries } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, title: "Night Swim" });

    expect(await t.mutation(internal.shopify.onPublished, { workId })).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    expect(queries.some((q) => q.includes("productSet"))).toBe(true);
    const product = await t.run((ctx) =>
      ctx.db.query("shopProducts").withIndex("by_work", (q) => q.eq("workId", workId)).unique(),
    );
    expect(product).toMatchObject({ status: "live", handle: "cr-101-001", shopifyProductId: "gid://shopify/Product/77" });
    const variants = await t.run((ctx) =>
      ctx.db.query("workVariants").withIndex("by_work", (q) => q.eq("workId", workId)).collect(),
    );
    expect(variants).toHaveLength(20);
    const black2xl = variants.find((v) => v.sku === "CR-101-001-BLACK-2XL");
    expect(black2xl?.priceCents).toBe(3900);
    const token = await t.run((ctx) => ctx.db.query("shopifyTokens").collect());
    expect(token[0].accessToken).toBe("tok");

    const offer = await t.query(api.shopify.offer, { cr: "101-001" });
    // No offered colors: the launch colors.
    expect(offer?.colors.map((c) => c.key)).toEqual(["white", "ivory", "pepper", "black"]);
    expect(offer?.variants).toHaveLength(20);
    expect(offer?.sizes).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(JSON.stringify(offer)).not.toMatch(/printful|token/iu);
  });

  it("sells only the colors the creator offered, lead first", async () => {
    const t = newTest();
    vi.useFakeTimers();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, productSets } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    // Chalky mint isn't in the print catalog, so it is shown on the page but not sold.
    const workId = await makeWork(t, {
      creatorId: creator,
      family: 101,
      expression: 1,
      offeredColors: ["true-navy", "chalky-mint", "black"],
    });

    await t.mutation(internal.shopify.onPublished, { workId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    expect(productSets).toHaveLength(1);
    expect(productSets[0]).toHaveLength(10);
    expect(productSets[0][0]).toBe("CR-101-001-TRUENAVY-S");
    expect(productSets[0].every((sku) => /-(TRUENAVY|BLACK)-/u.test(sku))).toBe(true);
    const variants = await t.run((ctx) =>
      ctx.db.query("workVariants").withIndex("by_work", (q) => q.eq("workId", workId)).collect(),
    );
    expect(new Set(variants.map((v) => v.color))).toEqual(new Set(["TRUENAVY", "BLACK"]));
    expect(variants.find((v) => v.sku === "CR-101-001-TRUENAVY-M")?.printfulVariantId).toBe(15182);

    const offer = await t.query(api.shopify.offer, { cr: "101-001" });
    expect(offer?.colors).toEqual([
      { key: "true-navy", code: "TRUENAVY", name: "True navy", hex: "#2c3447" },
      { key: "black", code: "BLACK", name: "Black", hex: "#1f1f1f" },
    ]);
    expect(offer?.variants).toHaveLength(10);
  });

  it("doesn't put a work on sale when none of its colors can be printed", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, productSets } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, offeredColors: ["moss", "bay"] });
    await t.run((ctx) =>
      ctx.db.insert("shopProducts", { workId, handle: "cr-101-001", status: "pending", attempts: 0, updatedAt: 0 }),
    );
    expect(await t.action(internal.shopify.syncWork, { workId })).toBe("failed");
    expect(productSets).toHaveLength(0);
    const product = await t.run((ctx) => ctx.db.query("shopProducts").first());
    expect(product).toMatchObject({ status: "failed", lastError: "None of this design's colors can be printed yet." });
    expect(await t.run((ctx) => ctx.db.query("workVariants").collect())).toHaveLength(0);
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
  });

  it("offers only the work's colors even when older variant rows remain", async () => {
    const t = newTest();
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, offeredColors: ["black"] });
    await makeOnSale(t, workId, "101-001");
    // A row kept from an earlier sync, so old orders still resolve. It isn't for sale.
    await t.run((ctx) =>
      ctx.db.insert("workVariants", {
        workId,
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        sku: "CR-101-001-WHITE-M",
        color: "WHITE",
        size: "M",
        priceCents: 3600,
      }),
    );
    const offer = await t.query(api.shopify.offer, { cr: "101-001" });
    expect(offer?.colors.map((c) => c.key)).toEqual(["black"]);
    expect(offer?.variants).toHaveLength(5);
    expect(offer?.variants.every((v) => v.color === "BLACK")).toBe(true);
  });

  it("refuses at checkout a color the work isn't offered in", async () => {
    const t = newTest();
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, offeredColors: ["black"] });
    await makeOnSale(t, workId, "101-001");
    const shopifyCalls: Array<string> = [];
    const ctx: CartContext = {
      cookieHeader: null,
      buyerIp: null,
      secure: true,
      storefront: createStorefront({
        config: { shopDomain: "cultremix-dev.myshopify.com", privateToken: "private" },
        fetch: async (_input, init) => {
          shopifyCalls.push(String(init?.body));
          return new Response("down", { status: 503 });
        },
      }),
      lookupOffer: (cr) => t.query(api.shopify.offer, { cr }),
    };
    // White is a launch color with a catalog variant, but this work isn't offered in it.
    await expect(addToCart(ctx, { cr: "101-001", color: "WHITE", size: "M", quantity: 1 })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(shopifyCalls).toHaveLength(0);
    // Black is offered, so the add reaches Shopify (which is down here).
    await expect(addToCart(ctx, { cr: "101-001", color: "BLACK", size: "M", quantity: 1 })).rejects.toBeTruthy();
    expect(shopifyCalls).toHaveLength(1);
  });

  it("waits without counting attempts while Shopify is not configured", async () => {
    const t = newTest();
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    await t.run((ctx) =>
      ctx.db.insert("shopProducts", { workId, handle: "cr-101-001", status: "pending", attempts: 0, updatedAt: 0 }),
    );
    expect(await t.action(internal.shopify.syncWork, { workId })).toBe("skipped");
    const product = await t.run((ctx) => ctx.db.query("shopProducts").first());
    expect(product).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("backs off after a Shopify failure", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("access_token")
        ? Response.json({ access_token: "tok", expires_in: 86399 })
        : new Response("down", { status: 503 }),
    );
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    await t.run((ctx) =>
      ctx.db.insert("shopProducts", { workId, handle: "cr-101-001", status: "pending", attempts: 0, updatedAt: 0 }),
    );
    expect(await t.action(internal.shopify.syncWork, { workId })).toBe("failed");
    const product = await t.run((ctx) => ctx.db.query("shopProducts").first());
    expect(product).toMatchObject({ status: "failed", attempts: 1 });
    expect(product!.nextAttemptAt!).toBeGreaterThan(Date.now());
  });

  it("offers nothing while checkout is off, even for a work on sale", async () => {
    const t = newTest();
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    await makeOnSale(t, workId, "101-001");
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
    await setFlag(t, "commerce.checkout", true);
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).not.toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "101-002" })).toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "nope" })).toBeNull();
  });
});
