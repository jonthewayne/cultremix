import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { variantList } from "../../convex/lib/shopify/productSync";
import { newTest } from "./setup";
import { SHOP_ENV, makeOnSale, makeUser, makeWork, setFlag } from "./shopFixtures";

function fakeShopify() {
  const queries: Array<string> = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/admin/oauth/access_token")) {
      return Response.json({ access_token: "tok", expires_in: 86399 });
    }
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    if (query.includes("productSet")) {
      return Response.json({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/77",
              handle: "cr-101-001",
              variants: {
                nodes: variantList("101-001").map((v, i) => ({
                  id: `gid://shopify/ProductVariant/${700 + i}`,
                  sku: v.sku,
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
  return { fetchFake, queries };
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
    expect(offer?.variants).toHaveLength(20);
    expect(offer?.sizes).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(JSON.stringify(offer)).not.toMatch(/printful|token/iu);
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
