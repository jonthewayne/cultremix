import {
  CART_COOKIE,
  CART_COOKIE_MAX_AGE_SECONDS,
  REF_COOKIE,
} from "../../shared/config/shopify";
import { validRef } from "../lib/ref";
import { StorefrontError } from "./storefront";
import type { CartView, Storefront } from "./storefront";

// The cart behind the work page's BuyBox. The browser only names a work, product, color, size, and
// quantity; the server finds the Shopify variant from the work's live offer, so every line
// carries trustworthy _work_id and _cr attributes. The cart ID lives in an httpOnly cookie.

export const MAX_LINE_QUANTITY = 10;

export type OfferVariant = { color: string; size: string; merchandiseId: string; priceCents: number };
export type Offer = { workId: string; cr: string; products: Array<{ key: string; variants: Array<OfferVariant> }> } | null;

export type CartContext = {
  cookieHeader: string | null | undefined;
  buyerIp: string | null | undefined;
  secure: boolean;
  // Null while Shopify isn't configured.
  storefront: Storefront | null;
  // The work's live offer (convex shopify.offer); null while checkout is off.
  lookupOffer: (cr: string) => Promise<Offer>;
  // A kept design's offer, asked for as the signed-in member (convex shopify.keptOffer), so only
  // its creator gets one.
  lookupKeptOffer?: (workId: string) => Promise<Offer>;
};

export type CartResult = { cart: CartView | null; setCookies: Array<string> };

export class CartError extends Error {
  constructor(
    readonly code: "INVALID" | "CLOSED" | "UNAVAILABLE" | "NO_CART" | "SHOPIFY",
    message: string,
  ) {
    super(message);
  }
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function cartCookie(cartId: string, secure: boolean): string {
  return [
    `${CART_COOKIE}=${encodeURIComponent(cartId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${CART_COOKIE_MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearCartCookie(secure: boolean): string {
  return [`${CART_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

const CART_ID = /^gid:\/\/shopify\/Cart\/[A-Za-z0-9_-]+(\?key=[A-Za-z0-9_-]+)?$/u;
const LINE_ID = /^gid:\/\/shopify\/CartLine\/[A-Za-z0-9_-]+(\?cart=[A-Za-z0-9_-]+)?$/u;

function cartIdFrom(ctx: CartContext): string | null {
  const id = readCookie(ctx.cookieHeader, CART_COOKIE);
  return id && CART_ID.test(id) ? id : null;
}

function quantityOf(value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > MAX_LINE_QUANTITY) {
    throw new CartError("INVALID", "Pick a quantity from 1 to 10.");
  }
  return value;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new CartError("INVALID", "Something was missing.");
  return input as Record<string, unknown>;
}

// A published work by its CR number, or a kept design (which has none) by its id.
export type AddInput = { cr?: string; keep?: string; product: string; color: string; size: string; quantity: number };

const KEPT_ID = /^[a-z0-9]{16,64}$/u;

export function parseAddInput(input: unknown): AddInput {
  const data = record(input);
  const { cr, keep, product, color, size } = data;
  const byCr = typeof cr === "string" && /^\d{3}-\d{3}$/u.test(cr);
  const byKeep = typeof keep === "string" && KEPT_ID.test(keep);
  if (byCr === byKeep) throw new CartError("INVALID", "That design wasn't found.");
  if (typeof product !== "string" || !/^printful-\d{1,9}$/u.test(product)) throw new CartError("INVALID", "Pick a product.");
  if (typeof color !== "string" || !/^[A-Z0-9_]{1,20}$/u.test(color)) throw new CartError("INVALID", "Pick a color.");
  if (typeof size !== "string" || !/^[A-Z0-9]{1,4}$/u.test(size)) throw new CartError("INVALID", "Pick a size.");
  const design = byCr ? { cr: cr } : { keep: keep as string };
  return { ...design, product, color, size, quantity: quantityOf(data.quantity, 1) };
}

export type LineInput = { lineId: string; quantity: number };

export function parseLineInput(input: unknown, allowZero = true): LineInput {
  const data = record(input);
  if (typeof data.lineId !== "string" || !LINE_ID.test(data.lineId)) throw new CartError("INVALID", "That line wasn't found.");
  return { lineId: data.lineId, quantity: quantityOf(data.quantity, allowZero ? 0 : 1) };
}

export function parseLineId(input: unknown): string {
  const data = record(input);
  if (typeof data.lineId !== "string" || !LINE_ID.test(data.lineId)) throw new CartError("INVALID", "That line wasn't found.");
  return data.lineId;
}

function asCartError(error: unknown): never {
  if (error instanceof CartError) throw error;
  throw new CartError("SHOPIFY", "The cart didn't respond. Try again in a moment.");
}

export async function getCart(ctx: CartContext): Promise<CartResult> {
  const cartId = cartIdFrom(ctx);
  if (!cartId || !ctx.storefront) return { cart: null, setCookies: [] };
  try {
    const cart = await ctx.storefront.getCart(cartId);
    // A checked-out or expired cart: forget it so the next add starts fresh.
    if (!cart) return { cart: null, setCookies: [clearCartCookie(ctx.secure)] };
    return { cart, setCookies: [] };
  } catch (error) {
    return asCartError(error);
  }
}

export async function addToCart(ctx: CartContext, input: AddInput): Promise<CartResult> {
  const offer = input.keep
    ? ((await ctx.lookupKeptOffer?.(input.keep)) ?? null)
    : input.cr
      ? await ctx.lookupOffer(input.cr)
      : null;
  if (!offer || !ctx.storefront) throw new CartError("CLOSED", "Buying opens soon.");
  const product = offer.products.find((p) => p.key === input.product);
  if (!product) throw new CartError("UNAVAILABLE", "That product isn't available.");
  const variant = product.variants.find((v) => v.color === input.color && v.size === input.size);
  if (!variant) throw new CartError("UNAVAILABLE", "That color and size isn't available.");
  const line = {
    merchandiseId: variant.merchandiseId,
    quantity: input.quantity,
    attributes: [
      { key: "_work_id", value: offer.workId },
      { key: "_cr", value: offer.cr },
    ],
  };
  const storefront = ctx.storefront;
  const cartId = cartIdFrom(ctx);
  try {
    if (cartId) {
      try {
        const cart = await storefront.addLines(cartId, [line]);
        return { cart, setCookies: [cartCookie(cart.id, ctx.secure)] };
      } catch (error) {
        if (!(error instanceof StorefrontError) || error.code !== "CART_GONE") throw error;
      }
    }
    const ref = validRef(readCookie(ctx.cookieHeader, REF_COOKIE));
    const cart = await storefront.createCart([line], ref ? [{ key: "_ref", value: ref }] : []);
    return { cart, setCookies: [cartCookie(cart.id, ctx.secure)] };
  } catch (error) {
    return asCartError(error);
  }
}

export async function updateCartLine(ctx: CartContext, input: LineInput): Promise<CartResult> {
  if (input.quantity === 0) return removeCartLine(ctx, input.lineId);
  const cartId = cartIdFrom(ctx);
  if (!cartId || !ctx.storefront) throw new CartError("NO_CART", "Your cart is empty.");
  try {
    const cart = await ctx.storefront.updateLines(cartId, [{ id: input.lineId, quantity: input.quantity }]);
    return { cart, setCookies: [cartCookie(cart.id, ctx.secure)] };
  } catch (error) {
    return asCartError(error);
  }
}

export async function removeCartLine(ctx: CartContext, lineId: string): Promise<CartResult> {
  const cartId = cartIdFrom(ctx);
  if (!cartId || !ctx.storefront) throw new CartError("NO_CART", "Your cart is empty.");
  try {
    const cart = await ctx.storefront.removeLines(cartId, [lineId]);
    return { cart, setCookies: [cartCookie(cart.id, ctx.secure)] };
  } catch (error) {
    return asCartError(error);
  }
}
