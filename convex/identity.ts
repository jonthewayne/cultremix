import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { adminAllows } from "./lib/adminAccess";
import { JUDGE_ACCESS_NOTE, activeCreatorAccess } from "./lib/creators";
import { validateUsername } from "./lib/username";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export const DEFAULT_APP_SETTINGS = {
  key: "main",
  signupGrant: { enabled: true, credits: 24 },
  dailyBudgetCents: 5000,
  shootsPerMemberPerDay: 3,
};

export const viewerValidator = v.object({
  userId: v.id("users"),
  email: v.optional(v.string()),
  username: v.optional(v.string()),
  needsUsername: v.boolean(),
  isOwner: v.boolean(),
  // True only for the FIRST_SUPER_ADMIN_EMAIL account while nobody owns the platform.
  canClaimOwner: v.boolean(),
  creatorNumber: v.optional(v.number()),
  credits: v.number(),
  unlimited: v.boolean(),
  // Admins who manage the platform can try other image models in the studio.
  canPickModel: v.optional(v.boolean()),
  // Any admin (support, ops, owner): the header menu links to Admin.
  isAdmin: v.optional(v.boolean()),
  // Admins who manage (ops, owner): they can take a design down from its page.
  canManage: v.optional(v.boolean()),
  // A hackathon judge's account (convex/judges.ts): the studio shows them where to start.
  isJudge: v.optional(v.boolean()),
  // A brand's account (convex/brands.ts): the header menu links to its brand page.
  isBrand: v.optional(v.boolean()),
});

export async function getViewerUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
}

export function isOwner(user: Doc<"users">) {
  return user.platformRole === "super_admin_owner";
}

async function canClaimOwner(ctx: Ctx, user: Doc<"users">) {
  if (isOwner(user)) return false;
  const target = process.env.FIRST_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!target || user.email?.trim().toLowerCase() !== target) return false;
  const owner = await ctx.db
    .query("users")
    .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_owner"))
    .first();
  return owner === null;
}

export async function getAppSettings(ctx: Ctx) {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
  return row ?? { ...DEFAULT_APP_SETTINGS, updatedAt: 0 };
}

export async function creditBalance(ctx: Ctx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("creditLedger")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function toViewer(ctx: Ctx, user: Doc<"users">) {
  return {
    userId: user._id,
    email: user.email,
    username: user.username,
    needsUsername: !user.username,
    isOwner: isOwner(user),
    canClaimOwner: await canClaimOwner(ctx, user),
    creatorNumber: user.creatorNumber,
    credits: await creditBalance(ctx, user._id),
    unlimited: isOwner(user),
    canPickModel: adminAllows(user.platformRole, "manage"),
    isAdmin: adminAllows(user.platformRole, "view"),
    canManage: adminAllows(user.platformRole, "manage"),
    isJudge: (await activeCreatorAccess(ctx, user._id))?.note === JUDGE_ACCESS_NOTE,
    isBrand: await hasActiveBrand(ctx, user._id),
  };
}

// Whether the member's account is an active brand (convex/brands.ts). Read here, not imported, so
// identity and brands don't import each other.
async function hasActiveBrand(ctx: Ctx, userId: Id<"users">) {
  const row = await ctx.db
    .query("brands")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return row?.active === true;
}

export const viewer = query({
  args: {},
  returns: v.union(v.null(), viewerValidator),
  handler: async (ctx) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    return await toViewer(ctx, user);
  },
});

export const signupCredits = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const settings = await getAppSettings(ctx);
    return settings.signupGrant.enabled ? settings.signupGrant.credits : 0;
  },
});

// Saves the username once and applies the signup grant in the same mutation;
// `signupGrantAt` makes the grant impossible to repeat.
export const completeOnboarding = mutation({
  args: { username: v.string() },
  returns: viewerValidator,
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
    if (user.username) return await toViewer(ctx, user);

    const check = validateUsername(args.username);
    if (!check.ok) {
      throw new ConvexError({ code: "INVALID_INPUT", message: check.message });
    }
    const usernameLower = check.username.toLowerCase();
    const taken = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
      .first();
    if (taken && taken._id !== user._id) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "That name is taken. Try another." });
    }

    const patch: Partial<Doc<"users">> = { username: check.username, usernameLower };
    if (user.signupGrantAt === undefined) {
      const settings = await getAppSettings(ctx);
      if (settings.signupGrant.enabled && settings.signupGrant.credits > 0) {
        await ctx.db.insert("creditLedger", {
          userId: user._id,
          kind: "grant",
          amount: settings.signupGrant.credits,
          reason: "signup",
        });
      }
      patch.signupGrantAt = Date.now();
    }
    await ctx.db.patch("users", user._id, patch);
    return await toViewer(ctx, { ...user, ...patch });
  },
});

// Gives a member credits by email: bunx convex run identity:grantCredits '{"email":"…","amount":10}'
// (production: --prod). Internal, so only someone with deploy access can run it.
export const grantCredits = internalMutation({
  args: { email: v.string(), amount: v.number(), note: v.optional(v.string()) },
  returns: v.object({ username: v.optional(v.string()), credits: v.number() }),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amount) || args.amount <= 0 || args.amount > 1000) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Grant 1 to 1000 credits." });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "No member with that email." });
    await ctx.db.insert("creditLedger", { userId: user._id, kind: "grant", amount: args.amount, reason: "admin", note: args.note });
    return { username: user.username, credits: await creditBalance(ctx, user._id) };
  },
});
