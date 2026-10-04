import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import authConfig from "./auth.config";
import { sendAuthEmail, sendInviteEmailWithMagicLink } from "./email";
import { isPhoneTempEmail, phoneTempEmail } from "./lib/phone";
import {
  PASSWORD_DISABLED_PATHS,
  emailAndPasswordOptions,
} from "./lib/passwordAuth";
import {
  canGrantPlatformRole,
  hasCapability,
  isValidPlatformRole,
} from "./lib/authz";
import { requireAuthUser } from "./lib/permissions";
import type { PlatformRole } from "./lib/authz";
import type { AuthFunctions, GenericCtx } from "@convex-dev/better-auth";
import type { DataModel, Id } from "./_generated/dataModel";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_authId", (q) => q.eq("authId", doc._id))
          .unique();
        if (existing) return;

        const userId = await ctx.db.insert("users", {
          authId: doc._id,
          email: normalizeAppEmail(doc.email),
          name: doc.name,
          phone: (doc as { phoneNumber?: string }).phoneNumber,
          platformRole: "user",
          walletStatus: "pending",
        });
        await ctx.scheduler.runAfter(0, internal.wallets.provisionWallet, { userId });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        const patch: {
          email?: string;
          name?: string;
          phone?: string | undefined;
        } = {};
        const nextEmail = normalizeAppEmail(newDoc.email);
        const prevEmail = normalizeAppEmail(oldDoc.email);
        const nextPhone = (newDoc as { phoneNumber?: string }).phoneNumber;
        const prevPhone = (oldDoc as { phoneNumber?: string }).phoneNumber;

        if (nextEmail !== prevEmail) patch.email = nextEmail;
        if (newDoc.name !== oldDoc.name) {
          patch.name = newDoc.name;
        }
        if (nextPhone !== prevPhone) patch.phone = nextPhone;
        if (Object.keys(patch).length === 0) return;

        const appUser = await ctx.db
          .query("users")
          .withIndex("by_authId", (q) => q.eq("authId", newDoc._id))
          .unique();
        if (!appUser) return;

        if (patch.phone) {
          const other = await ctx.db
            .query("users")
            .withIndex("by_phone", (q) => q.eq("phone", patch.phone))
            .first();
          if (other && other._id !== appUser._id) {
            await ctx.db.patch("users", other._id, { phone: undefined });
          }
        }

        await ctx.db.patch("users", appUser._id, patch);
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  const extraOrigins = process.env.AUTH_TRUSTED_ORIGINS
    ? process.env.AUTH_TRUSTED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl, ...extraOrigins],
    database: authComponent.adapter(ctx),
    session: {
      // Keep people signed in as long as browsers allow: Chrome keeps a cookie at most
      // 400 days. Any visit after a day renews it, so people who come back never expire.
      expiresIn: 60 * 60 * 24 * 400,
      updateAge: 60 * 60 * 24,
    },
    // Passwords only for accounts an admin provisions (convex/judges.ts).
    emailAndPassword: emailAndPasswordOptions,
    disabledPaths: [...PASSWORD_DISABLED_PATHS],
    plugins: [
      magicLink({
        expiresIn: 60 * 60 * 24 * 30,
        sendMagicLink: async ({ email, url }) => {
          const phoneAttemptId = extractPhoneAttemptIdFromMagicLink(url);
          if (phoneAttemptId) {
            await safeRun(
              "magic_link_cross_device",
              email,
              (ctx as any).runMutation(
                internal.phoneVerification.storeCrossDeviceMagicLink,
                { attemptId: phoneAttemptId, url },
              ),
            );
            return;
          }

          const inviteId = extractInviteIdFromMagicLink(url);
          if (inviteId) {
            try {
              const details = await (ctx as any).runQuery(
                internal.invites.getInviteDetails,
                { inviteId },
              );
              if (details) {
                await sendInviteEmailWithMagicLink(ctx, email, url, details);
                return;
              }
            } catch (error) {
              logAuthDeliveryError("magic_link_invite", email, error);
            }
          }

          if (isPhoneTempEmail(email)) return;

          try {
            await (ctx as any).runMutation(
              internal.authVerification.enforceRateLimit,
              {
                operation: "auth:send_magic_link",
                identifier: normalizeEmail(email),
              },
            );
            await storeMagicLinkUrlOnAttempt(ctx, email, url);
          } catch (error) {
            logAuthDeliveryError("magic_link", email, error);
          }
        },
      }),
      emailOTP({
        expiresIn: 600,
        sendVerificationOTP: async ({ email, otp }) => {
          if (process.env.AUTH_EMAIL_OTP_ENABLED === "false") return;
          if (isPhoneTempEmail(email)) return;

          try {
            await (ctx as any).runMutation(
              internal.authVerification.enforceRateLimit,
              {
                operation: "auth:send_email_otp",
                identifier: normalizeEmail(email),
              },
            );
            const magicLinkUrl = await (ctx as any).runQuery(
              internal.authVerification.getMagicLinkUrl,
              { email },
            );
            await sendAuthEmail(ctx, { email, otp, magicLinkUrl });
          } catch (error) {
            logAuthDeliveryError("email_otp", email, error);
          }

          if (process.env.ENABLE_TEST_OTP_STORAGE === "true") {
            await safeRun(
              "email_otp",
              email,
              (ctx as any).runMutation(internal.authVerification.storeTestOtp, {
                email,
                otpCode: otp,
              }),
            );
          }
        },
      }),
      phoneNumber({
        sendOTP: async ({ phoneNumber: phone }) => {
          if (process.env.AUTH_PHONE_ENABLED !== "true") return;

          try {
            await (ctx as any).runMutation(
              internal.authVerification.enforceRateLimit,
              { operation: "auth:send_phone_otp", identifier: phone },
            );
            const code = await (ctx as any).runMutation(
              internal.phoneVerification.generateAndStoreUniqueOtp,
              { phone },
            );
            const autoSubmitUrl = `${siteUrl}/${code}`;
            const host = new URL(siteUrl).hostname;
            await (ctx as any).runAction(internal.sms.sendSms, {
              to: phone,
              body: `${code} is your ${process.env.APP_NAME ?? "Starter"} code. Tap: ${autoSubmitUrl}\n\n@${host} #${code}`,
            });
          } catch (error) {
            const failureReason =
              error instanceof Error && error.message === "RECIPIENT_OPTED_OUT"
                ? "opted_out"
                : "delivery_failed";
            await safeRun(
              "phone_otp",
              phone,
              (ctx as any).runMutation(
                internal.phoneVerification.setAttemptFailed,
                { phone, failureReason },
              ),
            );
            logAuthDeliveryError("phone_otp", phone, error);
          }
        },
        verifyOTP: async ({ phoneNumber: phone, code }) => {
          if (process.env.AUTH_PHONE_ENABLED !== "true") return false;
          await (ctx as any).runMutation(
            internal.authVerification.enforceRateLimit,
            { operation: "auth:verify_phone_otp", identifier: phone },
          );
          return await (ctx as any).runMutation(
            internal.phoneVerification.verifyAndConsumeOtp,
            { phone, code },
          );
        },
        signUpOnVerification: {
          getTempEmail: phoneTempEmail,
        },
      }),
      convex({
        authConfig,
        jwt: {
          expirationSeconds: 3600,
          definePayload: ({ user }) => ({
            email: user.email,
            name: user.name,
          }),
        },
      }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      authId: v.optional(v.string()),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      phone: v.optional(v.string()),
      platformRole: v.optional(
        v.union(
          v.literal("user"),
          v.literal("super_admin_support"),
          v.literal("super_admin_ops"),
          v.literal("super_admin_owner"),
        ),
      ),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();
    if (!user) return null;
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      authId: user.authId,
      email: user.email,
      name: user.name,
      image: user.image,
      phone: user.phone,
      platformRole: user.platformRole,
    };
  },
});

export const getAuthFeatureFlags = query({
  args: {},
  returns: v.object({
    emailOtpEnabled: v.boolean(),
    magicLinkEnabled: v.boolean(),
    phoneEnabled: v.boolean(),
    emailDelivered: v.boolean(),
  }),
  handler: () => ({
    emailOtpEnabled: process.env.AUTH_EMAIL_OTP_ENABLED !== "false",
    magicLinkEnabled: process.env.AUTH_MAGIC_LINK_ENABLED === "true",
    phoneEnabled: process.env.AUTH_PHONE_ENABLED === "true",
    emailDelivered: process.env.AUTH_EMAIL_PROVIDER === "resend",
  }),
});

export const bootstrapFirstSuperAdmin = mutation({
  args: {},
  returns: v.object({ changed: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const targetEmail =
      process.env.FIRST_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    if (!targetEmail) {
      return { changed: false, reason: "FIRST_SUPER_ADMIN_EMAIL is not set" };
    }
    if (user.email?.trim().toLowerCase() !== targetEmail) {
      return {
        changed: false,
        reason: "Signed-in user does not match bootstrap email",
      };
    }
    const existingOwner = await ctx.db
      .query("users")
      .withIndex("by_platformRole", (q) =>
        q.eq("platformRole", "super_admin_owner"),
      )
      .first();
    if (existingOwner && existingOwner._id !== user._id) {
      return { changed: false, reason: "A super admin owner already exists" };
    }

    await ctx.db.patch("users", user._id, {
      platformRole: "super_admin_owner",
      creatorNumber: 1,
    });
    return { changed: true };
  },
});

export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      platformRole: v.optional(
        v.union(
          v.literal("user"),
          v.literal("super_admin_support"),
          v.literal("super_admin_ops"),
          v.literal("super_admin_owner"),
        ),
      ),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await requireAuthUser(ctx);
    if (!hasCapability(viewer.platformRole ?? "user", "users:read")) {
      throw new Error("Insufficient permissions");
    }
    const users = await ctx.db.query("users").order("desc").take(100);
    return users.map((user) => ({
      _id: user._id,
      _creationTime: user._creationTime,
      email: user.email,
      name: user.name,
      phone: user.phone,
      platformRole: user.platformRole,
    }));
  },
});

export const updatePlatformRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, role }) => {
    const actor = await requireAuthUser(ctx);
    const actorRole = actor.platformRole ?? "user";
    if (
      !hasCapability(actorRole, "users:invite") ||
      !isValidPlatformRole(role) ||
      !canGrantPlatformRole(actorRole, role)
    ) {
      throw new Error("Cannot grant this platform role");
    }
    const target = await ctx.db.get("users", userId);
    if (!target) throw new Error("User not found");
    if (!canGrantPlatformRole(actorRole, target.platformRole ?? "user")) {
      throw new Error("Cannot change a higher platform role");
    }
    await ctx.db.patch("users", userId, { platformRole: role });
    return null;
  },
});

export const { getAuthUser } = authComponent.clientApi();

async function storeMagicLinkUrlOnAttempt(
  ctx: GenericCtx<DataModel>,
  email: string,
  url: string,
) {
  const magicLinkEnabled = process.env.AUTH_MAGIC_LINK_ENABLED === "true";
  if (!magicLinkEnabled) {
    const isRequiredFlow = await (ctx as any).runQuery(
      internal.authVerification.isInviteOrMergeFlow,
      { email: normalizeEmail(email) },
    );
    if (!isRequiredFlow) return;
  }

  await (ctx as any).runMutation(internal.authVerification.storeMagicLinkUrl, {
    email,
    magicLinkUrl: url,
  });
}

function normalizeAppEmail(email?: string) {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function extractInviteIdFromMagicLink(url: string): Id<"invites"> | null {
  try {
    const parsed = new URL(url);
    const callbackURL = parsed.searchParams.get("callbackURL") ?? "";
    const match = callbackURL.match(/inviteId=([^&]+)/);
    return match ? (decodeURIComponent(match[1]) as Id<"invites">) : null;
  } catch {
    return null;
  }
}

function extractPhoneAttemptIdFromMagicLink(
  url: string,
): Id<"phoneVerificationAttempts"> | null {
  try {
    const parsed = new URL(url);
    const callbackURL = parsed.searchParams.get("callbackURL") ?? "";
    if (!callbackURL.includes("crossDevice=true")) return null;
    const match = callbackURL.match(/phoneAttemptId=([^&]+)/);
    return match
      ? (decodeURIComponent(match[1]) as Id<"phoneVerificationAttempts">)
      : null;
  } catch {
    return null;
  }
}

async function safeRun(
  kind: string,
  destination: string,
  work: Promise<unknown>,
) {
  try {
    await work;
  } catch (error) {
    logAuthDeliveryError(kind, destination, error);
  }
}

function logAuthDeliveryError(
  kind: string,
  destination: string,
  error: unknown,
) {
  console.error("auth_delivery_failed", {
    kind,
    destination: maskDestination(destination),
    error: error instanceof Error ? error.message : String(error),
  });
}

function maskDestination(destination: string) {
  if (!destination.includes("@"))
    return destination.replace(/\d(?=\d{2})/g, "*");
  const [local, domain] = destination.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}
