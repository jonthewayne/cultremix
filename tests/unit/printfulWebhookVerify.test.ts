import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  printfulEventKey,
  printfulSignature,
  verifyPrintfulWebhook,
} from "../../convex/lib/printful/webhookVerify";

const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const body = new TextEncoder().encode(JSON.stringify({ type: "order_updated", data: { order: { id: 9 } } }));
const expected = createHmac("sha256", Buffer.from(SECRET, "hex")).update(body).digest("hex");

describe("verifyPrintfulWebhook", () => {
  it("accepts the hex HMAC-SHA256 of the raw body under the hex-decoded secret", async () => {
    expect(await printfulSignature(body, SECRET)).toBe(expected);
    expect(await verifyPrintfulWebhook(body, expected, SECRET)).toBe(true);
    expect(await verifyPrintfulWebhook(body, expected.toUpperCase(), SECRET)).toBe(true);
  });

  it("uses a non-hex secret as plain text", async () => {
    const plain = createHmac("sha256", "not-hex-secret").update(body).digest("hex");
    expect(await verifyPrintfulWebhook(body, plain, "not-hex-secret")).toBe(true);
  });

  it("refuses a bad, malformed, or missing signature, or a missing secret", async () => {
    const wrong = createHmac("sha256", Buffer.from("00".repeat(16), "hex")).update(body).digest("hex");
    expect(await verifyPrintfulWebhook(body, wrong, SECRET)).toBe(false);
    expect(await verifyPrintfulWebhook(body, "zz", SECRET)).toBe(false);
    expect(await verifyPrintfulWebhook(body, expected.slice(0, 10), SECRET)).toBe(false);
    expect(await verifyPrintfulWebhook(body, null, SECRET)).toBe(false);
    expect(await verifyPrintfulWebhook(body, "", SECRET)).toBe(false);
    expect(await verifyPrintfulWebhook(body, expected, "")).toBe(false);
  });

  it("refuses a body changed after signing", async () => {
    const changed = new TextEncoder().encode(JSON.stringify({ type: "order_updated", data: { order: { id: 10 } } }));
    expect(await verifyPrintfulWebhook(changed, expected, SECRET)).toBe(false);
  });
});

describe("printfulEventKey", () => {
  it("ignores key order and the retries counter", async () => {
    const first = await printfulEventKey({ type: "order_updated", retries: 0, store_id: 777, data: { order: { id: 9, status: "draft" } } }, "777", "9");
    const again = await printfulEventKey({ data: { order: { status: "draft", id: 9 } }, store_id: 777, retries: 3, type: "order_updated" }, "777", "9");
    expect(again).toBe(first);
    const canonical = canonicalJson({ data: { order: { id: 9, status: "draft" } }, store_id: 777, type: "order_updated" });
    expect(first).toBe(`777:9:${createHash("sha256").update(canonical).digest("hex")}`);
  });

  it("tells different events apart", async () => {
    const draft = await printfulEventKey({ type: "order_updated", data: { order: { id: 9, status: "draft" } } }, "777", "9");
    const pending = await printfulEventKey({ type: "order_updated", data: { order: { id: 9, status: "pending" } } }, "777", "9");
    expect(pending).not.toBe(draft);
  });
});
