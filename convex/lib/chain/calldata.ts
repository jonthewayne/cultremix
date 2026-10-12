// Calldata for the four registry writes, and revert decoding.
import { decodeErrorResult, decodeFunctionData, encodeFunctionData } from "viem";
import { registryAbi } from "./abi";
import type { Hex } from "viem";
import type { BackMessage, RegisterWorkMessage } from "./eip712";

export type ChainWriteKind = "registerWork" | "back" | "amendLineage" | "registerEconomicConfig";

export function encodeRegisterWork(message: RegisterWorkMessage, signature: Hex): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "registerWork", args: [message, signature] });
}

export function encodeBack(message: BackMessage, signature: Hex): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "back", args: [message, signature] });
}

export type AmendLineageArgs = {
  workId: Hex;
  newParentId: Hex;
  newKind: number;
  reasonHash: Hex;
  sequence: bigint;
};

export function encodeAmendLineage(args: AmendLineageArgs): Hex {
  return encodeFunctionData({
    abi: registryAbi,
    functionName: "amendLineage",
    args: [args.workId, args.newParentId, args.newKind, args.reasonHash, args.sequence],
  });
}

export function encodeRegisterEconomicConfig(version: bigint, configHash: Hex): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "registerEconomicConfig", args: [version, configHash] });
}

export function decodeRegistryCall(data: Hex) {
  return decodeFunctionData({ abi: registryAbi, data });
}

export type RegistryErrorName = Extract<(typeof registryAbi)[number], { type: "error" }>["name"];

/** The registry error name in revert data, or null when the data is not a registry error. */
export function decodeRegistryRevert(data: Hex | undefined | null): RegistryErrorName | null {
  if (!data || data === "0x") return null;
  try {
    return decodeErrorResult({ abi: registryAbi, data }).errorName;
  } catch {
    return null;
  }
}

// What a finalized revert means for each write ("Chain write outcomes"):
//   reconcile  the record may already exist (our own earlier transaction, or a replay):
//              read contract state at the finalized tag; confirmed if it matches, else failed
//   resign     the member's signature expired before inclusion: sign again, new transaction
//   rejected   a rule refused it (Back limit, self-Back): final, and a Back's slot is released
//   failed     anything else; an admin can retry
export type RevertHandling = "reconcile" | "resign" | "rejected" | "failed";

export function revertHandling(kind: ChainWriteKind, error: RegistryErrorName | null): RevertHandling {
  if (error === "SignatureExpired") return kind === "registerWork" || kind === "back" ? "resign" : "failed";
  switch (kind) {
    case "registerWork":
      return error === "WorkAlreadyRegistered" || error === "ExpressionTaken" || error === "FamilyTaken"
        ? "reconcile"
        : "failed";
    case "back":
      if (error === "AlreadyBacked") return "reconcile";
      return error === "WeeklyBackLimit" || error === "SelfBack" ? "rejected" : "failed";
    case "amendLineage":
      if (error === "InvalidSequence") return "reconcile";
      return error === "LineageCycle" ||
        error === "LineageTooDeep" ||
        error === "KindChangeNotAllowed" ||
        error === "FamilyMismatch" ||
        error === "ParentNotAllowed" ||
        error === "ParentNotRegistered" ||
        error === "WorkNotRegistered" ||
        error === "InvalidKind"
        ? "rejected"
        : "failed";
    case "registerEconomicConfig":
      return error === "InvalidConfigVersion" ? "reconcile" : "failed";
  }
}
