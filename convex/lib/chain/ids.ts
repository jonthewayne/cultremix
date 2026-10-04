// How a Convex work maps to its registry record.
//
//   workId       keccak256("cultremix:work:" + the Convex work ID)
//   contentHash  the work's print file SHA-256 (works.contentHash), as bytes32
//   uriHash      keccak256 of the work page URL, `${SITE_URL}/cr/101-002`
//   parentId     the parent work's workId, or zero for an original
import { keccak256, sha256, toHex, type Address, type Hex } from "viem";
import type { RegisterWorkMessage } from "./eip712";

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

export const KIND_CODES = { original: 0, variation: 1, fork: 2 } as const;
export type WorkKind = keyof typeof KIND_CODES;

export function workIdFor(convexWorkId: string): Hex {
  return keccak256(toHex(`cultremix:work:${convexWorkId}`));
}

export function contentHashFor(sha256Hex: string): Hex {
  const hex = sha256Hex.trim().toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{64}$/u.test(hex)) throw new Error("A work's contentHash must be a SHA-256 hex digest.");
  return `0x${hex}`;
}

// Same label as formatCr in convex/lib/r2.ts (kept here so this module has no Convex imports).
function crLabel(family: number, expression: number) {
  return `${family}-${String(expression).padStart(3, "0")}`;
}

export function workUri(siteOrigin: string, family: number, expression: number): string {
  return `${siteOrigin.replace(/\/+$/u, "")}/cr/${crLabel(family, expression)}`;
}

export function uriHashFor(uri: string): Hex {
  return keccak256(toHex(uri));
}

/** Hash of a lineage correction's written reason, recorded with the amendment. */
export function reasonHashFor(reason: string): Hex {
  return keccak256(toHex(reason));
}

/** SHA-256 of an economic config's canonical JSON (canonicalConfigJson). */
export function configHashFor(canonicalJson: string): Hex {
  return sha256(toHex(canonicalJson));
}

export type WorkForChain = {
  convexWorkId: string;
  crFamily: number;
  crExpression: number;
  kind: WorkKind;
  parentConvexWorkId?: string;
  contentHash: string;
};

export function registerWorkMessage(args: {
  work: WorkForChain;
  creator: Address;
  siteOrigin: string;
  deadline: bigint;
}): { message: RegisterWorkMessage; uri: string } {
  const { work } = args;
  if (work.kind === "original" ? work.parentConvexWorkId !== undefined : work.parentConvexWorkId === undefined) {
    throw new Error(`A ${work.kind} ${work.kind === "original" ? "has no" : "needs a"} parent.`);
  }
  const uri = workUri(args.siteOrigin, work.crFamily, work.crExpression);
  return {
    uri,
    message: {
      workId: workIdFor(work.convexWorkId),
      family: BigInt(work.crFamily),
      expression: work.crExpression,
      kind: KIND_CODES[work.kind],
      parentId: work.parentConvexWorkId ? workIdFor(work.parentConvexWorkId) : ZERO_BYTES32,
      contentHash: contentHashFor(work.contentHash),
      uriHash: uriHashFor(uri),
      creator: args.creator,
      deadline: args.deadline,
    },
  };
}
