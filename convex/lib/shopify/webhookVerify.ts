// Shopify webhook verification (KTD-12): X-Shopify-Hmac-Sha256 is the base64 HMAC-SHA256 of the
// raw request body, keyed with the app's client secret. Web Crypto only, so it runs in Convex's
// default runtime; the comparison is constant-time.

const encoder = new TextEncoder();

// Copies into a plain ArrayBuffer-backed view, which is what Web Crypto's types accept.
function bytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(input.byteLength);
  out.set(input);
  return out;
}

export async function hmacSha256(key: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", bytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, bytes(body)));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(text)) return null;
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function shopifyHmac(body: Uint8Array, secret: string): Promise<string> {
  return toBase64(await hmacSha256(encoder.encode(secret), body));
}

// True only when the header is present and matches.
export async function verifyShopifyWebhook(
  body: Uint8Array,
  header: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const given = fromBase64(header.trim());
  if (!given) return false;
  return timingSafeEqual(given, await hmacSha256(encoder.encode(secret), body));
}
