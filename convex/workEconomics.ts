import { v } from "convex/values";
import { query } from "./_generated/server";
import { canonicalConfigJson, recipientShares } from "./lib/economics";
import { CURRENT_ECONOMIC_CONFIG, economicsConfigPath, sha256Hex } from "./lib/economicsConfigs";
import { LineageError, economicLineage } from "./lib/lineage";
import { toLineageWork, workByCr, worksReader } from "./lineage";
import { brandForFamily } from "./brands";
import type { Id } from "./_generated/dataModel";

// The creator pool's roles; affiliate and brand never come from recipientShares, but share its type.
const roleValidator = v.union(
  v.literal("creator"),
  v.literal("family_root"),
  v.literal("upstream"),
  v.literal("affiliate"),
  v.literal("brand"),
);

// The work page's Economics panel: who shares in a sale of this work and how much, under the
// current published config (V1 plan U10/KTD-18). Shares are of the creator pool, not the price;
// from v2 the family's brand and whoever's link brought the buyer get their own cut of the price.
export const panel = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
      configVersion: v.number(),
      creatorPoolBps: v.number(),
      // The member whose link brings a buyer gets this share of the price (null before v2).
      affiliateBps: v.union(v.null(), v.number()),
      // The brand that owns or licenses this design's family, and its share of the price.
      brand: v.union(v.null(), v.object({ name: v.string(), username: v.string(), bps: v.number() })),
      configPath: v.string(),
      configSha256: v.string(),
      // Shares are recorded on Monad once the work's registration is confirmed there
      // (works.provenanceStatus, set by the chain engine in convex/chain.ts).
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
    const familyBrand = config.brandDefaultBps === undefined ? null : await brandForFamily(ctx, work.crFamily);
    const brandUser = familyBrand ? await ctx.db.get("users", familyBrand.userId) : null;
    const base = {
      configVersion: config.version,
      creatorPoolBps: config.creatorPoolBps,
      affiliateBps: config.affiliateBps ?? null,
      brand: familyBrand ? { name: familyBrand.name, username: brandUser?.username ?? "member", bps: familyBrand.bps } : null,
      configPath: economicsConfigPath(config.version),
      configSha256: await sha256Hex(canonicalConfigJson(config)),
      provenance: work.provenanceStatus === "confirmed" ? ("confirmed" as const) : ("pending" as const),
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
