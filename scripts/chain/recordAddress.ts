// Records a deployed registry's address as CHAIN_ENVIRONMENTS.<env>.registryAddress in
// shared/config/chains.ts, so nobody copies a 42-character address by hand. Only that environment's
// block changes; an address already recorded there is kept, and a different one is refused.
import { getAddress } from "viem";
import type { Address } from "viem";

export type RecordResult = { source: string; changed: boolean };

export function recordRegistryAddress(source: string, env: "dev" | "staging" | "prod", address: Address): RecordResult {
  const checksummed = getAddress(address);
  const open = source.indexOf("\n  " + env + ": {\n");
  if (open < 0) throw new Error("No " + env + " block in CHAIN_ENVIRONMENTS.");
  const close = source.indexOf("\n  },", open);
  if (close < 0) throw new Error("The " + env + " block in CHAIN_ENVIRONMENTS doesn't end where expected.");
  const block = source.slice(open, close);
  const line = /\n {4}registryAddress: (null|"(0x[0-9a-fA-F]{40})"),/u.exec(block);
  if (!line) throw new Error("No registryAddress line in the " + env + " block.");
  if (line[2]) {
    if (getAddress(line[2]) === checksummed) return { source, changed: false };
    throw new Error("CHAIN_ENVIRONMENTS." + env + ".registryAddress is already " + line[2] + ". Change it by hand if this deploy replaces it.");
  }
  const updated = block.replace(line[0], '\n    registryAddress: "' + checksummed + '",');
  return { source: source.slice(0, open) + updated + source.slice(close), changed: true };
}
