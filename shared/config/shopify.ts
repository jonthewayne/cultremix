// Shopify settings shared by Convex (Admin API, webhooks) and the TanStack Start server
// (Storefront API). One pinned API version for every call and webhook subscription (KTD-12);
// U0(e) confirms it against both stores and recaptures the fixtures if it changes.
export const SHOPIFY_API_VERSION = "2026-07";

// Webhook topics CultRemix subscribes to, as Shopify sends them in X-Shopify-Topic.
export const SHOPIFY_WEBHOOK_TOPICS = ["orders/paid", "orders/cancelled", "refunds/create"] as const;
export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

// Larger bodies are refused before they are read into a table (Convex documents stop at 1 MiB).
export const SHOPIFY_WEBHOOK_MAX_BYTES = 512 * 1024;

// The cart lives in this httpOnly cookie for 10 days.
export const CART_COOKIE = "cr_cart";
export const CART_COOKIE_MAX_AGE_SECONDS = 10 * 24 * 60 * 60;

// First-touch referral: the first ?ref= seen in 30 days rides along on the cart as `_ref`.
export const REF_COOKIE = "cr_ref";
export const REF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const METAFIELD_NAMESPACE = "cultremix";

export function variantGid(id: string | number): string {
  const text = String(id);
  return text.startsWith("gid://") ? text : `gid://shopify/ProductVariant/${text}`;
}

export function orderGid(id: string | number): string {
  const text = String(id);
  return text.startsWith("gid://") ? text : `gid://shopify/Order/${text}`;
}

// The numeric tail of a Shopify GID ("gid://shopify/Order/123" -> "123").
export function gidTail(gid: string): string {
  const match = /\/(\d+)(?:\?.*)?$/u.exec(gid);
  return match ? match[1] : gid;
}
