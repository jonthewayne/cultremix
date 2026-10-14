import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { CURRENT_ECONOMIC_CONFIG } from "./lib/economicsConfigs";
import { requireAdmin } from "./lib/adminAccess";
import { notifyOpsAlert } from "./lib/notifications";
import { offeredShopProducts } from "./lib/shopProduct";
import { getViewerUser } from "./identity";
import { staff } from "./opsAlerts";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Brands and rights holders (economics v2 to v4). An admin names a member account as a brand, lists
// the design families it owns or licenses, and sets its deal: the family's share of each sale, the
// brand and the family's creators together (25% unless agreed otherwise, never more than 30%), out of
// CultRemix's share. The brand splits that share with the creators on its own page (/brand): creators
// get at least 5%, and a new deal starts them at 10%. A brand that made a family's original also gets
// that design's creator share. Orders already paid keep the split they were sold under.

export type FamilyBrand = { brandId: Id<"brands">; userId: Id<"users">; name: string; bps: number; creatorBps: number | null };

// A deal's bounds under the current rules: the most a family can get, the least its creators get,
// what a new deal starts with, and the standard shares around it (for the money shown in Admin).
export function dealLimits() {
  const config = CURRENT_ECONOMIC_CONFIG;
  const defaultCreatorBps = config.brandCreatorDefaultBps ?? config.creatorPoolBps;
  return {
    maxTotalBps: config.brandFamilyMaxBps ?? 5000,
    minCreatorBps: config.brandCreatorPoolMinBps ?? config.creatorPoolBps,
    defaultCreatorBps,
    defaultTotalBps: (config.brandDefaultBps ?? 1000) + defaultCreatorBps,
    standardCreatorBps: config.creatorPoolBps,
    affiliateBps: config.affiliateBps ?? 0,
  };
}

// A brand's deal: the family's share and its two parts. A deal from before v4 has no total of its
// own: it's the brand's rate plus the creators' share.
export function dealOf(row: Doc<"brands">) {
  const creatorBps = row.creatorBps ?? CURRENT_ECONOMIC_CONFIG.creatorPoolBps;
  return { totalBps: row.totalBps ?? row.bps + creatorBps, creatorBps, brandBps: row.bps };
}

// Shares are whole percents, so a family's creators' share always splits into whole basis points.
function wholePercent(bps: number) {
  return Number.isInteger(bps) && bps % 100 === 0;
}

function percentText(bps: number) {
  return `${bps / 100}%`;
}

/** The member's brand, while it's active. */
export async function activeBrandOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const row = await ctx.db
    .query("brands")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return row?.active ? row : null;
}

/** The active brand that owns or licenses a design family, if any. */
export async function brandForFamily(ctx: Pick<QueryCtx, "db">, family: number): Promise<FamilyBrand | null> {
  const brands = await ctx.db
    .query("brands")
    .withIndex("by_active", (q) => q.eq("active", true))
    .take(500);
  const brand = brands.find((row) => row.families.includes(family));
  return brand
    ? { brandId: brand._id, userId: brand.userId, name: brand.name, bps: brand.bps, creatorBps: brand.creatorBps ?? null }
    : null;
}

const limitsValidator = v.object({
  maxTotalBps: v.number(),
  minCreatorBps: v.number(),
  defaultCreatorBps: v.number(),
  defaultTotalBps: v.number(),
  standardCreatorBps: v.number(),
  affiliateBps: v.number(),
});

const brandView = v.object({
  id: v.id("brands"),
  username: v.string(),
  name: v.string(),
  // The family's share, and how it's split.
  totalBps: v.number(),
  creatorBps: v.number(),
  brandBps: v.number(),
  families: v.array(v.number()),
  note: v.optional(v.string()),
  // Whether the brand set the creators' share itself, and when it was last set.
  setByBrand: v.boolean(),
  creatorBpsSetAt: v.optional(v.number()),
  active: v.boolean(),
  updatedAt: v.number(),
});

/** Admin, Brands: every brand, active first, and the bounds a deal has to stay within. */
export const list = query({
  args: {},
  returns: v.object({ limits: limitsValidator, brands: v.array(brandView) }),
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
          ...dealOf(row),
          families: row.families,
          ...(row.note ? { note: row.note } : {}),
          setByBrand: row.creatorBpsSetBy !== undefined && row.creatorBpsSetBy === row.userId,
          ...(row.creatorBpsSetAt !== undefined ? { creatorBpsSetAt: row.creatorBpsSetAt } : {}),
          active: row.active,
          updatedAt: row.updatedAt,
        };
      }),
    );
    brands.sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
    return { limits: dealLimits(), brands };
  },
});

/**
 * Adds a brand, or updates the member's brand: its display name, its family's share of each sale
 * (brand and creators together), the creators' part of it, its families, and a private note. The
 * brand can change the creators' part later on its own page. Each family can belong to one active
 * brand. Orders already paid keep the split they were sold under.
 */
export const save = mutation({
  args: {
    username: v.string(),
    name: v.string(),
    totalBps: v.number(),
    creatorBps: v.number(),
    families: v.array(v.number()),
    note: v.optional(v.string()),
  },
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
    const limits = dealLimits();
    if (!wholePercent(args.totalBps) || args.totalBps < limits.minCreatorBps || args.totalBps > limits.maxTotalBps) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `The family's share has to be a whole percent from ${percentText(limits.minCreatorBps)} to ${percentText(limits.maxTotalBps)} of the price.`,
      });
    }
    if (!wholePercent(args.creatorBps) || args.creatorBps < limits.minCreatorBps || args.creatorBps > args.totalBps) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `The creators' share has to be a whole percent from ${percentText(limits.minCreatorBps)} to the family's ${percentText(args.totalBps)}.`,
      });
    }
    const note = args.note?.trim() || undefined;
    if (note && note.length > 500) throw new ConvexError({ code: "INVALID_INPUT", message: "Keep the note under 500 characters." });
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
    const deal = { totalBps: args.totalBps, creatorBps: args.creatorBps, bps: args.totalBps - args.creatorBps };
    // Who set the creators' share stays with the brand while an admin leaves it as it is.
    const setBy =
      existing && existing.creatorBps === args.creatorBps && existing.creatorBpsSetBy
        ? { creatorBpsSetBy: existing.creatorBpsSetBy, creatorBpsSetAt: existing.creatorBpsSetAt }
        : { creatorBpsSetBy: admin._id, creatorBpsSetAt: now };
    if (existing) {
      await ctx.db.patch("brands", existing._id, { name, ...deal, ...setBy, note, families, active: true, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("brands", {
      userId: user._id,
      name,
      ...deal,
      ...setBy,
      ...(note ? { note } : {}),
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

/** The brand page (/brand), for a brand's own account: its deal, its families, and an example sale. */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      families: v.array(v.number()),
      totalBps: v.number(),
      creatorBps: v.number(),
      brandBps: v.number(),
      minCreatorBps: v.number(),
      suggestedCreatorBps: v.number(),
      // The default product and its price for S to XL, for the example sale.
      exampleName: v.string(),
      examplePriceCents: v.number(),
      // Whether the brand set the creators' share itself, rather than keeping where its deal started.
      setByBrand: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return null;
    const row = await activeBrandOf(ctx, viewer._id);
    if (!row) return null;
    const limits = dealLimits();
    const [product] = await offeredShopProducts(ctx);
    return {
      name: row.name,
      families: row.families,
      ...dealOf(row),
      minCreatorBps: limits.minCreatorBps,
      suggestedCreatorBps: limits.defaultCreatorBps,
      exampleName: product.name,
      examplePriceCents: product.priceCents,
      setByBrand: row.creatorBpsSetBy === row.userId,
    };
  },
});

/**
 * The brand page: the brand sets how much of its family's share goes to the family's creators, from
 * the published minimum up to the whole share, and keeps the rest. New sales only. The owner and ops
 * staff get a bell notification.
 */
export const setCreatorShare = mutation({
  args: { creatorBps: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
    const row = await activeBrandOf(ctx, viewer._id);
    if (!row) throw new ConvexError({ code: "FORBIDDEN", message: "Only a brand on CultRemix can set this." });
    const { totalBps, creatorBps: before } = dealOf(row);
    const { minCreatorBps } = dealLimits();
    if (!wholePercent(args.creatorBps) || args.creatorBps < minCreatorBps || args.creatorBps > totalBps) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Pick a whole percent from ${percentText(minCreatorBps)} to your families' ${percentText(totalBps)}.`,
      });
    }
    if (args.creatorBps === before && row.totalBps !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch("brands", row._id, {
      totalBps,
      creatorBps: args.creatorBps,
      bps: totalBps - args.creatorBps,
      creatorBpsSetBy: viewer._id,
      creatorBpsSetAt: now,
      updatedAt: now,
    });
    const message = `${row.name} set its creators' share to ${percentText(args.creatorBps)} of each sale in its families (it was ${percentText(before)}). The brand keeps ${percentText(totalBps - args.creatorBps)}.`;
    const { everyone } = await staff(ctx);
    for (const person of everyone) await notifyOpsAlert(ctx, { recipientId: person._id, message });
    return null;
  },
});
