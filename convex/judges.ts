import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { createAuth } from "./auth";
import { requireAdmin } from "./lib/adminAccess";
import { ensureCreatorNumber } from "./lib/creators";
import { PASSWORD_MIN_LENGTH, generateJudgePassword } from "./lib/passwordAuth";
import { validateUsername } from "./lib/username";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

// Judge accounts (KTD-15): email and password, made only here. Each gets creator access,
// 40 credits, and a username, so a judge lands in the studio without onboarding.
export const JUDGE_CREDITS = 40;
export const JUDGE_NOTE = "judge";

const provisionArgs = {
  email: v.string(),
  username: v.string(),
  // Leave out to generate one. Set `resetPassword` to replace an existing judge's password.
  password: v.optional(v.string()),
  resetPassword: v.optional(v.boolean()),
};

const provisionResult = v.object({
  email: v.string(),
  username: v.string(),
  creatorNumber: v.optional(v.number()),
  credits: v.number(),
  created: v.boolean(),
  // Only when a password was set by this call; it isn't stored anywhere readable.
  password: v.optional(v.string()),
});

type ProvisionResult = {
  email: string;
  username: string;
  creatorNumber?: number;
  credits: number;
  created: boolean;
  password?: string;
};

export const assertCanProvision = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => (await requireAdmin(ctx, "owner"))._id,
});

// Owner only, from /admin.
export const provision = action({
  args: provisionArgs,
  returns: provisionResult,
  handler: async (ctx, args): Promise<ProvisionResult> => {
    const grantedBy: Id<"users"> = await ctx.runQuery(internal.judges.assertCanProvision, {});
    return await provisionJudge(ctx, args, grantedBy);
  },
});

// For scripts/provision-judges.ts, through `convex run`, which only deployment admins can use.
export const provisionFromCli = internalAction({
  args: provisionArgs,
  returns: provisionResult,
  handler: async (ctx, args): Promise<ProvisionResult> => await provisionJudge(ctx, args, undefined),
});

async function provisionJudge(
  ctx: ActionCtx,
  args: { email: string; username: string; password?: string; resetPassword?: boolean },
  grantedBy: Id<"users"> | undefined,
): Promise<ProvisionResult> {
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ConvexError({ code: "INVALID_INPUT", message: "Enter a valid email address." });
  }
  const check = validateUsername(args.username);
  if (!check.ok) throw new ConvexError({ code: "INVALID_INPUT", message: check.message });
  if (args.password !== undefined && args.password.length < PASSWORD_MIN_LENGTH) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  }

  const auth = await createAuth(ctx).$context;
  const existing = await auth.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  let authId: string;
  let created = false;
  let password: string | undefined;

  if (!existing) {
    password = args.password ?? generateJudgePassword();
    const user = await auth.internalAdapter.createUser({
      email,
      name: check.username,
      emailVerified: true,
    });
    await auth.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await auth.password.hash(password),
    });
    authId = user.id;
    created = true;
  } else {
    authId = existing.user.id;
    const credential = existing.accounts.find((account) => account.providerId === "credential");
    // A member who signs in with email codes doesn't get a password through here.
    const isJudge: boolean = await ctx.runQuery(internal.judges.isJudgeAccount, { authId });
    if (!credential && !isJudge) {
      throw new ConvexError({
        code: "ALREADY_MEMBER",
        message: "That email already belongs to a member who signs in with email codes.",
      });
    }
    if (!credential || args.resetPassword) {
      password = args.password ?? generateJudgePassword();
      const hash = await auth.password.hash(password);
      if (credential) {
        await auth.internalAdapter.updatePassword(authId, hash);
      } else {
        await auth.internalAdapter.linkAccount({
          userId: authId,
          providerId: "credential",
          accountId: authId,
          password: hash,
        });
      }
    }
  }

  const access: { username: string; creatorNumber?: number; credits: number } = await ctx.runMutation(internal.judges.grantJudgeAccess, {
    authId,
    email,
    username: check.username,
    grantedBy,
  });
  return { email, username: access.username, creatorNumber: access.creatorNumber, credits: access.credits, created, password };
}

export const isJudgeAccount = internalQuery({
  args: { authId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", args.authId))
      .unique();
    if (!user) return false;
    const access = await ctx.db
      .query("creatorAccess")
      .withIndex("by_user_active", (q) => q.eq("userId", user._id))
      .collect();
    return access.some((row) => row.note === JUDGE_NOTE);
  },
});

// Gives the judge's app account its username, creator access, and credits. Running it again
// changes nothing (the credits are granted once).
export const grantJudgeAccess = internalMutation({
  args: {
    authId: v.string(),
    email: v.string(),
    username: v.string(),
    grantedBy: v.optional(v.id("users")),
  },
  returns: v.object({
    username: v.string(),
    creatorNumber: v.optional(v.number()),
    credits: v.number(),
  }),
  handler: async (ctx, args) => {
    let user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", args.authId))
      .unique();
    if (!user) {
      // The auth trigger normally makes this row; make it here if it hasn't.
      const userId = await ctx.db.insert("users", {
        authId: args.authId,
        email: args.email,
        name: args.username,
        platformRole: "user",
      });
      user = (await ctx.db.get("users", userId))!;
    }

    const patch: { username?: string; usernameLower?: string; emailVerified?: boolean; signupGrantAt?: number } = {};
    if (!user.username) {
      const check = validateUsername(args.username);
      if (!check.ok) throw new ConvexError({ code: "INVALID_INPUT", message: check.message });
      const usernameLower = check.username.toLowerCase();
      const taken = await ctx.db
        .query("users")
        .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
        .first();
      if (taken && taken._id !== user._id) {
        throw new ConvexError({ code: "INVALID_INPUT", message: `The username ${check.username} is taken.` });
      }
      patch.username = check.username;
      patch.usernameLower = usernameLower;
    }
    if (!user.emailVerified) patch.emailVerified = true;
    // Judges get their credits below instead of the signup grant.
    if (user.signupGrantAt === undefined) patch.signupGrantAt = Date.now();
    if (Object.keys(patch).length > 0) await ctx.db.patch("users", user._id, patch);
    user = { ...user, ...patch };

    const accessRows = await ctx.db
      .query("creatorAccess")
      .withIndex("by_user_active", (q) => q.eq("userId", user._id))
      .collect();
    const judgeRow = accessRows.find((row) => row.note === JUDGE_NOTE);
    if (!judgeRow) {
      await ctx.db.insert("creatorAccess", {
        userId: user._id,
        source: "comp",
        active: true,
        grantedBy: args.grantedBy,
        activatedAt: Date.now(),
        note: JUDGE_NOTE,
      });
      await ctx.db.insert("creditLedger", {
        userId: user._id,
        kind: "grant",
        amount: JUDGE_CREDITS,
        reason: "admin",
        note: JUDGE_NOTE,
      });
    } else if (!judgeRow.active) {
      await ctx.db.patch("creatorAccess", judgeRow._id, { active: true });
    }
    const creatorNumber = await ensureCreatorNumber(ctx, user);

    const ledger = await ctx.db
      .query("creditLedger")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return {
      username: user.username!,
      creatorNumber,
      credits: ledger.reduce((sum, row) => sum + row.amount, 0),
    };
  },
});
