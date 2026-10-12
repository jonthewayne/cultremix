import { describe, expect, it } from "vitest";
import { hashStruct } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import vectors from "../../contracts/test/fixtures/eip712-vectors.json";
import {
  backTypedData,
  isCanonicalSignature,
  normalizeSignature,
  recoverTypedDataSigner,
  registerWorkTypedData,
  registryDomain,
  registryTypes,
  signatureDeadline,
  typedDataDigest,
  typedDataJson,
} from "../../convex/lib/chain/eip712";
import type { Address, Hex } from "viem";

// The same vectors are checked by the forge suite (test_SharedEip712Vectors), so the contract
// and this code agree on the domain, the type strings, and the digests.
const domain = registryDomain(vectors.domain.chainId, vectors.domain.verifyingContract as Address);
const registerMessage = {
  ...vectors.registerWork.message,
  workId: vectors.registerWork.message.workId as Hex,
  parentId: vectors.registerWork.message.parentId as Hex,
  contentHash: vectors.registerWork.message.contentHash as Hex,
  uriHash: vectors.registerWork.message.uriHash as Hex,
  creator: vectors.registerWork.message.creator as Address,
  family: BigInt(vectors.registerWork.message.family),
  deadline: BigInt(vectors.registerWork.message.deadline),
};
const backMessage = {
  workId: vectors.back.message.workId as Hex,
  backer: vectors.back.message.backer as Address,
  deadline: BigInt(vectors.back.message.deadline),
};

describe("shared EIP-712 vectors", () => {
  it("builds the RegisterWork struct hash and digest", () => {
    expect(hashStruct({ types: registryTypes, primaryType: "RegisterWork", data: registerMessage })).toBe(
      vectors.registerWork.structHash,
    );
    expect(typedDataDigest(registerWorkTypedData(domain, registerMessage))).toBe(vectors.registerWork.digest);
  });

  it("builds the Back struct hash and digest", () => {
    expect(hashStruct({ types: registryTypes, primaryType: "Back", data: backMessage })).toBe(vectors.back.structHash);
    expect(typedDataDigest(backTypedData(domain, backMessage))).toBe(vectors.back.digest);
  });

  it("produces the fixture signatures and recovers their signers", async () => {
    const creator = privateKeyToAccount(vectors.registerWork.privateKey as Hex);
    const backer = privateKeyToAccount(vectors.back.privateKey as Hex);
    const registerTyped = registerWorkTypedData(domain, registerMessage);
    const backTyped = backTypedData(domain, backMessage);
    expect(await creator.signTypedData(registerTyped)).toBe(vectors.registerWork.signature);
    expect(await backer.signTypedData(backTyped)).toBe(vectors.back.signature);
    expect(await recoverTypedDataSigner(registerTyped, vectors.registerWork.signature as Hex)).toBe(creator.address);
    expect(await recoverTypedDataSigner(backTyped, vectors.back.signature as Hex)).toBe(backer.address);
  });

  it("changes the digest on another chain", () => {
    const mainnet = registryDomain(143, vectors.domain.verifyingContract as Address);
    expect(typedDataDigest(registerWorkTypedData(mainnet, registerMessage))).toBe(vectors.registerWork.mainnetDigest);
  });

  it("changes the digest for another deployment", () => {
    const other = registryDomain(vectors.domain.chainId, "0x2222222222222222222222222222222222222222");
    expect(typedDataDigest(registerWorkTypedData(other, registerMessage))).not.toBe(vectors.registerWork.digest);
  });
});

describe("signature helpers", () => {
  it("serializes typed data for Circle with the domain type and string bigints", () => {
    const parsed = JSON.parse(typedDataJson(registerWorkTypedData(domain, registerMessage)));
    expect(parsed.primaryType).toBe("RegisterWork");
    expect(parsed.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual([
      "name",
      "version",
      "chainId",
      "verifyingContract",
    ]);
    expect(parsed.message.family).toBe("101");
    expect(parsed.message.deadline).toBe("1790600000");
  });

  it("accepts only canonical 65-byte signatures", () => {
    expect(isCanonicalSignature(vectors.registerWork.signature as Hex)).toBe(true);
    expect(isCanonicalSignature("0x1234")).toBe(false);
    const sig = vectors.back.signature as Hex;
    const highS = `${sig.slice(0, 66)}${"f".repeat(64)}${sig.slice(130)}` as Hex;
    expect(isCanonicalSignature(highS)).toBe(false);
  });

  it("turns a 0/1 recovery id into 27/28", () => {
    const sig = vectors.back.signature as Hex;
    const v = Number.parseInt(sig.slice(130), 16);
    const zeroBased = `${sig.slice(0, 130)}0${v - 27}` as Hex;
    expect(normalizeSignature(zeroBased)).toBe(sig);
    expect(normalizeSignature(sig)).toBe(sig);
  });

  it("sets the signature deadline ten minutes ahead", () => {
    expect(signatureDeadline(1_790_600_000_500)).toBe(1_790_600_600n);
  });
});
