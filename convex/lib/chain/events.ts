// Registry events from transaction receipts. Only logs emitted by this environment's registry
// count; a log from any other address is ignored.
import { parseEventLogs } from "viem";
import { registryAbi } from "./abi";
import type { Address, Hex, Log } from "viem";

export function decodeRegistryEvents(logs: Array<Log>, registryAddress: Address) {
  const own = logs.filter((log) => log.address.toLowerCase() === registryAddress.toLowerCase());
  return parseEventLogs({ abi: registryAbi, logs: own });
}

type RegistryEvent = ReturnType<typeof decodeRegistryEvents>[number];

function sameHex(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function findWorkRegistered(logs: Array<Log>, registryAddress: Address, workId: Hex) {
  const event = decodeRegistryEvents(logs, registryAddress).find(
    (e): e is Extract<RegistryEvent, { eventName: "WorkRegistered" }> =>
      e.eventName === "WorkRegistered" && sameHex(e.args.workId, workId),
  );
  return event?.args ?? null;
}

export function findBacked(logs: Array<Log>, registryAddress: Address, workId: Hex, backer: Address) {
  const event = decodeRegistryEvents(logs, registryAddress).find(
    (e): e is Extract<RegistryEvent, { eventName: "Backed" }> =>
      e.eventName === "Backed" && sameHex(e.args.workId, workId) && sameHex(e.args.backer, backer),
  );
  return event ? { ordinal: event.args.ordinal, week: event.args.week } : null;
}

export function findLineageAmended(logs: Array<Log>, registryAddress: Address, workId: Hex, sequence: bigint) {
  const event = decodeRegistryEvents(logs, registryAddress).find(
    (e): e is Extract<RegistryEvent, { eventName: "LineageAmended" }> =>
      e.eventName === "LineageAmended" && sameHex(e.args.workId, workId) && e.args.sequence === sequence,
  );
  return event?.args ?? null;
}

export function findEconomicConfigRegistered(logs: Array<Log>, registryAddress: Address, version: bigint) {
  const event = decodeRegistryEvents(logs, registryAddress).find(
    (e): e is Extract<RegistryEvent, { eventName: "EconomicConfigRegistered" }> =>
      e.eventName === "EconomicConfigRegistered" && e.args.version === version,
  );
  return event?.args ?? null;
}
