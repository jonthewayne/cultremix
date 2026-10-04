import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { cultremixTables } from "./schema/cultremix";
import { printTables } from "./schema/print";

export const platformRoleValidator = v.union(
  v.literal("user"),
  v.literal("super_admin_support"),
  v.literal("super_admin_ops"),
  v.literal("super_admin_owner"),
);

export const scopeRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("staff"),
  v.literal("viewer"),
  v.literal("member"),
);

export const inviteTypeValidator = v.union(
  v.literal("platform_admin"),
  v.literal("organization_admin"),
  v.literal("organization_member"),
  v.literal("resource_admin"),
);

export const scopeTypeValidator = v.union(
  v.literal("platform"),
  v.literal("organization"),
  v.literal("resource"),
);

export default defineSchema({
  users: defineTable({
    authId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    phone: v.optional(v.string()),
    platformRole: v.optional(platformRoleValidator),
    pendingEmail: v.optional(v.string()),
    smsCarrierOptedOut: v.optional(v.boolean()),
    lastLoginAt: v.optional(v.number()),
    username: v.optional(v.string()),
    usernameLower: v.optional(v.string()),
    creatorNumber: v.optional(v.number()),
    emailVerified: v.optional(v.boolean()),
    signupGrantAt: v.optional(v.number()),
  })
    .index("by_authId", ["authId"])
    .index("by_email", ["email"])
    .index("by_phone", ["phone"])
    .index("by_platformRole", ["platformRole"])
    .index("by_usernameLower", ["usernameLower"])
    .index("by_creatorNumber", ["creatorNumber"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_createdByUserId", ["createdByUserId"]),

  resources: defineTable({
    organizationId: v.optional(v.id("organizations")),
    name: v.string(),
    slug: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdByUserId", ["createdByUserId"]),

  memberships: defineTable({
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    resourceId: v.optional(v.id("resources")),
    role: scopeRoleValidator,
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("disabled"),
    ),
    invitedAt: v.optional(v.number()),
    invitedByUserId: v.optional(v.id("users")),
    inviteEmail: v.optional(v.string()),
    inviteId: v.optional(v.id("invites")),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_resourceId", ["resourceId"])
    .index("by_userId_and_organizationId", ["userId", "organizationId"])
    .index("by_userId_and_resourceId", ["userId", "resourceId"])
    .index("by_inviteId", ["inviteId"])
    .index("by_status", ["status"]),

  authRateLimits: defineTable({
    key: v.string(),
    windowStartMs: v.number(),
    count: v.number(),
    blockedUntilMs: v.optional(v.number()),
    updatedAtMs: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_key_and_windowStartMs", ["key", "windowStartMs"])
    .index("by_windowStartMs", ["windowStartMs"])
    .index("by_blockedUntilMs", ["blockedUntilMs"]),

  authVerificationAttempts: defineTable({
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
    usedByAuthId: v.optional(v.string()),
    inviteId: v.optional(v.id("invites")),
    magicLinkUrl: v.optional(v.string()),
    otpCode: v.optional(v.string()),
    mergeTargetUserId: v.optional(v.id("users")),
  })
    .index("by_email_and_status", ["email", "status"])
    .index("by_status_and_expiresAtMs", ["status", "expiresAtMs"])
    .index("by_inviteId", ["inviteId"]),

  phoneVerificationAttempts: defineTable({
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
    otpCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    crossDeviceMagicLinkUrl: v.optional(v.string()),
  })
    .index("by_phone_and_status", ["phone", "status"])
    .index("by_status_and_expiresAtMs", ["status", "expiresAtMs"])
    .index("by_otpCode", ["otpCode"]),

  invites: defineTable({
    inviteType: inviteTypeValidator,
    email: v.string(),
    grants: v.array(
      v.object({
        scopeType: scopeTypeValidator,
        scopeId: v.optional(v.union(v.id("organizations"), v.id("resources"))),
        role: v.string(),
      }),
    ),
    invitedByUserId: v.id("users"),
    redirectPath: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("deleted"),
    ),
    expiresAtMs: v.number(),
    acceptedAtMs: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),
    note: v.optional(v.string()),
  })
    .index("by_email_and_status", ["email", "status"])
    .index("by_invitedByUserId_and_status", ["invitedByUserId", "status"])
    .index("by_status_and_expiresAtMs", ["status", "expiresAtMs"]),

  ...cultremixTables,
  ...printTables,
});
