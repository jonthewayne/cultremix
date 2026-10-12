import { createServerFn } from "@tanstack/react-start";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CartContext, CartResult } from "~/server/cart";
import type { CartView } from "~/server/storefront";
import { fetchAuthQuery } from "~/lib/auth-server";
import {
  
  CartError,
  
  addToCart,
  getCart,
  parseAddInput,
  parseLineId,
  parseLineInput,
  removeCartLine,
  updateCartLine
} from "~/server/cart";
import { createStorefront, storefrontConfigFromEnv } from "~/server/storefront";

// Server functions for the work page's cart. The private Storefront token and the cart cookie
// never reach the browser; each call answers with the cart or a short, plain message.

export type CartResponse = { ok: true; cart: CartView | null } | { ok: false; code: string; message: string };

async function cartContext(): Promise<CartContext> {
  const { getRequestHeader, getRequestUrl } = await import("@tanstack/react-start/server");
  const config = storefrontConfigFromEnv();
  const buyerIp = getRequestHeader("cf-connecting-ip") ?? null;
  return {
    cookieHeader: getRequestHeader("cookie"),
    buyerIp,
    secure: getRequestUrl().protocol === "https:",
    storefront: config ? createStorefront({ config, buyerIp }) : null,
    lookupOffer: async (cr) => {
      const convexUrl = process.env.VITE_CONVEX_URL;
      if (!convexUrl) return null;
      return new ConvexHttpClient(convexUrl).query(api.shopify.offer, { cr });
    },
    // As the signed-in member: a kept design's offer is its creator's alone.
    lookupKeptOffer: async (workId) => {
      try {
        return await fetchAuthQuery(api.shopify.keptOffer, { workId: workId as Id<"works"> });
      } catch {
        return null;
      }
    },
  };
}

async function respond(run: (ctx: CartContext) => Promise<CartResult>): Promise<CartResponse> {
  try {
    const result = await run(await cartContext());
    if (result.setCookies.length) {
      const { getResponseHeaders } = await import("@tanstack/react-start/server");
      for (const cookie of result.setCookies) getResponseHeaders().append("set-cookie", cookie);
    }
    return { ok: true, cart: result.cart };
  } catch (error) {
    if (error instanceof CartError) return { ok: false, code: error.code, message: error.message };
    console.error("cart failed", error);
    return { ok: false, code: "SHOPIFY", message: "The cart didn't respond. Try again in a moment." };
  }
}

export const getCartFn = createServerFn({ method: "GET" }).handler(() => respond(getCart));

export const addToCartFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { cr?: string; keep?: string; product: string; color: string; size: string; quantity: number })
  .handler(({ data }) => respond((ctx) => addToCart(ctx, parseAddInput(data))));

export const updateCartLineFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { lineId: string; quantity: number })
  .handler(({ data }) => respond((ctx) => updateCartLine(ctx, parseLineInput(data))));

export const removeCartLineFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { lineId: string })
  .handler(({ data }) => respond((ctx) => removeCartLine(ctx, parseLineId(data))));
