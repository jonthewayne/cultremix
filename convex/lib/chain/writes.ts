// What each chain write sends and how its outcome is read back: calldata, the event in a finalized
// receipt, and the record in finalized contract state (for reconciling a duplicate or a nonce
// consumed elsewhere). No Convex imports; the engine lives in convex/chain.ts.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type Log } from "viem";
import { registryAbi } from "./abi";
import {
  encodeAmendLineage,
  encodeBack,
  encodeRegisterEconomicConfig,
  encodeRegisterWork,
  type AmendLineageArgs,
  type ChainWriteKind,
} from "./calldata";
import type { BackMessage, RegisterWorkMessage } from "./eip712";
import { findBacked, findEconomicConfigRegistered, findLineageAmended, findWorkRegistered } from "./events";
import type { BlockRef, ChainRpc } from "./rpc";

// Payloads without the signature deadline, which changes on every re-sign.
export type RegisterWorkPayload = Omit<RegisterWorkMessage, "deadline">;
export type BackPayload = Omit<BackMessage, "deadline">;
export type AmendLineagePayload = AmendLineageArgs;
export type EconomicConfigPayload = { version: bigint; configHash: Hex };

export type WritePayload =
  | { kind: "registerWork"; record: RegisterWorkPayload }
  | { kind: "back"; record: BackPayload }
  | { kind: "amendLineage"; record: AmendLineagePayload }
  | { kind: "registerEconomicConfig"; record: EconomicConfigPayload };

export type WriteResult = { ordinal: number; week: number };

export function serializePayload(payload: WritePayload["record"]): string {
  return JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

export function parsePayload(kind: ChainWriteKind, json: string): WritePayload {
  const raw = JSON.parse(json) as Record<string, unknown>;
  switch (kind) {
    case "registerWork":
      return {
        kind,
        record: {
          workId: raw.workId as Hex,
          family: BigInt(raw.family as string),
          expression: Number(raw.expression),
          kind: Number(raw.kind),
          parentId: raw.parentId as Hex,
          contentHash: raw.contentHash as Hex,
          uriHash: raw.uriHash as Hex,
          creator: raw.creator as Address,
        },
      };
    case "back":
      return { kind, record: { workId: raw.workId as Hex, backer: raw.backer as Address } };
    case "amendLineage":
      return {
        kind,
        record: {
          workId: raw.workId as Hex,
          newParentId: raw.newParentId as Hex,
          newKind: Number(raw.newKind),
          reasonHash: raw.reasonHash as Hex,
          sequence: BigInt(raw.sequence as string),
        },
      };
    case "registerEconomicConfig":
      return { kind, record: { version: BigInt(raw.version as string), configHash: raw.configHash as Hex } };
  }
}

/** Writes signed by a member's wallet. Amendments and configs are sent by the relayer as admin. */
export function needsMemberSignature(kind: ChainWriteKind) {
  return kind === "registerWork" || kind === "back";
}

export function writeCalldata(payload: WritePayload, signature: Hex | undefined, deadline: bigint | undefined): Hex {
  switch (payload.kind) {
    case "registerWork":
    case "back": {
      if (!signature || deadline === undefined) throw new Error(`A ${payload.kind} write needs the member's signature.`);
      return payload.kind === "registerWork"
        ? encodeRegisterWork({ ...payload.record, deadline }, signature)
        : encodeBack({ ...payload.record, deadline }, signature);
    }
    case "amendLineage":
      return encodeAmendLineage(payload.record);
    case "registerEconomicConfig":
      return encodeRegisterEconomicConfig(payload.record.version, payload.record.configHash);
  }
}

/** The write's event in a successful receipt, or null when it isn't there. */
export function eventOutcome(payload: WritePayload, logs: Array<Log>, registry: Address): { result?: WriteResult } | null {
  switch (payload.kind) {
    case "registerWork":
      return findWorkRegistered(logs, registry, payload.record.workId) ? {} : null;
    case "back": {
      const backed = findBacked(logs, registry, payload.record.workId, payload.record.backer);
      return backed ? { result: { ordinal: Number(backed.ordinal), week: Number(backed.week) } } : null;
    }
    case "amendLineage":
      return findLineageAmended(logs, registry, payload.record.workId, payload.record.sequence) ? {} : null;
    case "registerEconomicConfig":
      return findEconomicConfigRegistered(logs, registry, payload.record.version) ? {} : null;
  }
}

function sameHex(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

type ReadFunction =
  | "getWork"
  | "backOrdinal"
  | "amendmentCount"
  | "economicConfigHash"
  | "isRelayer"
  | "admin";

export async function readRegistry(
  rpc: ChainRpc,
  registry: Address,
  from: Address,
  functionName: ReadFunction,
  args: ReadonlyArray<unknown>,
  at: BlockRef = "finalized",
) {
  const data = encodeFunctionData({ abi: registryAbi, functionName, args } as never);
  const result = await rpc.call({ from, to: registry, data }, at);
  if (!result.ok) throw new Error(`Registry read ${functionName} reverted.`);
  return decodeFunctionResult({ abi: registryAbi, functionName, data: result.data } as never) as unknown;
}

export type Reconciled =
  // The record is onchain as this write describes it.
  | { state: "match"; result?: WriteResult }
  // Nothing there yet.
  | { state: "missing" }
  // Something else holds the slot.
  | { state: "different"; detail: string };

/**
 * Reads this write's record from finalized contract state (INV-30). A Back's week isn't stored
 * onchain, so a reconciled Back reports ordinal only (week -1); the caller keeps its own week.
 */
export async function reconcileFromState(rpc: ChainRpc, registry: Address, from: Address, payload: WritePayload): Promise<Reconciled> {
  switch (payload.kind) {
    case "registerWork": {
      const record = payload.record;
      const work = (await readRegistry(rpc, registry, from, "getWork", [record.workId])) as {
        creator: Address;
        family: bigint;
        expression: number;
        contentHash: Hex;
        uriHash: Hex;
      };
      if (/^0x0{40}$/u.test(work.creator)) return { state: "missing" };
      const matches =
        sameHex(work.creator, record.creator) &&
        work.family === record.family &&
        Number(work.expression) === record.expression &&
        sameHex(work.contentHash, record.contentHash) &&
        sameHex(work.uriHash, record.uriHash);
      return matches ? { state: "match" } : { state: "different", detail: "A different record holds this work ID." };
    }
    case "back": {
      const ordinal = (await readRegistry(rpc, registry, from, "backOrdinal", [payload.record.workId, payload.record.backer])) as bigint;
      return ordinal > 0n ? { state: "match", result: { ordinal: Number(ordinal), week: -1 } } : { state: "missing" };
    }
    case "amendLineage": {
      const record = payload.record;
      const count = (await readRegistry(rpc, registry, from, "amendmentCount", [record.workId])) as bigint;
      if (count < record.sequence) return { state: "missing" };
      if (count > record.sequence) return { state: "match" };
      const work = (await readRegistry(rpc, registry, from, "getWork", [record.workId])) as { kind: number; parentId: Hex };
      return Number(work.kind) === record.newKind && sameHex(work.parentId, record.newParentId)
        ? { state: "match" }
        : { state: "different", detail: `Amendment ${record.sequence} onchain has a different lineage.` };
    }
    case "registerEconomicConfig": {
      const hash = (await readRegistry(rpc, registry, from, "economicConfigHash", [payload.record.version])) as Hex;
      if (/^0x0{64}$/u.test(hash)) return { state: "missing" };
      return sameHex(hash, payload.record.configHash)
        ? { state: "match" }
        : { state: "different", detail: `Config version ${payload.record.version} is registered with another hash.` };
    }
  }
}

// Fee replacement: +20% over the previous transaction, and never below the current estimate.
export const FEE_BUMP_BPS = 12_000n;
export const MAX_REPLACEMENTS = 3;
export const INCLUSION_BLOCKS = 30;

export function bumpedFees(
  previous: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  current: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
) {
  const bump = (value: bigint) => (value * FEE_BUMP_BPS + 9_999n) / 10_000n;
  const maxPriorityFeePerGas = [bump(previous.maxPriorityFeePerGas), current.maxPriorityFeePerGas].reduce((a, b) => (a > b ? a : b));
  const maxFeePerGas = [bump(previous.maxFeePerGas), current.maxFeePerGas, maxPriorityFeePerGas].reduce((a, b) => (a > b ? a : b));
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Monad charges for the gas limit, so the buffer over the estimate stays small. */
export function gasLimitFor(estimate: bigint) {
  return estimate + estimate / 10n + 10_000n;
}

// Registry weeks for the Back limit, as CultRemixRegistry.currentWeek() counts them: whole weeks
// since EPOCH (2026-09-28T00:00Z).
export const REGISTRY_EPOCH_SECONDS = 1_790_553_600;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function registryWeek(nowMs: number) {
  return Math.floor((Math.floor(nowMs / 1000) - REGISTRY_EPOCH_SECONDS) / WEEK_SECONDS);
}
