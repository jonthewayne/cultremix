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
import { imageUrlReader } from "./lib/imageUrls";
import { formatCr } from "./lib/r2";
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
      // Whether this deployment's registry is deployed: a queued record before then waits for it.
      registryLive: v.boolean(),
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
      registryLive: registryAddressHere() !== null,
    };
  },
});

const FINGERPRINT = /^[0-9a-f]{64}$/u;

// /onchain's check: the published design whose original file has this SHA-256 (hex, with or
// without 0x). Null when no published design has it; kept designs are never found here.
export const byFingerprint = query({
  args: { contentHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      workId: v.id("works"),
      cr: v.string(),
      title: v.optional(v.string()),
      creator: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      thumbUrl: v.optional(v.string()),
      kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
    }),
  ),
  handler: async (ctx, args) => {
    const hash = args.contentHash.trim().toLowerCase().replace(/^0x/u, "");
    if (!FINGERPRINT.test(hash)) return null;
    const works = await ctx.db
      .query("works")
      .withIndex("by_contentHash", (q) => q.eq("contentHash", hash))
      .take(10);
    // The first published one: the same file published twice is the earlier design.
    const work = works
      .filter((candidate) => candidate.status === "published")
      .sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))[0];
    if (!work) return null;
    const creator = await ctx.db.get("users", work.creatorId);
    const art = await imageUrlReader(ctx)(work.artKey);
    return {
      workId: work._id,
      cr: formatCr(work.crFamily, work.crExpression),
      title: work.title,
      creator: creator?.username,
      publishedAt: work.publishedAt,
      thumbUrl: art.thumbUrl,
      kind: work.kind,
    };
  },
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

// This deployment's registry: the committed address, or on dev the one CHAIN_REGISTRY_ADDRESS
// points at; null until it's deployed.
function registryAddressHere() {
  const env = deploymentEnv();
  const override = process.env.CHAIN_REGISTRY_ADDRESS?.trim();
  return env === "dev" && override && ADDRESS.test(override) ? override : CHAIN_ENVIRONMENTS[env].registryAddress;
}

// How many designs /onchain lists under Latest records, and how many confirmed writes it reads to
// find them (Backs, corrections, and designs no longer published are skipped).
const RECENT_RECORDS = 8;
const RECENT_SCAN = 60;

// The designs most recently recorded on Monad, newest first, for /onchain: each one's CR number
// and its transaction on the explorer. Only published designs: a kept or taken-down design's
// record stays on the chain but isn't listed here. Public.
export const recent = query({
  args: {},
  returns: v.array(
    v.object({
      cr: v.string(),
      title: v.optional(v.string()),
      thumbUrl: v.optional(v.string()),
      txUrl: v.union(v.null(), v.string()),
      confirmedAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx) => {
    const writes = await ctx.db
      .query("chainWrites")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "confirmed"))
      .order("desc")
      .take(RECENT_SCAN);
    const urls = imageUrlReader(ctx);
    const out = [];
    for (const write of writes) {
      if (write.kind !== "registerWork" || !write.workId) continue;
      const work = await ctx.db.get("works", write.workId);
      if (!work || work.status !== "published") continue;
      out.push({
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title,
        thumbUrl: (await urls(work.artKey)).thumbUrl,
        txUrl: explorerTxLink(write.chainId ?? deploymentChainId(), work.chainTxHash ?? write.txHash),
        confirmedAt: work.provenanceConfirmedAt ?? null,
      });
      if (out.length === RECENT_RECORDS) break;
    }
    return out;
  },
});

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
    // The network's public RPC, for checking a record from the browser. Never MONAD_RPC_URL, which
    // may carry a provider's key.
    publicRpcUrl: v.string(),
  }),
  handler: () => {
    const settings = CHAIN_ENVIRONMENTS[deploymentEnv()];
    const address = registryAddressHere();
    const explorer = explorerNetwork(process.env, settings.network.chainId);
    return {
      networkName: settings.network.name,
      testnet: settings.network.testnet,
      address,
      addressUrl: explorer && address ? explorerAddressUrl(explorer, address) : null,
      explorerUrl: explorer?.explorerUrl ?? null,
      publicRpcUrl: settings.network.rpcUrl,
    };
  },
});
