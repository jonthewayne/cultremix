// The external clients chain work uses (Circle over fetch, Monad over JSON-RPC), in one place so
// tests can replace them. Production code always calls chainDeps().
import { viemRpc } from "./rpc";
import type { ChainRpc } from "./rpc";
import type { FetchLike } from "../circle";

export type ChainDeps = {
  fetch: FetchLike;
  rpc: (rpcUrl: string) => ChainRpc;
};

const defaults: ChainDeps = {
  fetch: (input, init) => fetch(input, init),
  rpc: (rpcUrl) => viemRpc(rpcUrl),
};

let overrides: Partial<ChainDeps> = {};

export function chainDeps(): ChainDeps {
  return { ...defaults, ...overrides };
}

/** Tests only. Pass null to restore the real clients. */
export function setChainDepsForTests(next: Partial<ChainDeps> | null) {
  overrides = next ?? {};
}
