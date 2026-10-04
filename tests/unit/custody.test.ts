import { describe, expect, it } from "vitest";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertDeploymentConsistency, type ChainDeployment } from "../../shared/config/chains";
import { createMemberWallet, devWalletPrivateKey, signForMember } from "../../convex/lib/chain/custody";
import { backTypedData, registryDomain } from "../../convex/lib/chain/eip712";

const DEV_ENV = { DEPLOYMENT_ENV: "dev", DEV_WALLET_SECRET: "dev-only-secret" };
const typed = backTypedData(registryDomain(10143, "0x5FbDB2315678afecb367f032d93F642f64180aa3"), {
  workId: `0x${"ab".repeat(32)}`,
  backer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  deadline: 1790600000n,
});

describe("dev local signer", () => {
  it("derives one stable key per member from the dev secret", async () => {
    const a = await devWalletPrivateKey("s", "user-a");
    expect(await devWalletPrivateKey("s", "user-a")).toBe(a);
    expect(await devWalletPrivateKey("s", "user-b")).not.toBe(a);
    expect(await devWalletPrivateKey("t", "user-a")).not.toBe(a);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("creates and signs with the member's wallet in dev", async () => {
    const deployment = assertDeploymentConsistency(DEV_ENV);
    const wallet = await createMemberWallet(deployment, DEV_ENV, { userId: "user-a", idempotencyKey: crypto.randomUUID() });
    expect(wallet.custody).toBe("local");
    expect(wallet.address).toBe(privateKeyToAccount(await devWalletPrivateKey("dev-only-secret", "user-a")).address);
    const message = { ...typed.message, backer: wallet.address };
    const signature = await signForMember(deployment, DEV_ENV, { userId: "user-a", wallet }, { ...typed, message });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/u);
  });

  it("refuses to run outside dev, even with a forged deployment", async () => {
    const forged = { ...assertDeploymentConsistency(DEV_ENV), env: "staging" } as ChainDeployment;
    await expect(
      createMemberWallet(forged, DEV_ENV, { userId: "user-a", idempotencyKey: crypto.randomUUID() }),
    ).rejects.toThrow(/only in dev/);
    const wallet = { custody: "local" as const, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const };
    await expect(signForMember(forged, DEV_ENV, { userId: "user-a", wallet }, typed)).rejects.toThrow(/only in dev/);
  });

  it("refuses a local wallet once Circle keys are set", async () => {
    const env = { ...DEV_ENV, CIRCLE_API_KEY: "TEST_API_KEY:a:b", CIRCLE_ENTITY_SECRET: "ab".repeat(32), CIRCLE_WALLET_SET_ID: "s" };
    const deployment = assertDeploymentConsistency(env);
    const wallet = { custody: "local" as const, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const };
    await expect(signForMember(deployment, env, { userId: "user-a", wallet }, typed)).rejects.toThrow(/only in dev/);
  });

  it("has no custody without Circle keys in staging", async () => {
    const deployment = assertDeploymentConsistency({ DEPLOYMENT_ENV: "staging" });
    await expect(
      createMemberWallet(deployment, {}, { userId: "u", idempotencyKey: crypto.randomUUID() }),
    ).rejects.toThrow(/No Circle keys/);
  });
});

describe("Circle signatures", () => {
  const circleEnv = {
    DEPLOYMENT_ENV: "staging",
    CIRCLE_API_KEY: "TEST_API_KEY:a:b",
    CIRCLE_ENTITY_SECRET: "ab".repeat(32),
    CIRCLE_WALLET_SET_ID: "set-1",
  };

  async function fakeSigning(signature: Hex) {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
    return (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/publicKey")) return Response.json({ data: { publicKey } });
      return Response.json({ data: { signature } });
    });
  }

  it("normalizes a 0/1 recovery id and checks the signer", async () => {
    const member = privateKeyToAccount(`0x${"59".repeat(32)}`);
    const message = { ...typed.message, backer: member.address };
    const signature = await member.signTypedData({ ...typed, message });
    const zeroBased = `${signature.slice(0, 130)}0${Number.parseInt(signature.slice(130), 16) - 27}` as Hex;
    const deployment = assertDeploymentConsistency(circleEnv);
    const wallet = { custody: "circle" as const, address: member.address, circleWalletId: "w" };
    expect(
      await signForMember(deployment, circleEnv, { userId: "u", wallet }, { ...typed, message }, await fakeSigning(zeroBased)),
    ).toBe(signature);
  });

  it("refuses a signature from another key", async () => {
    const other = privateKeyToAccount(`0x${"61".repeat(32)}`);
    const signature = await other.signTypedData(typed);
    const deployment = assertDeploymentConsistency(circleEnv);
    const wallet = { custody: "circle" as const, address: typed.message.backer, circleWalletId: "w" };
    await expect(
      signForMember(deployment, circleEnv, { userId: "u", wallet }, typed, await fakeSigning(signature)),
    ).rejects.toThrow(/does not recover/);
  });
});
