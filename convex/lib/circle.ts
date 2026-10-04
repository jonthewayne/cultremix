// Circle developer-controlled wallets: create a member's EOA and sign EIP-712 typed data with it.
// Runs in the default Convex runtime (fetch + Web Crypto only). Every request carries a freshly
// encrypted entity secret, as Circle requires; the API key and entity secret never appear in
// errors or logs.
import type { Hex } from "viem";

export const CIRCLE_API_BASE = "https://api.circle.com";

/** The slice of fetch the clients use, so tests can pass a plain function. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type CircleConfig = {
  apiKey: string;
  entitySecret: string;
  baseUrl?: string;
  fetch?: FetchLike;
};

export type CircleWallet = { walletId: string; address: Hex };

export class CircleError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "CircleError";
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isUuidV4(value: string) {
  return UUID_V4.test(value);
}

export function circleClient(config: CircleConfig) {
  const baseUrl = (config.baseUrl ?? CIRCLE_API_BASE).replace(/\/$/u, "");
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  let publicKeyPem: string | null = null;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CircleError(`Circle ${path} could not be reached (${(error as Error).name}).`, null, null);
    }
    const text = await response.text();
    let json: { data?: T; code?: number; message?: string } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Fall through with an empty body.
    }
    if (!response.ok || json.data === undefined) {
      const detail = typeof json.message === "string" ? json.message.slice(0, 200) : "no detail";
      throw new CircleError(
        `Circle ${path} returned ${response.status}: ${detail}`,
        response.status,
        typeof json.code === "number" ? json.code : null,
      );
    }
    return json.data;
  }

  async function ciphertext() {
    if (!publicKeyPem) {
      const data = await request<{ publicKey: string }>("GET", "/v1/w3s/config/entity/publicKey");
      publicKeyPem = data.publicKey;
    }
    return await encryptEntitySecret(config.entitySecret, publicKeyPem);
  }

  return {
    /**
     * Creates one EOA wallet, or returns the wallet already created with this idempotency key.
     * The key must be a UUIDv4 persisted before the first call and reused on every retry.
     */
    async createWallet(args: {
      idempotencyKey: string;
      walletSetId: string;
      blockchain: string;
      refId?: string;
    }): Promise<CircleWallet> {
      if (!isUuidV4(args.idempotencyKey)) throw new CircleError("The idempotency key must be a UUIDv4.", null, null);
      const data = await request<{ wallets?: Array<{ id?: string; address?: string; blockchain?: string }> }>(
        "POST",
        "/v1/w3s/developer/wallets",
        {
          idempotencyKey: args.idempotencyKey,
          entitySecretCiphertext: await ciphertext(),
          walletSetId: args.walletSetId,
          blockchains: [args.blockchain],
          accountType: "EOA",
          count: 1,
          ...(args.refId ? { metadata: [{ refId: args.refId }] } : {}),
        },
      );
      const wallet = data.wallets?.[0];
      if (!wallet?.id || !wallet.address || !/^0x[0-9a-fA-F]{40}$/u.test(wallet.address)) {
        throw new CircleError("Circle returned no wallet.", null, null);
      }
      if (wallet.blockchain && wallet.blockchain !== args.blockchain) {
        throw new CircleError(`Circle created the wallet on ${wallet.blockchain}, not ${args.blockchain}.`, null, null);
      }
      return { walletId: wallet.id, address: wallet.address as Hex };
    },

    /** Signs a full EIP-712 payload (see typedDataJson in ./chain/eip712.ts). */
    async signTypedData(args: { walletId: string; typedDataJson: string; memo?: string }): Promise<Hex> {
      const data = await request<{ signature?: string }>("POST", "/v1/w3s/developer/sign/typedData", {
        walletId: args.walletId,
        data: args.typedDataJson,
        ...(args.memo ? { memo: args.memo } : {}),
        entitySecretCiphertext: await ciphertext(),
      });
      if (!data.signature || !/^0x[0-9a-fA-F]+$/u.test(data.signature)) {
        throw new CircleError("Circle returned no signature.", null, null);
      }
      return data.signature as Hex;
    },
  };
}

export type CircleClient = ReturnType<typeof circleClient>;

/**
 * RSA-OAEP (SHA-256) encryption of the 32-byte entity secret under Circle's entity public key,
 * base64-encoded. OAEP is randomized, so every call returns a new ciphertext.
 */
export async function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): Promise<string> {
  const secret = entitySecretHex.trim().replace(/^0x/u, "");
  if (!/^[0-9a-fA-F]{64}$/u.test(secret)) throw new CircleError("CIRCLE_ENTITY_SECRET must be 32 bytes of hex.", null, null);
  const key = await crypto.subtle.importKey("spki", spkiFromPem(publicKeyPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "encrypt",
  ]);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, hexToBytes(secret));
  return bytesToBase64(new Uint8Array(encrypted));
}

/** Circle publishes a PKCS#1 "RSA PUBLIC KEY"; Web Crypto imports SPKI. Accepts either. */
export function spkiFromPem(pem: string): ArrayBuffer {
  const match = pem.match(/-----BEGIN (RSA )?PUBLIC KEY-----([\s\S]+?)-----END (RSA )?PUBLIC KEY-----/u);
  if (!match) throw new CircleError("Circle's entity public key is not a PEM public key.", null, null);
  const der = base64ToBytes(match[2].replace(/\s+/gu, ""));
  const spki = match[1] ? wrapPkcs1(der) : der;
  return spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength) as ArrayBuffer;
}

// SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier rsaEncryption NULL, BIT STRING pkcs1 }
const RSA_ALGORITHM = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

function wrapPkcs1(pkcs1: Uint8Array) {
  const bitString = derElement(0x03, concat(Uint8Array.of(0), pkcs1));
  return derElement(0x30, concat(RSA_ALGORITHM, bitString));
}

function derElement(tag: number, content: Uint8Array) {
  return concat(Uint8Array.of(tag), derLength(content.length), content);
}

function derLength(length: number) {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: Array<number> = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function concat(...parts: Array<Uint8Array>) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
