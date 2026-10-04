import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64, shopifyHmac, verifyShopifyWebhook } from "../../convex/lib/shopify/webhookVerify";

const body = new TextEncoder().encode('{"id":5551234,"name":"#1001"}');
const secret = "client-secret";
const good = createHmac("sha256", secret).update(body).digest("base64");

describe("Shopify webhook HMAC", () => {
  it("matches Node's HMAC-SHA256 in base64", async () => {
    expect(await shopifyHmac(body, secret)).toBe(good);
  });

  it("accepts a good signature", async () => {
    expect(await verifyShopifyWebhook(body, good, secret)).toBe(true);
  });

  it("rejects a bad signature, a changed body, or the wrong secret", async () => {
    expect(await verifyShopifyWebhook(body, createHmac("sha256", "other").update(body).digest("base64"), secret)).toBe(false);
    expect(await verifyShopifyWebhook(new TextEncoder().encode('{"id":5551235}'), good, secret)).toBe(false);
    expect(await verifyShopifyWebhook(body, good, "wrong")).toBe(false);
    expect(await verifyShopifyWebhook(body, "not base64!", secret)).toBe(false);
  });

  it("rejects a missing signature or secret", async () => {
    expect(await verifyShopifyWebhook(body, null, secret)).toBe(false);
    expect(await verifyShopifyWebhook(body, "", secret)).toBe(false);
    expect(await verifyShopifyWebhook(body, good, "")).toBe(false);
  });

  it("decodes only real base64", () => {
    expect(fromBase64("AAEC")).toEqual(new Uint8Array([0, 1, 2]));
    expect(fromBase64("@@")).toBeNull();
  });
});
