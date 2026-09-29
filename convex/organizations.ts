import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  findOrganizationMembership,
  requireAuthUser,
  requireOrganizationRole,
} from "./lib/permissions";
import {
  canManageOrganizationMemberRole,
  hasCapability,
} from "./lib/authz";
import type {ScopeRole} from "./lib/authz";

export const createOrganization = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  returns: v.id("organizations"),
  handler: async (ctx, { name, slug }) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();
    const normalizedSlug = slug.trim().toLowerCase();
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
      .first();
    if (existing) throw new Error("Organization slug is already taken");

    const organizationId = await ctx.db.insert("organizations", {
      name: name.trim(),
      slug: normalizedSlug,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("memberships", {
      userId: user._id,
      organizationId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return organizationId;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("organizations"),
      name: v.string(),
      slug: v.string(),
      role: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const rows = [];
    for (const membership of memberships) {
      if (!membership.organizationId || membership.status !== "active") {
        continue;
      }
      const org = await ctx.db.get("organizations", membership.organizationId);
      if (!org) continue;
      rows.push({
        _id: org._id,
        name: org.name,
        slug: org.slug,
        role: membership.role,
      });
    }
    return rows;
  },
});

export const listMembers = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      _id: v.id("memberships"),
      userId: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      role: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("invited"),
        v.literal("disabled"),
      ),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrganizationRole(ctx, organizationId, "viewer");
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();

    const rows = [];
    for (const membership of memberships) {
      const user = await ctx.db.get("users", membership.userId);
      rows.push({
        _id: membership._id,
        userId: membership.userId,
        email: user?.email,
        name: user?.name,
        role: membership.role,
        status: membership.status,
      });
    }
    return rows;
  },
});

export const updateMemberRole = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("staff"),
      v.literal("viewer"),
      v.literal("member"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { organizationId, userId, role }) => {
    const actor = await requireOrganizationRole(ctx, organizationId, "admin");
    const membership = await findOrganizationMembership(
      ctx,
      userId,
      organizationId,
    );
    if (!membership) throw new Error("Membership not found");
    const actorMembership = await findOrganizationMembership(
      ctx,
      actor._id,
      organizationId,
    );
    const canManageOrganizations = hasCapability(
      actor.platformRole ?? "user",
      "organizations:manage",
    );
    if (
      !canManageOrganizationMemberRole(
        actorMembership?.role,
        membership.role,
        role,
        canManageOrganizations,
      )
    ) {
      throw new Error("Cannot grant or change organization owner role");
    }
    await ctx.db.patch("memberships", membership._id, {
      role: role,
      updatedAt: Date.now(),
    });
    return null;
  },
});
