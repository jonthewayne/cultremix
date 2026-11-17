import { v } from "convex/values";
import { query } from "./_generated/server";
import { canonicalConfigJson, creatorPoolFor, recipientShares } from "./lib/economics";
import { CURRENT_ECONOMIC_CONFIG, economicsConfigPath, sha256Hex } from "./lib/economicsConfigs";
import { LineageError, economicLineage } from "./lib/lineage";
import { toLineageWork, workByCr, worksReader } from "./lineage";
import { brandForFamily } from "./brands";
import { saleCredits } from "./artists";
import type { Id } from "./_generated/dataModel";

// The creator pool's roles; affiliate and brand never come from recipientShares, but share its type.
const roleValidator = v.union(
  v.literal("creator"),
  v.literal("family_root"),
  v.literal("upstream"),
  v.literal("affiliate"),
  v.literal("brand"),
  v.literal("artist"),
);

// The work page's Economics panel: who shares in a sale of this work and how much, under the
// current published config (V1 plan U10/KTD-18). Shares are of the creator pool, not the price;
// from v2 the family's brand and whoever's link brought the buyer get their own cut of the price,
// and from v3 the brand's agreement can set the creators' share in its families (creatorPoolBps).
export const panel = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("original"), v.literal("variation"), v.literal("fork")),
      configVersion: v.number(),
      // The creators' share of the price for this design: the standard share, or its brand's.
      creatorPoolBps: v.number(),
      // The member whose link brings a buyer gets this share of the price (null before v2).
      affiliateBps: v.union(v.null(), v.number()),
      // The brand that owns or licenses this design's family and the creators' share its agreement
      // sets in the family (null when creators keep the standard share). A brand's own rate is a
      // private deal (docs/decisions.md, 2026-10-15), so this public response never carries it.
      brand: v.union(
        v.null(),
        v.object({ name: v.string(), username: v.string(), creatorBps: v.union(v.null(), v.number()) }),
      ),
      configPath: v.string(),
      configSha256: v.string(),
      // Shares are recorded on Monad once the work's registration is confirmed there
      // (works.provenanceStatus, set by the chain engine in convex/chain.ts).
      provenance: v.union(v.literal("pending"), v.literal("confirmed")),
      // Lineage the panel couldn't resolve (a missing ancestor); no shares are shown.
      unavailable: v.boolean(),
      // An outside artist's share names the artist (convex/artists.ts), not their account.
      shares: v.array(
        v.object({
          username: v.string(),
          roles: v.array(roleValidator),
          bps: v.number(),
          artist: v.union(v.null(), v.object({ name: v.string(), slug: v.string() })),
        }),
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
    const creatorPoolBps = creatorPoolFor(config, familyBrand ? familyBrand.creatorBps : null);
    const base = {
      configVersion: config.version,
      creatorPoolBps,
      affiliateBps: config.affiliateBps ?? null,
      brand: familyBrand
        ? {
            name: familyBrand.name,
            username: brandUser?.username ?? "member",
            creatorBps: creatorPoolBps === config.creatorPoolBps ? null : creatorPoolBps,
          }
        : null,
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
    const credits = config.artistShareBps ? await saleCredits(ctx, work) : null;
    const shares = await Promise.all(
      recipientShares(lineage, config, credits?.credits).map(async (share) => {
        const user = await ctx.db.get("users", share.who as Id<"users">);
        const artist = share.roles.includes("artist") ? credits?.byRecipient.get(share.who) : undefined;
        return {
          username: user?.username ?? "member",
          roles: share.roles,
          bps: share.bps,
          artist: artist ? { name: artist.name, slug: artist.slug } : null,
        };
      }),
    );
    return { ...base, kind: lineage.kind, unavailable: false, shares };
  },
});
