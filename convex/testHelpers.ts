import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { scopeRoleValidator } from "./schema";

function requireTestSecret(testSecret: string) {
  const expected = process.env.TEST_HELPER_SECRET;
  if (!expected || testSecret !== expected) {
    throw new Error("Invalid TEST_HELPER_SECRET");
  }
}

export const storeTestEmailMagicLinkUrl = mutation({
  args: {
    testSecret: v.string(),
    email: v.string(),
    magicLinkUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { testSecret, email, magicLinkUrl }) => {
    requireTestSecret(testSecret);
    await ctx.runMutation(internal.authVerification.storeMagicLinkUrl, {
      email,
      magicLinkUrl,
    });
    return null;
  },
});

export const seedTestUser = mutation({
  args: {
    testSecret: v.string(),
    authId: v.string(),
    email: v.string(),
    platformRole: v.optional(
      v.union(
        v.literal("user"),
        v.literal("super_admin_support"),
        v.literal("super_admin_ops"),
        v.literal("super_admin_owner"),
      ),
    ),
  },
  returns: v.id("users"),
  handler: async (ctx, { testSecret, authId, email, platformRole }) => {
    requireTestSecret(testSecret);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .first();
    if (existing) {
      await ctx.db.patch("users", existing._id, {
        email,
        platformRole: platformRole ?? "user",
      });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      authId,
      email,
      platformRole: platformRole ?? "user",
    });
  },
});

export const cleanupTestUser = mutation({
  args: {
    testSecret: v.string(),
    authId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { testSecret, authId }) => {
    requireTestSecret(testSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .first();
    if (!user) return null;

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    for (const membership of memberships) await ctx.db.delete("memberships", membership._id);
    await ctx.db.delete("users", user._id);
    return null;
  },
});

// For the signed-in browser test (tests/e2e/run-signed-in.sh): a member signed up through the
// real email code flow, found by email, gets a role, then is removed with what it made.
export const setTestUserRole = mutation({
  args: {
    testSecret: v.string(),
    email: v.string(),
    platformRole: v.union(v.literal("user"), v.literal("super_admin_support"), v.literal("super_admin_ops"), v.literal("super_admin_owner")),
  },
  returns: v.boolean(),
  handler: async (ctx, { testSecret, email, platformRole }) => {
    requireTestSecret(testSecret);
    if (!/^e2e\+[a-z0-9]+@example\.com$/u.test(email)) throw new Error("Only e2e+...@example.com test members.");
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!user) return false;
    await ctx.db.patch("users", user._id, { platformRole });
    return true;
  },
});

export const cleanupTestUserByEmail = mutation({
  args: { testSecret: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, { testSecret, email }) => {
    requireTestSecret(testSecret);
    if (!/^e2e\+[a-z0-9]+@example\.com$/u.test(email)) throw new Error("Only e2e+...@example.com test members.");
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(5);
    for (const user of users) {
      for (const session of await ctx.db
        .query("creativeSessions")
        .withIndex("by_owner_updated", (q) => q.eq("ownerId", user._id))
        .take(50)) {
        await ctx.db.delete("creativeSessions", session._id);
      }
      for (const row of await ctx.db.query("creditLedger").withIndex("by_user", (q) => q.eq("userId", user._id)).take(100)) {
        await ctx.db.delete("creditLedger", row._id);
      }
      for (const membership of await ctx.db
        .query("memberships")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect()) {
        await ctx.db.delete("memberships", membership._id);
      }
      await ctx.db.delete("users", user._id);
    }
    return users.length;
  },
});

export const seedTestOrganizationMembership = mutation({
  args: {
    testSecret: v.string(),
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: scopeRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, { testSecret, userId, organizationId, role }) => {
    requireTestSecret(testSecret);
    const user = await ctx.db.get("users", userId);
    if (!user) throw new Error("Test user not found");
    const organization = await ctx.db.get("organizations", organizationId);
    if (!organization) throw new Error("Test organization not found");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_userId_and_organizationId", (q) =>
        q.eq("userId", userId).eq("organizationId", organizationId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("memberships", existing._id, {
        role,
        status: "active",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("memberships", {
        userId,
        organizationId,
        role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const cleanupTestOrganization = mutation({
  args: {
    testSecret: v.string(),
    organizationId: v.id("organizations"),
  },
  returns: v.null(),
  handler: async (ctx, { testSecret, organizationId }) => {
    requireTestSecret(testSecret);
    const organization = await ctx.db.get("organizations", organizationId);
    if (!organization) return null;

    const resources = await ctx.db
      .query("resources")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    for (const resource of resources) {
      const resourceMemberships = await ctx.db
        .query("memberships")
        .withIndex("by_resourceId", (q) => q.eq("resourceId", resource._id))
        .collect();
      for (const membership of resourceMemberships) {
        await ctx.db.delete("memberships", membership._id);
      }
      await ctx.db.delete("resources", resource._id);
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    for (const membership of memberships) {
      await ctx.db.delete("memberships", membership._id);
    }
    await ctx.db.delete("organizations", organizationId);
    return null;
  },
});

export const cleanupTestInvite = mutation({
  args: {
    testSecret: v.string(),
    inviteId: v.id("invites"),
  },
  returns: v.null(),
  handler: async (ctx, { testSecret, inviteId }) => {
    requireTestSecret(testSecret);
    const invite = await ctx.db.get("invites", inviteId);
    if (!invite) return null;
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_inviteId", (q) => q.eq("inviteId", inviteId))
      .collect();
    for (const membership of memberships) {
      await ctx.db.delete("memberships", membership._id);
    }
    await ctx.db.delete("invites", inviteId);
    return null;
  },
});

export const getTestEmailOtp = query({
  args: {
    testSecret: v.string(),
    email: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { testSecret, email }) => {
    requireTestSecret(testSecret);
    const attempt = await ctx.db
      .query("authVerificationAttempts")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email.trim().toLowerCase()).eq("status", "pending"),
      )
      .order("desc")
      .first();
    return attempt?.otpCode ?? null;
  },
});

export const getTestPhoneOtp = query({
  args: {
    testSecret: v.string(),
    phone: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { testSecret, phone }) => {
    requireTestSecret(testSecret);
    const attempt = await ctx.db
      .query("phoneVerificationAttempts")
      .withIndex("by_phone_and_status", (q) =>
        q.eq("phone", phone).eq("status", "pending"),
      )
      .order("desc")
      .first();
    return attempt?.otpCode ?? null;
  },
});
