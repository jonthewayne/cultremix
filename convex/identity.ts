import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
  creatorNumber: v.optional(v.number()),
  credits: v.number(),
  unlimited: v.boolean(),
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
    creatorNumber: user.creatorNumber,
    credits: await creditBalance(ctx, user._id),
    unlimited: isOwner(user),
  };
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
