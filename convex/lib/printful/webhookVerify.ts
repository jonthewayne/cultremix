import { hmacSha256, timingSafeEqual } from "../shopify/webhookVerify";

// Printful v2 webhook verification: x-pf-webhook-signature is the hex HMAC-SHA256 of the raw body,
// keyed with the store's webhook secret, which Printful hands out hex-encoded (U0(d) confirms the
// header and encoding against a real delivery). The comparison is constant-time.

const encoder = new TextEncoder();

export function fromHex(text: string): Uint8Array | null {
  const clean = text.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

// The secret as key bytes: hex-decoded when it is hex, otherwise its UTF-8 bytes.
function secretKey(secret: string): Uint8Array {
  return fromHex(secret) ?? encoder.encode(secret);
}

export async function printfulSignature(body: Uint8Array, secret: string): Promise<string> {
  return toHex(await hmacSha256(secretKey(secret), body));
}

// True only when the header is present and matches.
export async function verifyPrintfulWebhook(
  body: Uint8Array,
  header: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const given = fromHex(header);
  if (!given) return false;
  return timingSafeEqual(given, await hmacSha256(secretKey(secret), body));
}

// JSON with object keys sorted at every level, so two deliveries of the same event hash alike.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// The dedupe identity of a delivery (plan, "Idempotency"): SHA-256 of the canonical body without
// the delivery-attempt field `retries`, plus the store and order IDs.
export async function printfulEventKey(payload: Record<string, unknown>, storeId: string, orderId: string): Promise<string> {
  const { retries: _retries, ...event } = payload;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJson(event))));
  return `${storeId}:${orderId}:${toHex(digest)}`;
}
