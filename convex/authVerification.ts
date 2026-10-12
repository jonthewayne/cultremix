import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  checkRateLimit,
  isRateLimitOperation,
} from "./lib/authRateLimit";
import { sanitizeRedirect } from "./lib/redirect";
import { deploymentEnv } from "./lib/shopFlags";
import {
  assertEmailAttemptIdentity,
  publicEmailAttemptStatus,
} from "./lib/authVerification";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export const createEmailAuthAttempt = mutation({
  args: {
    email: v.string(),
    redirect: v.string(),
    source: v.optional(v.string()),
    inviteId: v.optional(v.id("invites")),
    mergeTargetUserId: v.optional(v.id("users")),
  },
  returns: v.id("authVerificationAttempts"),
  handler: async (ctx, args) => {
    if (process.env.AUTH_EMAIL_OTP_ENABLED === "false") {
      throw new Error("Email authentication is not enabled");
    }

    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Invalid email address");

    await checkRateLimit(ctx, "auth:create_email_attempt", email);

    return await ctx.db.insert("authVerificationAttempts", {
      email,
      redirect: sanitizeRedirect(args.redirect),
      source: args.source ?? "login",
      status: "pending",
      expiresAtMs: Date.now() + ATTEMPT_TTL_MS,
      inviteId: args.inviteId,
      mergeTargetUserId: args.mergeTargetUserId,
    });
  },
});

export const getEmailAuthAttemptStatus = query({
  args: { attemptId: v.id("authVerificationAttempts") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("authVerificationAttempts"),
      email: v.string(),
      redirect: v.string(),
      source: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("verified"),
        v.literal("expired"),
        v.literal("failed"),
      ),
      expiresAtMs: v.number(),
      verifiedAtMs: v.optional(v.number()),
      inviteId: v.optional(v.id("invites")),
    }),
  ),
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get("authVerificationAttempts", attemptId);
    if (!attempt) return null;
    return publicEmailAttemptStatus(attempt);
  },
});

export const markEmailAuthAttemptVerified = mutation({
  args: { attemptId: v.id("authVerificationAttempts") },
  returns: v.null(),
  handler: async (ctx, { attemptId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const attempt = await ctx.db.get("authVerificationAttempts", attemptId);
    if (!attempt || attempt.status !== "pending") return null;
    assertEmailAttemptIdentity(identity.email, attempt.email);
    await ctx.db.patch("authVerificationAttempts", attemptId, {
      status: "verified",
      verifiedAtMs: Date.now(),
      usedByAuthId: identity.subject,
    });
    return null;
  },
});

export const storeMagicLinkUrl = internalMutation({
  args: {
    email: v.string(),
    magicLinkUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { email, magicLinkUrl }) => {
    const attempt = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email.trim().toLowerCase()).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (attempt) await ctx.db.patch("authVerificationAttempts", attempt._id, { magicLinkUrl });
    return null;
  },
});

export const getMagicLinkUrl = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { email }) => {
    const attempt = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email.trim().toLowerCase()).eq("status", "pending"),
      )
      .order("desc")
      .first();
    return attempt?.magicLinkUrl ?? null;
  },
});

export const storeTestOtp = internalMutation({
  args: {
    email: v.string(),
    otpCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { email, otpCode }) => {
    // Never on production, even if the flag were set there by mistake (docs/setup.md).
    if (process.env.ENABLE_TEST_OTP_STORAGE !== "true" || deploymentEnv() === "prod") return null;

    const attempt = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email.trim().toLowerCase()).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (attempt) await ctx.db.patch("authVerificationAttempts", attempt._id, { otpCode });
    return null;
  },
});

export const enforceRateLimit = internalMutation({
  args: {
    operation: v.string(),
    identifier: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { operation, identifier }) => {
    if (!isRateLimitOperation(operation)) {
      throw new Error(`Unknown rate limit operation: ${operation}`);
    }
    await checkRateLimit(ctx, operation, identifier);
    return null;
  },
});

export const isInviteOrMergeFlow = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => {
    const attempt = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email.trim().toLowerCase()).eq("status", "pending"),
      )
      .order("desc")
      .first();
    return attempt?.source === "invite" || attempt?.source === "merge-reauth";
  },
});

export const cleanupExpiredAttempts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_status_and_expiresAtMs", (q) =>
        q.eq("status", "pending").lt("expiresAtMs", now),
      )
      .take(100);

    for (const attempt of expired) {
      await ctx.db.patch("authVerificationAttempts", attempt._id, { status: "expired" });
    }
    return expired.length;
  },
});
