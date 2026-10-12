import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionResult, toFunctionSelector } from "viem";
import { registryAbi } from "../../convex/lib/chain/abi";
import {
  GET_WORK_SELECTOR,
  WORK_ID_AT_SELECTOR,
  decodeWork,
  getWorkCalldata,
  readMonadRecord,
  workIdAtCalldata,
} from "../../src/lib/monadRecord";

const WORK_ID = `0x${"ab".repeat(32)}` as const;
const HASH = "cd".repeat(32);
const work = {
  creator: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  family: 101n,
  expression: 2,
  kind: 1,
  registeredAt: 1_790_600_000n,
  parentId: `0x${"11".repeat(32)}`,
  contentHash: `0x${HASH}`,
  uriHash: `0x${"00".repeat(32)}`,
} as const;

describe("reading a design's Monad record in the browser", () => {
  it("uses the registry's selectors and argument encoding", () => {
    expect(WORK_ID_AT_SELECTOR).toBe(toFunctionSelector("workIdAt(uint64,uint32)"));
    expect(GET_WORK_SELECTOR).toBe(toFunctionSelector("getWork(bytes32)"));
    expect(decodeFunctionData({ abi: registryAbi, data: workIdAtCalldata(101, 2) as `0x${string}` })).toMatchObject({
      functionName: "workIdAt",
      args: [101n, 2],
    });
    expect(decodeFunctionData({ abi: registryAbi, data: getWorkCalldata(WORK_ID) as `0x${string}` })).toMatchObject({
      functionName: "getWork",
      args: [WORK_ID],
    });
  });

  it("decodes getWork's result as viem encodes it, and an empty record as none", () => {
    const result = encodeFunctionResult({ abi: registryAbi, functionName: "getWork", result: work });
    expect(decodeWork(WORK_ID, result)).toEqual({
      workId: WORK_ID,
      creator: work.creator.toLowerCase(),
      kind: 1,
      registeredAt: 1_790_600_000,
      contentHash: HASH,
    });
    expect(decodeWork(WORK_ID, `0x${"0".repeat(64 * 8)}`)).toBeNull();
  });

  it("asks for the ID, then the record, and stops when there's no ID", async () => {
    const calls: Array<string> = [];
    const answer = (result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const data = JSON.parse(String(init?.body)).params[0].data as string;
      calls.push(data.slice(0, 10));
      if (data.startsWith(WORK_ID_AT_SELECTOR)) return answer(WORK_ID);
      return answer(encodeFunctionResult({ abi: registryAbi, functionName: "getWork", result: work }));
    }) as typeof fetch;
    const args = { rpcUrl: "https://rpc.example", registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3", family: 101, expression: 2 };
    expect((await readMonadRecord(args, fetchImpl))?.contentHash).toBe(HASH);
    expect(calls).toEqual([WORK_ID_AT_SELECTOR, GET_WORK_SELECTOR]);
    const none = (async () => answer(`0x${"0".repeat(64)}`)) as unknown as typeof fetch;
    expect(await readMonadRecord(args, none)).toBeNull();
    const broken = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }))) as unknown as typeof fetch;
    await expect(readMonadRecord(args, broken)).rejects.toThrow("execution reverted");
  });
});
