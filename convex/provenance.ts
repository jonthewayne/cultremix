import { v } from "convex/values";
import {
  CHAIN_ENVIRONMENTS,
  MONAD_MAINNET,
  MONAD_TESTNET,
  explorerAddressUrl,
  explorerNetwork,
  explorerTxUrl,
} from "../shared/config/chains";
import { query } from "./_generated/server";
import { deploymentEnv } from "./deployment";
import { provenanceStatusValidator } from "./schema/chain";

// A published work's onchain registration, for its page: queued, sent, or confirmed with a
// link to the transaction on the explorer.

export function deploymentChainId() {
  const env = process.env.DEPLOYMENT_ENV?.trim();
  return env === "dev" || env === "staging" || env === "prod" ? CHAIN_ENVIRONMENTS[env].network.chainId : null;
}

// The explorer page for a transaction on this chain, or null when there's none to link to (no
// hash yet, an unknown chain, or a dev deployment on a local node). The work page, the family
// tree, and the lineage trail all link through this.
export function explorerTxLink(chainId: number | null, txHash: string | null | undefined) {
  const explorer = chainId === null ? null : explorerNetwork(process.env, chainId);
  return explorer && txHash ? explorerTxUrl(explorer, txHash) : null;
}

export const forWork = query({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      status: provenanceStatusValidator,
      networkName: v.string(),
      txHash: v.union(v.null(), v.string()),
      txUrl: v.union(v.null(), v.string()),
      confirmedAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published" || !work.provenanceStatus) return null;
    const write = work.chainWriteId ? await ctx.db.get("chainWrites", work.chainWriteId) : null;
    const chainId = write?.chainId ?? deploymentChainId();
    const network = [MONAD_TESTNET, MONAD_MAINNET].find((candidate) => candidate.chainId === chainId);
    const txHash = work.chainTxHash ?? write?.txHash ?? null;
    return {
      status: work.provenanceStatus,
      networkName: network?.name ?? "Monad",
      txHash,
      txUrl: explorerTxLink(chainId, txHash),
      confirmedAt: work.provenanceConfirmedAt ?? null,
    };
  },
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

// This environment's registry, for /onchain: the committed address (a dev deployment may point
// at its own registry with CHAIN_REGISTRY_ADDRESS), or null until it's deployed. Public.
export const registry = query({
  args: {},
  returns: v.object({
    networkName: v.string(),
    testnet: v.boolean(),
    address: v.union(v.null(), v.string()),
    addressUrl: v.union(v.null(), v.string()),
    explorerUrl: v.union(v.null(), v.string()),
  }),
  handler: () => {
    const env = deploymentEnv();
    const settings = CHAIN_ENVIRONMENTS[env];
    const override = process.env.CHAIN_REGISTRY_ADDRESS?.trim();
    const address = env === "dev" && override && ADDRESS.test(override) ? override : settings.registryAddress;
    const explorer = explorerNetwork(process.env, settings.network.chainId);
    return {
      networkName: settings.network.name,
      testnet: settings.network.testnet,
      address,
      addressUrl: explorer && address ? explorerAddressUrl(explorer, address) : null,
      explorerUrl: explorer?.explorerUrl ?? null,
    };
  },
});
