import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  canGrantPlatformRole,
  hasCapability,
  isValidPlatformRole,
  isValidScopeRole,
  roleAtLeast,
} from "./lib/authz";
import {
  findOrganizationMembership,
  findResourceMembership,
  requireAuthUser,
} from "./lib/permissions";
import type { PlatformRole, ScopeRole } from "./lib/authz";
import type { Doc, Id } from "./_generated/dataModel";

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  user: "User",
  super_admin_support: "Support Admin",
  super_admin_ops: "Operations Admin",
  super_admin_owner: "Platform Owner",
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  viewer: "Viewer",
  member: "Member",
};

export const createInvite = mutation({
  args: {
    inviteType: v.union(
      v.literal("platform_admin"),
      v.literal("organization_admin"),
      v.literal("organization_member"),
      v.literal("resource_admin"),
    ),
    email: v.string(),
    grants: v.array(
      v.object({
        scopeType: v.union(
          v.literal("platform"),
          v.literal("organization"),
          v.literal("resource"),
        ),
        scopeId: v.optional(v.union(v.id("organizations"), v.id("resources"))),
        role: v.string(),
      }),
    ),
    note: v.optional(v.string()),
  },
  returns: v.id("invites"),
  handler: async (ctx, args) => {
    const inviter = await requireAuthUser(ctx);
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Invalid invite email");
    if (args.grants.length === 0) throw new Error("Invite needs a grant");

    validateInviteShape(args.inviteType, args.grants);
    for (const grant of args.grants) {
      validateGrantRole(grant);
      await authorizeGrant(ctx, inviter, grant);
    }

    const inviteId = await ctx.db.insert("invites", {
      inviteType: args.inviteType,
      email,
      grants: args.grants,
      invitedByUserId: inviter._id,
      redirectPath: redirectPathForInvite(args.inviteType),
      status: "pending",
      expiresAtMs: Date.now() + INVITE_TTL_MS,
      note: args.note,
    });

    await ctx.scheduler.runAfter(0, internal.email.triggerInviteMagicLink, {
      email,
      inviteId,
    });

    return inviteId;
  },
});

export const getInvite = query({
  args: { inviteId: v.id("invites") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("invites"),
      inviteType: v.union(
        v.literal("platform_admin"),
        v.literal("organization_admin"),
        v.literal("organization_member"),
        v.literal("resource_admin"),
      ),
      email: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("expired"),
        v.literal("deleted"),
      ),
      redirectPath: v.string(),
      expiresAtMs: v.number(),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("invites", inviteId);
    if (!invite) return null;
    return {
      _id: invite._id,
      inviteType: invite.inviteType,
      email: invite.email,
      status: invite.status,
      redirectPath: invite.redirectPath,
      expiresAtMs: invite.expiresAtMs,
      note: invite.note,
    };
  },
});

export const acceptInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.object({
    success: v.boolean(),
    redirectPath: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { inviteId }) => {
    const user = await requireAuthUser(ctx);
    const invite = await ctx.db.get("invites", inviteId);

    if (!invite) {
      return { success: false, redirectPath: "/", error: "Invite not found" };
    }
    if (user.email?.trim().toLowerCase() !== invite.email) {
      return {
        success: false,
        redirectPath: "/",
        error: "Signed-in email does not match this invite",
      };
    }
    if (invite.status === "accepted") {
      return invite.acceptedByUserId === user._id
        ? { success: true, redirectPath: invite.redirectPath }
        : {
            success: false,
            redirectPath: "/",
            error: "Invite already accepted",
          };
    }
    if (invite.status !== "pending") {
      return {
        success: false,
        redirectPath: "/",
        error: `Invite is ${invite.status}`,
      };
    }
    if (Date.now() > invite.expiresAtMs) {
      await ctx.db.patch("invites", inviteId, { status: "expired" });
      return { success: false, redirectPath: "/", error: "Invite expired" };
    }
    const inviter = await ctx.db.get("users", invite.invitedByUserId);
    if (!inviter) throw new Error("Inviter no longer exists");
    for (const grant of invite.grants) {
      await authorizeGrant(ctx, inviter, grant);
      await authorizeRecipientGrant(ctx, inviter, user, grant);
    }

    for (const grant of invite.grants) {
      await applyGrant(ctx, user._id, invite, grant);
    }

    await ctx.db.patch("invites", inviteId, {
      status: "accepted",
      acceptedAtMs: Date.now(),
      acceptedByUserId: user._id,
    });

    return { success: true, redirectPath: invite.redirectPath };
  },
});

export const listPendingInvites = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      email: v.string(),
      inviteType: v.union(
        v.literal("platform_admin"),
        v.literal("organization_admin"),
        v.literal("organization_member"),
        v.literal("resource_admin"),
      ),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("expired"),
        v.literal("deleted"),
      ),
      expiresAtMs: v.number(),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const role = user.platformRole ?? "user";
    if (!hasCapability(role, "invites:read")) {
      throw new Error("Insufficient permissions");
    }

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_status_and_expiresAtMs", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(100);

    return invites.map((invite) => ({
      _id: invite._id,
      email: invite.email,
      inviteType: invite.inviteType,
      status: invite.status,
      expiresAtMs: invite.expiresAtMs,
      note: invite.note,
    }));
  },
});

export const resendInviteEmail = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const user = await requireAuthUser(ctx);
    const invite = await ctx.db.get("invites", inviteId);
    if (!invite || invite.status !== "pending") {
      throw new Error("Invite is not pending");
    }
    if (Date.now() > invite.expiresAtMs) {
      throw new Error("Invite has expired");
    }

    const role = user.platformRole ?? "user";
    if (
      invite.invitedByUserId !== user._id &&
      !hasCapability(role, "invites:manage")
    ) {
      throw new Error("Not authorized to resend this invite");
    }

    await ctx.scheduler.runAfter(0, internal.email.triggerInviteMagicLink, {
      email: invite.email,
      inviteId,
    });
    return null;
  },
});

export const deleteInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const user = await requireAuthUser(ctx);
    const invite = await ctx.db.get("invites", inviteId);
    if (!invite) return null;

    const role = user.platformRole ?? "user";
    if (
      invite.invitedByUserId !== user._id &&
      !hasCapability(role, "invites:manage")
    ) {
      throw new Error("Not authorized to delete this invite");
    }

    await ctx.db.patch("invites", inviteId, { status: "deleted" });
    return null;
  },
});

export const getInviteDetails = internalQuery({
  args: { inviteId: v.id("invites") },
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      roleName: v.string(),
      inviterEmail: v.string(),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("invites", inviteId);
    if (!invite || invite.status !== "pending") return null;
    const inviter = await ctx.db.get("users", invite.invitedByUserId);
    const platformGrant = invite.grants.find(
      (grant) => grant.scopeType === "platform",
    );
    let grantRole: string = invite.inviteType;
    if (platformGrant) {
      grantRole = platformGrant.role;
    } else if (invite.grants.length > 0) {
      grantRole = invite.grants[0].role;
    }

    return {
      email: invite.email,
      roleName: ROLE_DISPLAY_NAMES[grantRole] ?? grantRole,
      inviterEmail: inviter?.email ?? "An admin",
      note: invite.note,
    };
  },
});

export const cleanupExpiredInvites = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("invites")
      .withIndex("by_status_and_expiresAtMs", (q) =>
        q.eq("status", "pending").lt("expiresAtMs", now),
      )
      .take(100);

    for (const invite of expired) {
      await ctx.db.patch("invites", invite._id, { status: "expired" });
    }
    return expired.length;
  },
});

function validateInviteShape(
  inviteType: string,
  grants: Array<{ scopeType: string; scopeId?: unknown; role: string }>,
) {
  const hasScope = (scopeType: string) =>
    grants.some((grant) => grant.scopeType === scopeType);
  if (inviteType === "platform_admin" && !hasScope("platform")) {
    throw new Error("Platform admin invites require a platform grant");
  }
  if (
    inviteType === "organization_admin" ||
    inviteType === "organization_member"
  ) {
    if (!hasScope("organization")) {
      throw new Error("Organization invites require an organization grant");
    }
  }
  if (inviteType === "resource_admin" && !hasScope("resource")) {
    throw new Error("Resource invites require a resource grant");
  }
}

function validateGrantRole(grant: {
  scopeType: string;
  scopeId?: unknown;
  role: string;
}) {
  if (grant.scopeType === "platform") {
    if (!isValidPlatformRole(grant.role)) {
      throw new Error(`Invalid platform role: ${grant.role}`);
    }
    return;
  }

  if (!isValidScopeRole(grant.role)) {
    throw new Error(`Invalid scoped role: ${grant.role}`);
  }
  if (!grant.scopeId) {
    throw new Error(`${grant.scopeType} grant requires scopeId`);
  }
}

async function authorizeGrant(
  ctx: any,
  inviter: Doc<"users">,
  grant: { scopeType: string; scopeId?: unknown; role: string },
) {
  const platformRole = inviter.platformRole ?? "user";

  if (grant.scopeType === "platform") {
    if (
      !hasCapability(platformRole, "users:invite") ||
      !canGrantPlatformRole(platformRole, grant.role)
    ) {
      throw new Error("Cannot grant this platform role");
    }
    return;
  }

  if (grant.scopeType === "organization") {
    if (hasCapability(platformRole, "organizations:manage")) return;
    const membership = await findOrganizationMembership(
      ctx,
      inviter._id,
      grant.scopeId as Id<"organizations">,
    );
    if (
      !membership ||
      membership.status !== "active" ||
      !roleAtLeast(membership.role, "admin") ||
      (grant.role === "owner" && membership.role !== "owner")
    ) {
      throw new Error("Cannot grant this organization role");
    }
    return;
  }

  if (grant.scopeType === "resource") {
    if (hasCapability(platformRole, "resources:manage")) return;
    const membership = await findResourceMembership(
      ctx,
      inviter._id,
      grant.scopeId as Id<"resources">,
    );
    if (
      !membership ||
      membership.status !== "active" ||
      !roleAtLeast(membership.role, "admin") ||
      (grant.role === "owner" && membership.role !== "owner")
    ) {
      throw new Error("Cannot grant this resource role");
    }
    return;
  }

  throw new Error(`Unknown grant scope: ${grant.scopeType}`);
}

async function authorizeRecipientGrant(
  ctx: any,
  inviter: Doc<"users">,
  recipient: Doc<"users">,
  grant: { scopeType: string; scopeId?: unknown; role: string },
) {
  const platformRole = inviter.platformRole ?? "user";
  if (grant.scopeType === "platform") {
    if (!canGrantPlatformRole(platformRole, recipient.platformRole ?? "user")) {
      throw new Error("Cannot change a higher platform role");
    }
    return;
  }

  const isOrganization = grant.scopeType === "organization";
  const existing = isOrganization
    ? await findOrganizationMembership(
        ctx,
        recipient._id,
        grant.scopeId as Id<"organizations">,
      )
    : await findResourceMembership(
        ctx,
        recipient._id,
        grant.scopeId as Id<"resources">,
      );
  if (!existing || existing.role !== "owner") return;

  const capability = isOrganization
    ? "organizations:manage"
    : "resources:manage";
  if (hasCapability(platformRole, capability)) return;
  const inviterMembership = isOrganization
    ? await findOrganizationMembership(
        ctx,
        inviter._id,
        grant.scopeId as Id<"organizations">,
      )
    : await findResourceMembership(
        ctx,
        inviter._id,
        grant.scopeId as Id<"resources">,
      );
  if (inviterMembership?.role !== "owner") {
    throw new Error("Cannot change an owner membership");
  }
}

async function applyGrant(
  ctx: any,
  userId: Id<"users">,
  invite: Doc<"invites">,
  grant: { scopeType: string; scopeId?: unknown; role: string },
) {
  if (grant.scopeType === "platform") {
    if (!isValidPlatformRole(grant.role)) return;
    await ctx.db.patch("users", userId, { platformRole: grant.role });
    return;
  }

  const now = Date.now();
  if (grant.scopeType === "organization") {
    const existing = await findOrganizationMembership(
      ctx,
      userId,
      grant.scopeId as Id<"organizations">,
    );
    if (existing) {
      await ctx.db.patch("memberships", existing._id, {
        role: grant.role as ScopeRole,
        status: "active",
        inviteId: invite._id,
        acceptedAt: now,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("memberships", {
      userId,
      organizationId: grant.scopeId as Id<"organizations">,
      role: grant.role as ScopeRole,
      status: "active",
      invitedAt: invite._creationTime,
      invitedByUserId: invite.invitedByUserId,
      inviteEmail: invite.email,
      inviteId: invite._id,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  if (grant.scopeType === "resource") {
    const existing = await findResourceMembership(
      ctx,
      userId,
      grant.scopeId as Id<"resources">,
    );
    if (existing) {
      await ctx.db.patch("memberships", existing._id, {
        role: grant.role as ScopeRole,
        status: "active",
        inviteId: invite._id,
        acceptedAt: now,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("memberships", {
      userId,
      resourceId: grant.scopeId as Id<"resources">,
      role: grant.role as ScopeRole,
      status: "active",
      invitedAt: invite._creationTime,
      invitedByUserId: invite.invitedByUserId,
      inviteEmail: invite.email,
      inviteId: invite._id,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function redirectPathForInvite(inviteType: string) {
  if (inviteType === "platform_admin") return "/admin";
  if (inviteType === "resource_admin") return "/resources";
  return "/team";
}
