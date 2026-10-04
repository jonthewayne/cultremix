import { describe, expect, it, vi } from "vitest";
import {
  CartError,
  addToCart,
  cartCookie,
  clearCartCookie,
  getCart,
  parseAddInput,
  parseLineInput,
  readCookie,
  updateCartLine,
  type CartContext,
  type Offer,
} from "../../src/server/cart";
import { createStorefront, storefrontConfigFromEnv, toCents } from "../../src/server/storefront";
import { refCookieToSet, validRef } from "../../src/lib/ref";

const CART_ID = "gid://shopify/Cart/c1-abc123?key=k123";
const LINE_ID = "gid://shopify/CartLine/l1?cart=c1-abc123";

function rawCart(lines: Array<{ quantity: number; cr?: string }> = [{ quantity: 1, cr: "101-001" }], id = CART_ID) {
  return {
    id,
    checkoutUrl: "https://cultremix-dev.myshopify.com/cart/c/c1-abc123?key=k123",
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    cost: { subtotalAmount: { amount: String(36 * lines.reduce((sum, l) => sum + l.quantity, 0)) + ".0", currencyCode: "USD" } },
    lines: {
      nodes: lines.map((l, i) => ({
        id: `gid://shopify/CartLine/l${i + 1}?cart=c1-abc123`,
        quantity: l.quantity,
        attributes: l.cr ? [{ key: "_cr", value: l.cr }, { key: "_work_id", value: "w1" }] : [],
        cost: { totalAmount: { amount: String(36 * l.quantity) + ".0", currencyCode: "USD" } },
        merchandise: {
          id: "gid://shopify/ProductVariant/1003",
          image: null,
          product: { title: "CR 101-001 · Night Swim" },
          selectedOptions: [
            { name: "Color", value: "White" },
            { name: "Size", value: "L" },
          ],
        },
      })),
    },
  };
}

type Call = { url: string; headers: Headers; query: string; variables: Record<string, unknown> };

function shopify(handler: (call: Call) => unknown) {
  const calls: Array<Call> = [];
  const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const call = { url, headers: new Headers(init?.headers), ...body };
    calls.push(call);
    return Response.json({ data: handler(call) });
  });
  return { fetchFake, calls };
}

const OFFER: Offer = {
  workId: "w1",
  cr: "101-001",
  variants: [
    { color: "WHITE", size: "L", merchandiseId: "gid://shopify/ProductVariant/1003", priceCents: 3600 },
    { color: "WHITE", size: "2XL", merchandiseId: "gid://shopify/ProductVariant/1005", priceCents: 3900 },
  ],
};

function context(fetchFake: ReturnType<typeof shopify>["fetchFake"], cookieHeader: string | null, offer: Offer = OFFER): CartContext {
  return {
    cookieHeader,
    buyerIp: "203.0.113.9",
    secure: true,
    storefront: createStorefront({
      config: { shopDomain: "cultremix-dev.myshopify.com", privateToken: "private" },
      buyerIp: "203.0.113.9",
      fetch: fetchFake,
    }),
    lookupOffer: async () => offer,
  };
}

describe("cart cookie", () => {
  it("is httpOnly, SameSite=Lax, 10 days, and Secure on https", () => {
    const cookie = cartCookie(CART_ID, true);
    expect(cookie).toBe(
      `cr_cart=${encodeURIComponent(CART_ID)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=864000; Secure`,
    );
    expect(cartCookie(CART_ID, false)).not.toContain("Secure");
    expect(clearCartCookie(true)).toContain("Max-Age=0");
  });

  it("reads back what it wrote", () => {
    const header = `a=1; ${cartCookie(CART_ID, true).split(";")[0]}; b=2`;
    expect(readCookie(header, "cr_cart")).toBe(CART_ID);
    expect(readCookie(header, "missing")).toBeNull();
    expect(readCookie("cr_cart=%E0%A4%A", "cr_cart")).toBeNull();
  });
});

describe("first-touch ref", () => {
  it("keeps the first valid ref only", () => {
    expect(validRef("Friend_42")).toBe("friend_42");
    expect(validRef("<script>")).toBeNull();
    expect(refCookieToSet("?ref=Friend_42", "", true)).toBe("cr_ref=friend_42; Path=/; SameSite=Lax; Max-Age=2592000; Secure");
    expect(refCookieToSet("?ref=second", "cr_ref=first", true)).toBeNull();
    expect(refCookieToSet("?x=1", "", true)).toBeNull();
  });
});

describe("input checks", () => {
  it("accepts a sensible add and refuses the rest", () => {
    expect(parseAddInput({ cr: "101-001", color: "WHITE", size: "L", quantity: 2 })).toEqual({
      cr: "101-001",
      color: "WHITE",
      size: "L",
      quantity: 2,
    });
    expect(() => parseAddInput({ cr: "101-001", color: "WHITE", size: "L", quantity: 11 })).toThrow(CartError);
    expect(() => parseAddInput({ cr: "101-001", color: "WHITE", size: "L", quantity: 1.5 })).toThrow(CartError);
    expect(() => parseAddInput({ cr: "../x", color: "WHITE", size: "L", quantity: 1 })).toThrow(CartError);
    expect(() => parseAddInput(null)).toThrow(CartError);
    expect(() => parseLineInput({ lineId: "gid://shopify/Product/1", quantity: 1 })).toThrow(CartError);
    expect(parseLineInput({ lineId: LINE_ID, quantity: 0 }).quantity).toBe(0);
  });
});

describe("cart server functions", () => {
  it("creates a cart with the line attributes, the ref, and the buyer's IP", async () => {
    const { fetchFake, calls } = shopify(() => ({ cartCreate: { cart: rawCart(), userErrors: [] } }));
    const result = await addToCart(context(fetchFake, "cr_ref=friend_42"), {
      cr: "101-001",
      color: "WHITE",
      size: "L",
      quantity: 1,
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://cultremix-dev.myshopify.com/api/2026-07/graphql.json");
    expect(call.headers.get("Shopify-Storefront-Private-Token")).toBe("private");
    expect(call.headers.get("Shopify-Storefront-Buyer-IP")).toBe("203.0.113.9");
    expect(call.query).toContain("cartCreate");
    expect(call.variables.input).toEqual({
      lines: [
        {
          merchandiseId: "gid://shopify/ProductVariant/1003",
          quantity: 1,
          attributes: [
            { key: "_work_id", value: "w1" },
            { key: "_cr", value: "101-001" },
          ],
        },
      ],
      attributes: [{ key: "_ref", value: "friend_42" }],
      buyerIdentity: { countryCode: "US" },
    });
    expect(result.cart?.checkoutUrl).toContain("/cart/c/");
    expect(result.cart?.lines[0]).toMatchObject({ cr: "101-001", color: "White", size: "L", totalCents: 3600 });
    expect(result.setCookies).toEqual([cartCookie(CART_ID, true)]);
  });

  it("adds to the existing cart named by the cookie", async () => {
    const { fetchFake, calls } = shopify(() => ({
      cartLinesAdd: { cart: rawCart([{ quantity: 1, cr: "101-001" }, { quantity: 2, cr: "101-001" }]), userErrors: [] },
    }));
    const result = await addToCart(context(fetchFake, `cr_cart=${encodeURIComponent(CART_ID)}`), {
      cr: "101-001",
      color: "WHITE",
      size: "2XL",
      quantity: 2,
    });
    expect(calls[0].query).toContain("cartLinesAdd");
    expect(calls[0].variables.cartId).toBe(CART_ID);
    expect(result.cart?.totalQuantity).toBe(3);
  });

  it("starts a new cart when the old one is gone", async () => {
    const { fetchFake, calls } = shopify((call) =>
      call.query.includes("cartLinesAdd")
        ? { cartLinesAdd: { cart: null, userErrors: [{ field: ["cartId"], message: "The specified cart does not exist.", code: "INVALID" }] } }
        : { cartCreate: { cart: rawCart([{ quantity: 1 }], "gid://shopify/Cart/c2-new?key=k2"), userErrors: [] } },
    );
    const result = await addToCart(context(fetchFake, `cr_cart=${encodeURIComponent(CART_ID)}`), {
      cr: "101-001",
      color: "WHITE",
      size: "L",
      quantity: 1,
    });
    expect(calls.map((c) => c.query.match(/cart\w+\(/u)?.[0])).toEqual(["cartLinesAdd(", "cartCreate("]);
    expect(result.setCookies[0]).toContain(encodeURIComponent("gid://shopify/Cart/c2-new?key=k2"));
  });

  it("refuses variants the work doesn't offer, and everything while checkout is off", async () => {
    const { fetchFake, calls } = shopify(() => ({}));
    await expect(
      addToCart(context(fetchFake, null), { cr: "101-001", color: "BLACK", size: "L", quantity: 1 }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      addToCart(context(fetchFake, null, null), { cr: "101-001", color: "WHITE", size: "L", quantity: 1 }),
    ).rejects.toMatchObject({ code: "CLOSED" });
    expect(calls).toHaveLength(0);
  });

  it("reads no cart without a cookie and forgets a checked-out one", async () => {
    const { fetchFake, calls } = shopify(() => ({ cart: null }));
    expect(await getCart(context(fetchFake, null))).toEqual({ cart: null, setCookies: [] });
    expect(calls).toHaveLength(0);
    const gone = await getCart(context(fetchFake, `cr_cart=${encodeURIComponent(CART_ID)}`));
    expect(gone.cart).toBeNull();
    expect(gone.setCookies).toEqual([clearCartCookie(true)]);
  });

  it("updates a line, and quantity 0 removes it", async () => {
    const { fetchFake, calls } = shopify((call) =>
      call.query.includes("cartLinesUpdate")
        ? { cartLinesUpdate: { cart: rawCart([{ quantity: 3 }]), userErrors: [] } }
        : { cartLinesRemove: { cart: rawCart([]), userErrors: [] } },
    );
    const cookie = `cr_cart=${encodeURIComponent(CART_ID)}`;
    const updated = await updateCartLine(context(fetchFake, cookie), { lineId: LINE_ID, quantity: 3 });
    expect(calls[0].variables).toEqual({ cartId: CART_ID, lines: [{ id: LINE_ID, quantity: 3 }] });
    expect(updated.cart?.totalQuantity).toBe(3);
    const removed = await updateCartLine(context(fetchFake, cookie), { lineId: LINE_ID, quantity: 0 });
    expect(calls[1].variables).toEqual({ cartId: CART_ID, lineIds: [LINE_ID] });
    expect(removed.cart?.lines).toEqual([]);
    await expect(updateCartLine(context(fetchFake, null), { lineId: LINE_ID, quantity: 1 })).rejects.toMatchObject({
      code: "NO_CART",
    });
  });

  it("turns Shopify outages into a plain message", async () => {
    const ctx = context(vi.fn(async () => new Response("nope", { status: 502 })), null);
    await expect(addToCart(ctx, { cr: "101-001", color: "WHITE", size: "L", quantity: 1 })).rejects.toMatchObject({
      code: "SHOPIFY",
      message: "The cart didn't respond. Try again in a moment.",
    });
  });
});

describe("storefront config", () => {
  it("needs the shop domain and the private token", () => {
    expect(storefrontConfigFromEnv({ SHOPIFY_SHOP_DOMAIN: "s.myshopify.com" })).toBeNull();
    expect(
      storefrontConfigFromEnv({ SHOPIFY_SHOP_DOMAIN: "s.myshopify.com", SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "t" }),
    ).toEqual({ shopDomain: "s.myshopify.com", privateToken: "t", apiVersion: undefined });
    expect(toCents("39.0")).toBe(3900);
    expect(toCents("35.99")).toBe(3599);
  });
});
