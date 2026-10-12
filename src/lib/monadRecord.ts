// Reads a design's record straight from Monad's public RPC in the browser, so anyone can check a
// fingerprint against the chain without trusting CultRemix's servers (/onchain's file check). Two
// eth_calls on the registry: workIdAt(family, expression) for the design's ID, then getWork(id),
// whose Work struct is eight static 32-byte words. Plain fetch, no chain library, to keep it small;
// tests/unit/monadRecord.test.ts checks the selectors and the decoding against viem, and the anvil
// test reads a real registration with it.

// toFunctionSelector("workIdAt(uint64,uint32)") and toFunctionSelector("getWork(bytes32)").
export const WORK_ID_AT_SELECTOR = "0x91b0b73e";
export const GET_WORK_SELECTOR = "0x30266537";

const ZERO_WORD = "0".repeat(64);

export type MonadRecord = {
  workId: string;
  creator: string;
  // The design's SHA-256, lowercase hex without 0x, as the work page shows it.
  contentHash: string;
  // kind: 0 original, 1 variation, 2 fork.
  kind: number;
  registeredAt: number;
};

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

export function workIdAtCalldata(family: number, expression: number) {
  return WORK_ID_AT_SELECTOR + word(BigInt(family)) + word(BigInt(expression));
}

export function getWorkCalldata(workId: string) {
  return GET_WORK_SELECTOR + workId.replace(/^0x/u, "").padStart(64, "0");
}

// The Work struct (creator, family, expression, kind, registeredAt, parentId, contentHash, uriHash),
// or null for an empty record (getWork returns zeros for an unknown ID).
export function decodeWork(workId: string, result: string): MonadRecord | null {
  const data = result.replace(/^0x/u, "");
  if (data.length < 64 * 8) return null;
  const at = (i: number) => data.slice(i * 64, (i + 1) * 64);
  if (at(0) === ZERO_WORD) return null;
  return {
    workId,
    creator: `0x${at(0).slice(24)}`,
    kind: Number(BigInt(`0x${at(3)}`)),
    registeredAt: Number(BigInt(`0x${at(4)}`)),
    contentHash: at(6),
  };
}

async function ethCall(rpcUrl: string, to: string, data: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`Monad's RPC answered ${response.status}.`);
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error || typeof body.result !== "string") throw new Error(body.error?.message ?? "Monad's RPC gave no result.");
  return body.result;
}

// Lowercase hex of a digest, as fingerprints are shown.
export function hexOf(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// "101-002" as the registry's family and expression.
export function crParts(cr: string) {
  const [family, expression] = cr.split("-").map(Number);
  return { family, expression };
}

// The record for CR <family>-<expression>, or null when the registry has none.
export async function readMonadRecord(
  args: { rpcUrl: string; registry: string; family: number; expression: number },
  fetchImpl: typeof fetch = fetch,
): Promise<MonadRecord | null> {
  const idResult = await ethCall(args.rpcUrl, args.registry, workIdAtCalldata(args.family, args.expression), fetchImpl);
  const workId = idResult.replace(/^0x/u, "").padStart(64, "0").slice(-64);
  if (workId === ZERO_WORD) return null;
  return decodeWork(`0x${workId}`, await ethCall(args.rpcUrl, args.registry, getWorkCalldata(workId), fetchImpl));
}
