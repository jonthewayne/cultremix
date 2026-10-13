import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordRegistryAddress } from "../../scripts/chain/recordAddress";

// The registry deploy records its address in shared/config/chains.ts (scripts/chain/recordAddress.ts).
// The real file records the deployed registries, so these tests start from a copy with none recorded.
const CHAINS = readFileSync(new URL("../../shared/config/chains.ts", import.meta.url), "utf8").replace(
  /registryAddress: "0x[0-9a-fA-F]{40}"/gu,
  "registryAddress: null",
);
const ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const CHECKSUMMED = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function blockOf(source: string, env: string) {
  const open = source.indexOf("\n  " + env + ": {\n");
  return source.slice(open, source.indexOf("\n  },", open));
}

describe("recording a deployed registry", () => {
  it("writes the checksummed address into that environment's block only", () => {
    const { source, changed } = recordRegistryAddress(CHAINS, "prod", ADDRESS);
    expect(changed).toBe(true);
    expect(blockOf(source, "prod")).toContain('registryAddress: "' + CHECKSUMMED + '",');
    expect(blockOf(source, "dev")).toBe(blockOf(CHAINS, "dev"));
    expect(blockOf(source, "staging")).toBe(blockOf(CHAINS, "staging"));
    // Everything else, the relayer address and comments included, is unchanged.
    expect(source.replace('"' + CHECKSUMMED + '"', "null")).toBe(CHAINS);
  });

  it("keeps the same address, and refuses a different one", () => {
    const once = recordRegistryAddress(CHAINS, "dev", ADDRESS).source;
    expect(recordRegistryAddress(once, "dev", CHECKSUMMED)).toEqual({ source: once, changed: false });
    expect(() => recordRegistryAddress(once, "dev", "0x0000000000000000000000000000000000000001")).toThrow(/already/);
  });

  it("refuses an address that isn't one", () => {
    expect(() => recordRegistryAddress(CHAINS, "prod", "0x123")).toThrow();
  });
});
