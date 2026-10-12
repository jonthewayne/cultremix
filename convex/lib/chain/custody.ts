// Member wallets. Circle holds them in every environment that has Circle keys. Until then, a
// managed wallet (MANAGED_WALLET_SECRET, any environment) is CultRemix's fallback: its key is
// derived from the secret and the member's ID, and it keeps signing after Circle takes over new
// wallets, since a member keeps one wallet. The local signer exists only for dev without either,
// and refuses to run anywhere else.
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { circleBaseUrl, circleClient } from "../circle";
import { isCanonicalSignature, normalizeSignature, typedDataJson } from "./eip712";
import type { FetchLike } from "../circle";
import type { RegistryTypedData } from "./eip712";
import type { Address, Hex } from "viem";
import type { ChainDeployment } from "../../../shared/config/chains";

type Env = Record<string, string | undefined>;

export type MemberWallet = {
  custody: "circle" | "managed" | "local";
  address: Address;
  circleWalletId?: string;
};

export class CustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyError";
  }
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// HMAC-SHA256(secret, label + userId) as a private key. The label keeps dev and managed wallets apart
// even under the same secret.
async function derivedPrivateKey(secret: string, label: string, userId: string): Promise<Hex> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${label}${userId}`)));
  const hex = `0x${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const value = BigInt(hex);
  if (value === 0n || value >= SECP256K1_N) throw new CustodyError("The derived key is out of range.");
  return hex;
}

/** dev only: a member's key is HMAC-SHA256(DEV_WALLET_SECRET, "cultremix:dev-wallet:" + userId). */
export async function devWalletPrivateKey(secret: string, userId: string): Promise<Hex> {
  return await derivedPrivateKey(secret, "cultremix:dev-wallet:", userId);
}

/** A managed wallet's key: HMAC-SHA256(MANAGED_WALLET_SECRET, "cultremix:managed-wallet:" + userId). */
export async function managedWalletPrivateKey(secret: string, userId: string): Promise<Hex> {
  return await derivedPrivateKey(secret, "cultremix:managed-wallet:", userId);
}

// A managed wallet signs whenever its secret is set, Circle keys or not.
function requireManagedSecret(env: Env) {
  const secret = env.MANAGED_WALLET_SECRET?.trim();
  if (!secret) throw new CustodyError("MANAGED_WALLET_SECRET is not set, and this member's wallet is a managed one.");
  return secret;
}

function requireLocal(deployment: ChainDeployment, env: Env) {
  if (deployment.env !== "dev" || deployment.custody.mode !== "local") {
    throw new CustodyError("The local signer runs only in dev without Circle keys.");
  }
  const secret = env.DEV_WALLET_SECRET?.trim();
  if (!secret) throw new CustodyError("DEV_WALLET_SECRET is not set.");
  return secret;
}

function requireCircle(deployment: ChainDeployment, env: Env, fetchImpl?: FetchLike) {
  if (deployment.custody.mode !== "circle") throw new CustodyError("Circle keys are not set for this deployment.");
  const client = circleClient({
    baseUrl: circleBaseUrl(env),
    apiKey: env.CIRCLE_API_KEY!.trim(),
    entitySecret: env.CIRCLE_ENTITY_SECRET!.trim(),
    fetch: fetchImpl,
  });
  return { client, walletSetId: deployment.custody.walletSetId };
}

/** Creates (or, with the same idempotency key, finds again) the member's wallet. */
export async function createMemberWallet(
  deployment: ChainDeployment,
  env: Env,
  args: { userId: string; idempotencyKey: string },
  fetchImpl?: FetchLike,
): Promise<MemberWallet> {
  if (deployment.custody.mode === "circle") {
    const { client, walletSetId } = requireCircle(deployment, env, fetchImpl);
    const wallet = await client.createWallet({
      idempotencyKey: args.idempotencyKey,
      walletSetId,
      blockchain: deployment.network.circleBlockchain,
      refId: args.userId,
    });
    return { custody: "circle", address: wallet.address, circleWalletId: wallet.walletId };
  }
  if (deployment.custody.mode === "managed") {
    const account = privateKeyToAccount(await managedWalletPrivateKey(requireManagedSecret(env), args.userId));
    return { custody: "managed", address: account.address };
  }
  if (deployment.custody.mode === "local") {
    const account = privateKeyToAccount(await devWalletPrivateKey(requireLocal(deployment, env), args.userId));
    return { custody: "local", address: account.address };
  }
  throw new CustodyError(deployment.custody.reason);
}

/**
 * Signs registry typed data with the member's own wallet and checks the result: a canonical
 * signature that recovers to the wallet's recorded address.
 */
export async function signForMember(
  deployment: ChainDeployment,
  env: Env,
  member: { userId: string; wallet: MemberWallet },
  typedData: RegistryTypedData,
  fetchImpl?: FetchLike,
): Promise<Hex> {
  const { wallet } = member;
  let signature: Hex;
  if (wallet.custody === "circle") {
    if (!wallet.circleWalletId) throw new CustodyError("The member's Circle wallet ID is missing.");
    const { client } = requireCircle(deployment, env, fetchImpl);
    signature = normalizeSignature(
      await client.signTypedData({ walletId: wallet.circleWalletId, typedDataJson: typedDataJson(typedData) }),
    );
  } else if (wallet.custody === "managed") {
    const account = privateKeyToAccount(await managedWalletPrivateKey(requireManagedSecret(env), member.userId));
    if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new CustodyError("MANAGED_WALLET_SECRET changed since this wallet was made.");
    }
    signature = await account.signTypedData(typedData);
  } else {
    const account = privateKeyToAccount(await devWalletPrivateKey(requireLocal(deployment, env), member.userId));
    if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new CustodyError("DEV_WALLET_SECRET changed since this wallet was made.");
    }
    signature = await account.signTypedData(typedData);
  }
  if (!isCanonicalSignature(signature)) throw new CustodyError("The wallet returned a non-canonical signature.");
  const signer = await recoverTypedDataAddress({ ...typedData, signature });
  if (signer.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new CustodyError("The signature does not recover to the member's wallet.");
  }
  return signature;
}
