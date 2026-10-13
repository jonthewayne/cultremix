import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ECONOMIC_CONFIG_V2 } from "./lib/economics";
import { requireAdmin } from "./lib/adminAccess";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Brands and rights holders (economics v2). An admin names a member account as a brand and lists
// the design families it owns or licenses; every sale in those families pays the brand its rate
// (10% of the price unless agreed otherwise), on top of the creator pool and out of CultRemix's
// share. A brand that made a family's original also gets that design's creator share.

// The highest rate a brand can be given: 50% of the price.
export const MAX_BRAND_BPS = 5000;

export type FamilyBrand = { brandId: Id<"brands">; userId: Id<"users">; name: string; bps: number };

/** The active brand that owns or licenses a design family, if any. */
export async function brandForFamily(ctx: Pick<QueryCtx, "db">, family: number): Promise<FamilyBrand | null> {
  const brands = await ctx.db
    .query("brands")
    .withIndex("by_active", (q) => q.eq("active", true))
    .take(500);
  const brand = brands.find((row) => row.families.includes(family));
  return brand ? { brandId: brand._id, userId: brand.userId, name: brand.name, bps: brand.bps } : null;
}

const brandView = v.object({
  id: v.id("brands"),
  username: v.string(),
  name: v.string(),
  bps: v.number(),
  families: v.array(v.number()),
  active: v.boolean(),
  updatedAt: v.number(),
});

/** Admin, Brands: every brand, active first. */
export const list = query({
  args: {},
  returns: v.object({ defaultBps: v.number(), maxBps: v.number(), brands: v.array(brandView) }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const rows = await ctx.db.query("brands").order("desc").take(500);
    const brands = await Promise.all(
      rows.map(async (row: Doc<"brands">) => {
        const user = await ctx.db.get("users", row.userId);
        return {
          id: row._id,
          username: user?.username ?? "member",
          name: row.name,
          bps: row.bps,
          families: row.families,
          active: row.active,
          updatedAt: row.updatedAt,
        };
      }),
    );
    brands.sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
    return { defaultBps: ECONOMIC_CONFIG_V2.brandDefaultBps ?? 1000, maxBps: MAX_BRAND_BPS, brands };
  },
});

/**
 * Adds a brand, or updates the member's brand: its display name, rate, and families. Each family
 * can belong to one active brand. Orders already paid keep the split they were sold under.
 */
export const save = mutation({
  args: { username: v.string(), name: v.string(), bps: v.number(), families: v.array(v.number()) },
  returns: v.id("brands"),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const handle = args.username.trim().replace(/^@/u, "").toLowerCase();
    const user = handle
      ? await ctx.db
          .query("users")
          .withIndex("by_usernameLower", (q) => q.eq("usernameLower", handle))
          .first()
      : null;
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "No member has that username." });
    const name = args.name.trim();
    if (!name || name.length > 60) throw new ConvexError({ code: "INVALID_INPUT", message: "Give the brand a name of up to 60 characters." });
    if (!Number.isInteger(args.bps) || args.bps < 1 || args.bps > MAX_BRAND_BPS) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "The rate has to be between 0.01% and 50% of the price." });
    }
    const families = [...new Set(args.families)].sort((a, b) => a - b);
    if (families.length === 0 || families.length > 200 || families.some((family) => !Number.isInteger(family) || family < 1)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "List the brand's families by their CR numbers, like 101 or 104." });
    }
    const existing = await ctx.db
      .query("brands")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    const others = (await ctx.db.query("brands").withIndex("by_active", (q) => q.eq("active", true)).take(500)).filter(
      (row) => row._id !== existing?._id,
    );
    for (const family of families) {
      const holder = others.find((row) => row.families.includes(family));
      if (holder) {
        throw new ConvexError({ code: "TAKEN", message: `Family ${family} already belongs to ${holder.name}.` });
      }
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("brands", existing._id, { name, bps: args.bps, families, active: true, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("brands", {
      userId: user._id,
      name,
      bps: args.bps,
      families,
      active: true,
      createdBy: admin._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Stops a brand's cut on new sales (orders already paid keep theirs). Saving it again restarts it. */
export const deactivate = mutation({
  args: { brandId: v.id("brands") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand) throw new ConvexError({ code: "NOT_FOUND", message: "That brand isn't here anymore." });
    await ctx.db.patch("brands", brand._id, { active: false, updatedAt: Date.now() });
    return null;
  },
});
