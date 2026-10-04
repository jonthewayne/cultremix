import { describe, expect, it } from "vitest";
import { CircleError, circleClient, encryptEntitySecret, isUuidV4, spkiFromPem } from "../../convex/lib/circle";

const ENTITY_SECRET = "ab".repeat(32);
const API_KEY = "TEST_API_KEY:key-id:key-secret";

async function rsaKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  // A 2048-bit SPKI is a fixed 24-byte header around the PKCS#1 key Circle publishes.
  const pkcs1 = spki.slice(24);
  const pem = (label: string, bytes: Uint8Array) =>
    `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...bytes)).replace(/(.{64})/gu, "$1\n")}\n-----END ${label}-----\n`;
  return { privateKey: pair.privateKey, spkiPem: pem("PUBLIC KEY", spki), pkcs1Pem: pem("RSA PUBLIC KEY", pkcs1) };
}

async function decrypt(privateKey: CryptoKey, ciphertext: string) {
  const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, bytes));
  return Array.from(plain, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

function fakeCircle(publicKey: string, routes: Record<string, (body: Record<string, unknown>) => Response>) {
  const calls: Array<Call> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body });
    const path = new URL(url).pathname;
    if (path === "/v1/w3s/config/entity/publicKey") return Response.json({ data: { publicKey } });
    const route = routes[path];
    return route ? route(body ?? {}) : new Response("{}", { status: 404 });
  });
  return { calls, fetchImpl };
}

describe("entity secret ciphertext", () => {
  it("encrypts under Circle's PKCS#1 key and under an SPKI key, freshly each time", async () => {
    const keys = await rsaKeys();
    const a = await encryptEntitySecret(ENTITY_SECRET, keys.pkcs1Pem);
    const b = await encryptEntitySecret(ENTITY_SECRET, keys.pkcs1Pem);
    expect(a).not.toBe(b);
    expect(await decrypt(keys.privateKey, a)).toBe(ENTITY_SECRET);
    expect(await decrypt(keys.privateKey, b)).toBe(ENTITY_SECRET);
    expect(await decrypt(keys.privateKey, await encryptEntitySecret(ENTITY_SECRET, keys.spkiPem))).toBe(ENTITY_SECRET);
    expect(new Uint8Array(spkiFromPem(keys.pkcs1Pem))).toEqual(new Uint8Array(spkiFromPem(keys.spkiPem)));
  });

  it("refuses an entity secret that isn't 32 bytes of hex", async () => {
    const keys = await rsaKeys();
    await expect(encryptEntitySecret("abc", keys.spkiPem)).rejects.toThrow(/32 bytes/);
  });
});

describe("circleClient", () => {
  it("creates an EOA on the deployment's chain with the persisted idempotency key", async () => {
    const keys = await rsaKeys();
    const { calls, fetchImpl } = fakeCircle(keys.pkcs1Pem, {
      "/v1/w3s/developer/wallets": () =>
        Response.json({
          data: { wallets: [{ id: "wallet-1", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", blockchain: "MONAD-TESTNET" }] },
        }),
    });
    const client = circleClient({ apiKey: API_KEY, entitySecret: ENTITY_SECRET, fetch: fetchImpl });
    const key = crypto.randomUUID();
    const args = { idempotencyKey: key, walletSetId: "set-1", blockchain: "MONAD-TESTNET", refId: "user-1" };
    expect(await client.createWallet(args)).toEqual({ walletId: "wallet-1", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    await client.createWallet(args);

    const creates = calls.filter((c) => c.url.endsWith("/developer/wallets"));
    expect(creates).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith("/publicKey"))).toHaveLength(1);
    for (const call of creates) {
      expect(call.headers.Authorization).toBe(`Bearer ${API_KEY}`);
      expect(call.body).toMatchObject({
        idempotencyKey: key,
        walletSetId: "set-1",
        blockchains: ["MONAD-TESTNET"],
        accountType: "EOA",
        count: 1,
        metadata: [{ refId: "user-1" }],
      });
      expect(await decrypt(keys.privateKey, call.body!.entitySecretCiphertext as string)).toBe(ENTITY_SECRET);
    }
    // A new ciphertext on every request.
    expect(creates[0].body!.entitySecretCiphertext).not.toBe(creates[1].body!.entitySecretCiphertext);
  });

  it("insists on a UUIDv4 idempotency key", async () => {
    const keys = await rsaKeys();
    const { calls, fetchImpl } = fakeCircle(keys.spkiPem, {});
    const client = circleClient({ apiKey: API_KEY, entitySecret: ENTITY_SECRET, fetch: fetchImpl });
    expect(isUuidV4(crypto.randomUUID())).toBe(true);
    await expect(
      client.createWallet({ idempotencyKey: "user-1", walletSetId: "s", blockchain: "MONAD-TESTNET" }),
    ).rejects.toThrow(/UUIDv4/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a wallet on another chain", async () => {
    const keys = await rsaKeys();
    const { fetchImpl } = fakeCircle(keys.spkiPem, {
      "/v1/w3s/developer/wallets": () =>
        Response.json({ data: { wallets: [{ id: "w", address: `0x${"1".repeat(40)}`, blockchain: "MONAD" }] } }),
    });
    const client = circleClient({ apiKey: API_KEY, entitySecret: ENTITY_SECRET, fetch: fetchImpl });
    await expect(
      client.createWallet({ idempotencyKey: crypto.randomUUID(), walletSetId: "s", blockchain: "MONAD-TESTNET" }),
    ).rejects.toThrow(/on MONAD, not MONAD-TESTNET/);
  });

  it("signs typed data and reports Circle errors without secrets", async () => {
    const keys = await rsaKeys();
    let fail = true;
    const { calls, fetchImpl } = fakeCircle(keys.spkiPem, {
      "/v1/w3s/developer/sign/typedData": () =>
        fail
          ? Response.json({ code: 156001, message: "Wallet not found" }, { status: 400 })
          : Response.json({ data: { signature: `0x${"22".repeat(65)}` } }),
    });
    const client = circleClient({ apiKey: API_KEY, entitySecret: ENTITY_SECRET, fetch: fetchImpl });
    const error = await client.signTypedData({ walletId: "w", typedDataJson: "{}" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CircleError);
    expect((error as CircleError).status).toBe(400);
    expect((error as CircleError).code).toBe(156001);
    expect((error as Error).message).toContain("Wallet not found");
    expect((error as Error).message).not.toContain("key-secret");
    expect((error as Error).message).not.toContain(ENTITY_SECRET);

    fail = false;
    expect(await client.signTypedData({ walletId: "w", typedDataJson: '{"a":1}' })).toBe(`0x${"22".repeat(65)}`);
    expect(calls.at(-1)!.body).toMatchObject({ walletId: "w", data: '{"a":1}' });
  });

  it("turns a network failure into a CircleError", async () => {
    const client = circleClient({
      apiKey: API_KEY,
      entitySecret: ENTITY_SECRET,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(client.signTypedData({ walletId: "w", typedDataJson: "{}" })).rejects.toThrow(/could not be reached/);
  });
});
