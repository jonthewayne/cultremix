import { v } from "convex/values";
import { query } from "./_generated/server";
import { canonicalConfigJson, recipientShares } from "./lib/economics";
import { CURRENT_ECONOMIC_CONFIG, economicsConfigPath, sha256Hex } from "./lib/economicsConfigs";
import { LineageError, economicLineage } from "./lib/lineage";
import { toLineageWork, workByCr, worksReader } from "./lineage";
import type { Id } from "./_generated/dataModel";

const roleValidator = v.union(v.literal("creator"), v.literal("family_root"), v.literal("upstream"));

// The work page's Economics panel: who shares in a sale of this work and how much, under the
// current published config (V1 plan U10/KTD-18). Shares are of the creator pool, not the price.
export const panel = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
      configVersion: v.number(),
      creatorPoolBps: v.number(),
      configPath: v.string(),
      configSha256: v.string(),
      // Shares are recorded on Monad once the work's provenance is confirmed there. No works field
      // records that yet, so this is "pending" until the chain builder adds one.
      provenance: v.union(v.literal("pending"), v.literal("confirmed")),
      // Lineage the panel couldn't resolve (a missing ancestor); no shares are shown.
      unavailable: v.boolean(),
      shares: v.array(
        v.object({ username: v.string(), roles: v.array(roleValidator), bps: v.number() }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await workByCr(ctx, args.cr);
    if (!work || work.status !== "published") return null;
    const config = CURRENT_ECONOMIC_CONFIG;
    const reader = worksReader(ctx);
    const base = {
      configVersion: config.version,
      creatorPoolBps: config.creatorPoolBps,
      configPath: economicsConfigPath(config.version),
      configSha256: await sha256Hex(canonicalConfigJson(config)),
      provenance: "pending" as const,
    };
    let lineage;
    try {
      lineage = await economicLineage(toLineageWork(work), reader.load, reader.familyRoot);
    } catch (error) {
      if (!(error instanceof LineageError)) throw error;
      return { ...base, kind: work.effectiveKind ?? work.kind, unavailable: true, shares: [] };
    }
    const shares = await Promise.all(
      recipientShares(lineage, config).map(async (share) => {
        const user = await ctx.db.get("users", share.who as Id<"users">);
        return { username: user?.username ?? "member", roles: share.roles, bps: share.bps };
      }),
    );
    return { ...base, kind: lineage.kind, unavailable: false, shares };
  },
});
