// The Monad JSON-RPC calls the relayer makes, behind one small interface so tests can run the
// chain-write engine against an in-memory chain. The viem implementation runs in the default
// Convex runtime.
import {
  BaseError,
  createPublicClient,
  http,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type Log,
} from "viem";
import type { FetchLike } from "../circle";

export type BlockTag = "latest" | "finalized";
export type BlockRef = BlockTag | bigint;

export type ChainBlock = { number: bigint; hash: Hex; timestamp: bigint };

export type ChainReceipt = {
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  logs: Array<Log>;
};

export type Reverted = { ok: false; revertData: Hex | null; message: string };
export type CallResult = { ok: true; data: Hex } | Reverted;
export type GasEstimate = { ok: true; gas: bigint } | Reverted;
export type FeeEstimate = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export type CallRequest = { from: Address; to: Address; data: Hex };

export interface ChainRpc {
  getChainId(): Promise<number>;
  getBlock(ref: BlockRef): Promise<ChainBlock>;
  getTransactionReceipt(hash: Hex): Promise<ChainReceipt | null>;
  getTransactionCount(address: Address, tag: BlockTag): Promise<number>;
  /** A revert comes back as { ok: false }; transport failures throw. */
  estimateGas(request: CallRequest): Promise<GasEstimate>;
  call(request: CallRequest, at: BlockRef): Promise<CallResult>;
  estimateFees(): Promise<FeeEstimate>;
  getBalance(address: Address): Promise<bigint>;
  /** Resolves to the transaction hash; node refusals ("nonce too low", …) throw. */
  sendRawTransaction(raw: Hex): Promise<Hex>;
}

/** Revert data in a viem error, or undefined when the error wasn't a revert. */
export function revertOf(error: unknown): Reverted | undefined {
  if (!(error instanceof BaseError)) return undefined;
  let revertData: Hex | null = null;
  error.walk((e) => {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]*$/u.test(data)) revertData = data as Hex;
    else if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      revertData = (data as { data: Hex }).data;
    }
    return false;
  });
  const reverted = revertData !== null || /revert/iu.test(error.message);
  return reverted ? { ok: false, revertData, message: error.shortMessage } : undefined;
}

export function viemRpc(rpcUrl: string, fetchImpl?: FetchLike): ChainRpc {
  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 1, timeout: 15_000, ...(fetchImpl ? { fetchFn: fetchImpl as typeof fetch } : {}) }),
  });
  return {
    getChainId: () => client.getChainId(),
    async getBlock(ref) {
      const block = typeof ref === "bigint" ? await client.getBlock({ blockNumber: ref }) : await client.getBlock({ blockTag: ref });
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    },
    async getTransactionReceipt(hash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          logs: receipt.logs,
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    getTransactionCount: (address, tag) => client.getTransactionCount({ address, blockTag: tag }),
    async estimateGas(request) {
      try {
        return { ok: true, gas: await client.estimateGas({ account: request.from, to: request.to, data: request.data }) };
      } catch (error) {
        const reverted = revertOf(error);
        if (reverted) return reverted;
        throw error;
      }
    },
    async call(request, at) {
      try {
        const where = typeof at === "bigint" ? { blockNumber: at } : { blockTag: at };
        const result = await client.call({ account: request.from, to: request.to, data: request.data, ...where });
        return { ok: true, data: result.data ?? "0x" };
      } catch (error) {
        const reverted = revertOf(error);
        if (reverted) return reverted;
        throw error;
      }
    },
    async estimateFees() {
      const fees = await client.estimateFeesPerGas({ type: "eip1559", chain: undefined });
      return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    },
    getBalance: (address) => client.getBalance({ address }),
    sendRawTransaction: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
  };
}
