// EIP-712 typed data for CultRemixRegistry. The domain and types must match the contract exactly:
// contracts/test/fixtures/eip712-vectors.json is checked by both the forge suite and
// tests/unit/eip712.test.ts.
import {
  getTypesForEIP712Domain,
  hashTypedData,
  recoverTypedDataAddress,
  serializeTypedData,
  type Address,
  type Hex,
} from "viem";

export const REGISTRY_DOMAIN_NAME = "CultRemixRegistry";
export const REGISTRY_DOMAIN_VERSION = "1";

// How long a member's signature stays valid. A write that misses it is signed again.
export const SIGNATURE_TTL_SECONDS = 10 * 60;

export const registryTypes = {
  RegisterWork: [
    { name: "workId", type: "bytes32" },
    { name: "family", type: "uint64" },
    { name: "expression", type: "uint32" },
    { name: "kind", type: "uint8" },
    { name: "parentId", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "uriHash", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
  Back: [
    { name: "workId", type: "bytes32" },
    { name: "backer", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type RegistryDomain = {
  name: typeof REGISTRY_DOMAIN_NAME;
  version: typeof REGISTRY_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
};

export type RegisterWorkMessage = {
  workId: Hex;
  family: bigint;
  expression: number;
  kind: number;
  parentId: Hex;
  contentHash: Hex;
  uriHash: Hex;
  creator: Address;
  deadline: bigint;
};

export type BackMessage = {
  workId: Hex;
  backer: Address;
  deadline: bigint;
};

export function registryDomain(chainId: number, verifyingContract: Address): RegistryDomain {
  return { name: REGISTRY_DOMAIN_NAME, version: REGISTRY_DOMAIN_VERSION, chainId, verifyingContract };
}

export function registerWorkTypedData(domain: RegistryDomain, message: RegisterWorkMessage) {
  return { domain, types: registryTypes, primaryType: "RegisterWork" as const, message };
}

export function backTypedData(domain: RegistryDomain, message: BackMessage) {
  return { domain, types: registryTypes, primaryType: "Back" as const, message };
}

export type RegistryTypedData = ReturnType<typeof registerWorkTypedData> | ReturnType<typeof backTypedData>;

export function typedDataDigest(typedData: RegistryTypedData): Hex {
  return hashTypedData(typedData);
}

/**
 * The full EIP-712 payload as JSON, as Circle's signing API takes it: the EIP712Domain type is
 * spelled out and bigints are decimal strings.
 */
export function typedDataJson(typedData: RegistryTypedData): string {
  const types = { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }), ...typedData.types };
  return serializeTypedData({ ...typedData, types } as never);
}

export async function recoverTypedDataSigner(typedData: RegistryTypedData, signature: Hex): Promise<Address> {
  return await recoverTypedDataAddress({ ...typedData, signature });
}

export function signatureDeadline(nowMs: number, ttlSeconds = SIGNATURE_TTL_SECONDS): bigint {
  return BigInt(Math.floor(nowMs / 1000) + ttlSeconds);
}

// The contract accepts only 65-byte signatures with a low s and v of 27 or 28.
const SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export function isCanonicalSignature(signature: Hex): boolean {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) return false;
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return s <= SECP256K1_HALF_N && (v === 27 || v === 28);
}

/** Circle and some signers return v as 0/1; the contract wants 27/28. */
export function normalizeSignature(signature: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) return signature;
  const v = Number.parseInt(signature.slice(130, 132), 16);
  if (v === 0 || v === 1) return `${signature.slice(0, 130)}${(v + 27).toString(16)}` as Hex;
  return signature;
}
