import { v } from "convex/values";
import { query } from "./_generated/server";
import { CHAIN_ENVIRONMENTS, MONAD_MAINNET, MONAD_TESTNET, explorerNetwork, explorerTxUrl } from "../shared/config/chains";
import { provenanceStatusValidator } from "./schema/chain";

// A published work's onchain registration, for its page: queued, sent, or confirmed with a
// link to the transaction on the explorer.

function deploymentChainId() {
  const env = process.env.DEPLOYMENT_ENV?.trim();
  return env === "dev" || env === "staging" || env === "prod" ? CHAIN_ENVIRONMENTS[env].network.chainId : null;
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
    const explorer = chainId === null ? null : explorerNetwork(process.env, chainId);
    return {
      status: work.provenanceStatus,
      networkName: network?.name ?? "Monad",
      txHash,
      txUrl: explorer && txHash ? explorerTxUrl(explorer, txHash) : null,
      confirmedAt: work.provenanceConfirmedAt ?? null,
    };
  },
});
