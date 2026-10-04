import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeErrorResult, encodeEventTopics, keccak256, toHex, type Hex, type Log } from "viem";
import { registryAbi } from "../../convex/lib/chain/abi";
import {
  decodeRegistryCall,
  decodeRegistryRevert,
  encodeAmendLineage,
  encodeBack,
  encodeRegisterEconomicConfig,
  encodeRegisterWork,
  revertHandling,
} from "../../convex/lib/chain/calldata";
import { findBacked, findWorkRegistered } from "../../convex/lib/chain/events";
import {
  ZERO_BYTES32,
  configHashFor,
  contentHashFor,
  registerWorkMessage,
  uriHashFor,
  workIdFor,
  workUri,
} from "../../convex/lib/chain/ids";
import { ECONOMIC_CONFIG_V1, canonicalConfigJson } from "../../convex/lib/economics";

const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CREATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const SIG = `0x${"11".repeat(64)}1b` as Hex;

describe("work mapping", () => {
  it("derives a stable workId from the Convex ID", () => {
    expect(workIdFor("k17abc")).toBe(keccak256(toHex("cultremix:work:k17abc")));
    expect(workIdFor("k17abc")).not.toBe(workIdFor("k17abd"));
  });

  it("uses the print file SHA-256 as the content hash", () => {
    expect(contentHashFor(SHA)).toBe(`0x${SHA}`);
    expect(contentHashFor(`0x${SHA.toUpperCase()}`)).toBe(`0x${SHA}`);
    expect(() => contentHashFor("abc")).toThrow(/SHA-256/);
  });

  it("hashes the work page URL", () => {
    expect(workUri("https://cultremix.com/", 101, 2)).toBe("https://cultremix.com/cr/101-002");
    expect(uriHashFor("https://cultremix.com/cr/101-002")).toBe(keccak256(toHex("https://cultremix.com/cr/101-002")));
  });

  it("builds a variation's message with its parent's workId", () => {
    const { message, uri } = registerWorkMessage({
      work: { convexWorkId: "child", crFamily: 101, crExpression: 2, kind: "variation", parentConvexWorkId: "root", contentHash: SHA },
      creator: CREATOR,
      siteOrigin: "https://cultremix.com",
      deadline: 1790600000n,
    });
    expect(uri).toBe("https://cultremix.com/cr/101-002");
    expect(message).toEqual({
      workId: workIdFor("child"),
      family: 101n,
      expression: 2,
      kind: 1,
      parentId: workIdFor("root"),
      contentHash: `0x${SHA}`,
      uriHash: uriHashFor(uri),
      creator: CREATOR,
      deadline: 1790600000n,
    });
  });

  it("gives an original a zero parent and refuses a parent mismatch", () => {
    const base = { convexWorkId: "w", crFamily: 102, crExpression: 1, contentHash: SHA };
    const args = { creator: CREATOR, siteOrigin: "https://cultremix.com", deadline: 1n } as const;
    expect(registerWorkMessage({ ...args, work: { ...base, kind: "original" } }).message.parentId).toBe(ZERO_BYTES32);
    expect(() => registerWorkMessage({ ...args, work: { ...base, kind: "original", parentConvexWorkId: "p" } })).toThrow();
    expect(() => registerWorkMessage({ ...args, work: { ...base, kind: "fork" } })).toThrow();
  });

  it("hashes the canonical economic config with SHA-256", async () => {
    const json = canonicalConfigJson(ECONOMIC_CONFIG_V1);
    const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)));
    expect(configHashFor(json)).toBe(toHex(expected));
  });
});

describe("calldata", () => {
  const { message } = registerWorkMessage({
    work: { convexWorkId: "w", crFamily: 101, crExpression: 1, kind: "original", contentHash: SHA },
    creator: CREATOR,
    siteOrigin: "https://cultremix.com",
    deadline: 1790600000n,
  });

  it("round-trips all four writes", () => {
    const register = decodeRegistryCall(encodeRegisterWork(message, SIG));
    expect(register.functionName).toBe("registerWork");
    expect(register.args).toEqual([message, SIG]);

    const backMsg = { workId: message.workId, backer: CREATOR, deadline: 5n } as const;
    expect(decodeRegistryCall(encodeBack(backMsg, SIG)).args).toEqual([backMsg, SIG]);

    const amend = { workId: message.workId, newParentId: ZERO_BYTES32, newKind: 0, reasonHash: keccak256("0x01"), sequence: 1n };
    expect(decodeRegistryCall(encodeAmendLineage(amend)).args).toEqual([
      amend.workId,
      amend.newParentId,
      amend.newKind,
      amend.reasonHash,
      amend.sequence,
    ]);

    const config = decodeRegistryCall(encodeRegisterEconomicConfig(1n, `0x${SHA}`));
    expect(config.functionName).toBe("registerEconomicConfig");
    expect(config.args).toEqual([1n, `0x${SHA}`]);
  });

  it("decodes registry errors", () => {
    expect(decodeRegistryRevert(encodeErrorResult({ abi: registryAbi, errorName: "WeeklyBackLimit" }))).toBe("WeeklyBackLimit");
    expect(decodeRegistryRevert("0x")).toBeNull();
    expect(decodeRegistryRevert("0xdeadbeef")).toBeNull();
    expect(decodeRegistryRevert(undefined)).toBeNull();
  });

  it("maps each revert to its handling", () => {
    expect(revertHandling("registerWork", "WorkAlreadyRegistered")).toBe("reconcile");
    expect(revertHandling("registerWork", "ExpressionTaken")).toBe("reconcile");
    expect(revertHandling("registerWork", "SignatureExpired")).toBe("resign");
    expect(revertHandling("registerWork", "ParentNotRegistered")).toBe("failed");
    expect(revertHandling("back", "AlreadyBacked")).toBe("reconcile");
    expect(revertHandling("back", "WeeklyBackLimit")).toBe("rejected");
    expect(revertHandling("back", "SelfBack")).toBe("rejected");
    expect(revertHandling("back", "SignatureExpired")).toBe("resign");
    expect(revertHandling("amendLineage", "InvalidSequence")).toBe("reconcile");
    expect(revertHandling("amendLineage", "LineageCycle")).toBe("rejected");
    expect(revertHandling("registerEconomicConfig", "InvalidConfigVersion")).toBe("reconcile");
    expect(revertHandling("registerEconomicConfig", null)).toBe("failed");
  });
});

describe("events", () => {
  function log(eventName: "WorkRegistered" | "Backed", args: Record<string, unknown>, data: Hex, address: Hex = REGISTRY): Log {
    const topics = encodeEventTopics({ abi: registryAbi, eventName, args } as never) as [Hex, ...Array<Hex>];
    return { address, topics, data, blockHash: null, blockNumber: null, logIndex: 0, transactionHash: null, transactionIndex: 0, removed: false };
  }

  it("reads the ordinal and week from Backed", () => {
    const workId = workIdFor("w");
    const backed = log("Backed", { workId, backer: CREATOR }, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [7n, 2n]));
    expect(findBacked([backed], REGISTRY, workId, CREATOR)).toEqual({ ordinal: 7n, week: 2n });
    expect(findBacked([backed], REGISTRY, workIdFor("other"), CREATOR)).toBeNull();
  });

  it("ignores logs from another contract", () => {
    const workId = workIdFor("w");
    const data = encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
      [101n, 1, 0, `0x${SHA}`, ZERO_BYTES32],
    );
    const own = log("WorkRegistered", { workId, creator: CREATOR, parentId: ZERO_BYTES32 }, data);
    const foreign = log("WorkRegistered", { workId, creator: CREATOR, parentId: ZERO_BYTES32 }, data, "0x0000000000000000000000000000000000000bad");
    expect(findWorkRegistered([foreign], REGISTRY, workId)).toBeNull();
    expect(findWorkRegistered([own], REGISTRY, workId)?.family).toBe(101n);
  });
});
