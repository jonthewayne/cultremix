import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { checkRateLimit } from "./lib/authRateLimit";
import { generateSecureNumericCode } from "./lib/otp";
import { normalizePhone } from "./lib/phone";
import { sanitizeRedirect } from "./lib/redirect";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export const createPhoneAuthAttempt = mutation({
  args: {
    phone: v.string(),
    redirect: v.string(),
    source: v.optional(v.string()),
  },
  returns: v.id("phoneVerificationAttempts"),
  handler: async (ctx, args) => {
    if (process.env.AUTH_PHONE_ENABLED !== "true") {
      throw new Error("Phone authentication is not enabled");
    }

    const phone = normalizePhone(args.phone);
    if (!phone) throw new Error("Invalid phone number");

    await checkRateLimit(ctx, "auth:create_phone_attempt", phone);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (existingUser?.smsCarrierOptedOut) {
      throw new Error(
        "SMS is blocked for this number. Text START to re-enable, or sign in with email instead.",
      );
    }

    return await ctx.db.insert("phoneVerificationAttempts", {
      phone,
      redirect: sanitizeRedirect(args.redirect),
      source: args.source ?? "login",
      status: "pending",
      expiresAtMs: Date.now() + ATTEMPT_TTL_MS,
    });
  },
});

export const getPhoneAuthAttemptStatus = query({
  args: { attemptId: v.id("phoneVerificationAttempts") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("phoneVerificationAttempts"),
      phone: v.string(),
      redirect: v.string(),
      source: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("consumed"),
        v.literal("verified"),
        v.literal("expired"),
        v.literal("failed"),
      ),
      expiresAtMs: v.number(),
      verifiedAtMs: v.optional(v.number()),
      crossDeviceMagicLinkUrl: v.optional(v.string()),
      failureReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get("phoneVerificationAttempts", attemptId);
    if (!attempt) return null;
    return {
      _id: attempt._id,
      phone: attempt.phone,
      redirect: attempt.redirect,
      source: attempt.source,
      status: attempt.status,
      expiresAtMs: attempt.expiresAtMs,
      verifiedAtMs: attempt.verifiedAtMs,
      crossDeviceMagicLinkUrl:
        attempt.status === "verified"
          ? attempt.crossDeviceMagicLinkUrl
          : undefined,
      failureReason:
        attempt.status === "failed" ? attempt.failureReason : undefined,
    };
  },
});

// Internal: given a code, it returns a pending attempt's phone number, so a public version would let
// anyone guess codes for numbers. Nothing in the app calls it while phone sign-in is off.
export const lookupAttemptByOtp = internalQuery({
  args: { otpCode: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      attemptId: v.id("phoneVerificationAttempts"),
      phone: v.string(),
      redirect: v.string(),
    }),
  ),
  handler: async (ctx, { otpCode }) => {
    const matches = await ctx.db
      .query("phoneVerificationAttempts")
      .withIndex("by_otpCode", (q) => q.eq("otpCode", otpCode))
      .collect();

    const now = Date.now();
    const attempt = matches.find(
      (match) => match.status === "pending" && match.expiresAtMs > now,
    );
    if (!attempt) return null;

    return {
      attemptId: attempt._id,
      phone: attempt.phone,
      redirect: attempt.redirect,
    };
  },
});

export const generateAndStoreUniqueOtp = internalMutation({
  args: { phone: v.string() },
  returns: v.string(),
  handler: async (ctx, { phone }) => {
    for (let i = 0; i < 10; i += 1) {
      const code = generateSecureNumericCode(6);
      const matches = await ctx.db
        .query("phoneVerificationAttempts")
        .withIndex("by_otpCode", (q) => q.eq("otpCode", code))
        .collect();
      const hasActiveCollision = matches.some(
        (match) =>
          match.status === "pending" && match.expiresAtMs > Date.now(),
      );
      if (hasActiveCollision) continue;

      const attempt = await ctx.db
        .query("phoneVerificationAttempts")
        .withIndex("by_phone_and_status", (q) =>
          q.eq("phone", phone).eq("status", "pending"),
        )
        .order("desc")
        .first();
      if (!attempt) throw new Error("No pending phone verification attempt");

      await ctx.db.patch("phoneVerificationAttempts", attempt._id, { otpCode: code });
      return code;
    }

    throw new Error("Failed to generate unique OTP");
  },
});

export const verifyAndConsumeOtp = internalMutation({
  args: {
    phone: v.string(),
    code: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { phone, code }) => {
    const attempts = await ctx.db
      .query("phoneVerificationAttempts")
      .withIndex("by_phone_and_status", (q) =>
        q.eq("phone", phone).eq("status", "pending"),
      )
      .collect();

    const now = Date.now();
    const attempt = attempts.find(
      (candidate) =>
        candidate.otpCode === code && candidate.expiresAtMs > now,
    );
    if (!attempt) return false;

    await ctx.db.patch("phoneVerificationAttempts", attempt._id, { status: "consumed" });
    return true;
  },
});

export const storeCrossDeviceMagicLink = internalMutation({
  args: {
    attemptId: v.id("phoneVerificationAttempts"),
    url: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { attemptId, url }) => {
    const attempt = await ctx.db.get("phoneVerificationAttempts", attemptId);
    if (!attempt) return null;
    if (attempt.status !== "pending" && attempt.status !== "consumed") {
      return null;
    }

    await ctx.db.patch("phoneVerificationAttempts", attemptId, {
      status: "verified",
      verifiedAtMs: Date.now(),
      crossDeviceMagicLinkUrl: url,
    });
    return null;
  },
});

export const setAttemptFailed = internalMutation({
  args: {
    phone: v.string(),
    failureReason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { phone, failureReason }) => {
    const attempt = await ctx.db
      .query("phoneVerificationAttempts")
      .withIndex("by_phone_and_status", (q) =>
        q.eq("phone", phone).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (attempt) {
      await ctx.db.patch("phoneVerificationAttempts", attempt._id, { status: "failed", failureReason });
    }
    return null;
  },
});
