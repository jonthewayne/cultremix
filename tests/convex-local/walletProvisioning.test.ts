import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { internal } from "../../convex/_generated/api";
import { devWalletPrivateKey } from "../../convex/lib/chain/custody";
import { setChainDepsForTests } from "../../convex/lib/chain/deps";
import { WALLET_LEASE_MS, walletBackoffMs } from "../../convex/wallets";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

const DEV_SECRET = "dev-only-secret";

function useEnv(env: Record<string, string>) {
  for (const name of ["DEPLOYMENT_ENV", "DEV_WALLET_SECRET", "CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_WALLET_SET_ID"]) {
    vi.stubEnv(name, env[name] ?? "");
  }
}

async function insertUser(t: ReturnType<typeof newTest>, fields: Record<string, unknown> = {}) {
  return await t.run((ctx) => ctx.db.insert("users", { email: `${crypto.randomUUID()}@example.com`, ...fields }));
}

async function getUser(t: ReturnType<typeof newTest>, userId: Id<"users">) {
  return (await t.run((ctx) => ctx.db.get("users", userId)))!;
}

// A Circle that remembers wallets by idempotency key, and can be told to fail.
function fakeCircle() {
  const wallets = new Map<string, { id: string; address: string }>();
  const state = { fail: false, creates: 0, keys: [] as Array<string> };
  const publicKeyPromise = (async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    return `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
  })();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/publicKey")) return Response.json({ data: { publicKey: await publicKeyPromise } });
    const body = JSON.parse(String(init?.body));
    state.creates += 1;
    state.keys.push(body.idempotencyKey);
    if (state.fail) return Response.json({ code: -1, message: "Something went wrong" }, { status: 500 });
    let wallet = wallets.get(body.idempotencyKey);
    if (!wallet) {
      wallet = { id: `wallet-${wallets.size + 1}`, address: privateKeyToAccount(`0x${(wallets.size + 1).toString(16).padStart(64, "0")}`).address };
      wallets.set(body.idempotencyKey, wallet);
    }
    return Response.json({ data: { wallets: [{ ...wallet, blockchain: body.blockchains[0] }] } });
  });
  return { state, fetchImpl };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  setChainDepsForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("wallet provisioning", () => {
  it("gives a dev member their derived local wallet, once", async () => {
    useEnv({ DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: DEV_SECRET });
    const t = newTest();
    const userId = await insertUser(t, { walletStatus: "pending" });
    await t.action(internal.wallets.provisionWallet, { userId });
    const user = await getUser(t, userId);
    const expected = privateKeyToAccount(await devWalletPrivateKey(DEV_SECRET, userId)).address;
    expect(user).toMatchObject({ walletStatus: "ready", walletCustody: "local", walletAddress: expected });

    await t.action(internal.wallets.provisionWallet, { userId });
    expect((await getUser(t, userId)).walletAddress).toBe(expected);
  });

  it("is idempotent with Circle: the stored key returns the same wallet", async () => {
    useEnv({
      DEPLOYMENT_ENV: "staging",
      CIRCLE_API_KEY: "TEST_API_KEY:a:b",
      CIRCLE_ENTITY_SECRET: "ab".repeat(32),
      CIRCLE_WALLET_SET_ID: "set-1",
    });
    const circle = fakeCircle();
    setChainDepsForTests({ fetch: circle.fetchImpl });
    const t = newTest();
    const userId = await insertUser(t, { walletStatus: "pending" });

    // The first call fails after the key was stored; the retry reuses that key.
    circle.state.fail = true;
    await t.action(internal.wallets.provisionWallet, { userId });
    let user = await getUser(t, userId);
    expect(user.walletStatus).toBe("failed");
    expect(user.walletAttempts).toBe(1);
    expect(user.walletError).toContain("500");
    expect(user.walletNextAttemptAt).toBe(Date.now() + walletBackoffMs(1));
    const key = user.walletIdempotencyKey!;
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);

    // Not before the backoff has passed.
    circle.state.fail = false;
    await t.action(internal.wallets.provisionWallet, { userId });
    expect(circle.state.creates).toBe(1);

    vi.advanceTimersByTime(walletBackoffMs(1));
    await t.action(internal.wallets.provisionWallet, { userId });
    user = await getUser(t, userId);
    expect(user).toMatchObject({ walletStatus: "ready", walletCustody: "circle", circleWalletId: "wallet-1" });
    const address = user.walletAddress;

    // A provisioning action that dies after Circle answered is retried once its lease ends, and
    // gets the same wallet back.
    await t.run((ctx) => ctx.db.patch("users", userId, { walletStatus: "provisioning", walletNextAttemptAt: Date.now() + WALLET_LEASE_MS }));
    vi.advanceTimersByTime(WALLET_LEASE_MS);
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    user = await getUser(t, userId);
    expect(user).toMatchObject({ walletStatus: "ready", walletAddress: address, circleWalletId: "wallet-1" });
    expect(new Set(circle.state.keys)).toEqual(new Set([key]));
  });

  it("backs off longer after each failure, up to an hour", () => {
    expect([1, 2, 3, 4].map(walletBackoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(walletBackoffMs(20)).toBe(3_600_000);
  });

  it("backfills users created before wallets", async () => {
    useEnv({ DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: DEV_SECRET });
    const t = newTest();
    const legacy = [await insertUser(t), await insertUser(t)];
    const ready = await insertUser(t, { walletStatus: "ready", walletAddress: "0x1", walletCustody: "local" });
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const userId of legacy) expect((await getUser(t, userId)).walletStatus).toBe("ready");
    expect((await getUser(t, ready)).walletAddress).toBe("0x1");
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 0 });
  });

  it("retries failed users only after their backoff", async () => {
    useEnv({ DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: DEV_SECRET });
    const t = newTest();
    const userId = await insertUser(t, {
      walletStatus: "failed",
      walletAttempts: 2,
      walletNextAttemptAt: Date.now() + walletBackoffMs(2),
    });
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 0 });
    vi.advanceTimersByTime(walletBackoffMs(2));
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await getUser(t, userId)).walletStatus).toBe("ready");
  });

  it("leaves users pending when this deployment has no custody", async () => {
    useEnv({ DEPLOYMENT_ENV: "staging" });
    const t = newTest();
    const userId = await insertUser(t, { walletStatus: "pending" });
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 0 });
    await t.action(internal.wallets.provisionWallet, { userId });
    expect((await getUser(t, userId)).walletStatus).toBe("pending");
  });

  it("refuses the local signer outside dev", async () => {
    useEnv({ DEPLOYMENT_ENV: "staging", DEV_WALLET_SECRET: DEV_SECRET });
    const t = newTest();
    const userId = await insertUser(t, { walletStatus: "pending" });
    await t.action(internal.wallets.provisionWallet, { userId });
    const user = await getUser(t, userId);
    expect(user.walletStatus).toBe("pending");
    expect(user.walletAddress).toBeUndefined();
    expect(await t.mutation(internal.wallets.reconcileWallets, {})).toEqual({ scheduled: 0 });
  });
});
