import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  findOrganizationMembership,
  requireAuthUser,
  requireResourceRole,
} from "./lib/permissions";
import { canCreateResourceInOrganization, hasCapability } from "./lib/authz";

export const createResource = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    name: v.string(),
    slug: v.string(),
  },
  returns: v.id("resources"),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (args.organizationId) {
      const membership = await findOrganizationMembership(
        ctx,
        user._id,
        args.organizationId,
      );
      const canManageOrganizations = hasCapability(
        user.platformRole ?? "user",
        "organizations:manage",
      );
      if (
        !canCreateResourceInOrganization(
          membership?.role,
          membership?.status,
          canManageOrganizations,
        )
      ) {
        throw new Error("Requires organization admin permission to create resources");
      }
    }
    const now = Date.now();
    const slug = args.slug.trim().toLowerCase();
    const existing = await ctx.db
      .query("resources")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) throw new Error("Resource slug is already taken");

    const resourceId = await ctx.db.insert("resources", {
      organizationId: args.organizationId,
      name: args.name.trim(),
      slug,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("memberships", {
      userId: user._id,
      resourceId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return resourceId;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("resources"),
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
      if (!membership.resourceId || membership.status !== "active") continue;
      const resource = await ctx.db.get("resources", membership.resourceId);
      if (!resource) continue;
      rows.push({
        _id: resource._id,
        name: resource.name,
        slug: resource.slug,
        role: membership.role,
      });
    }
    return rows;
  },
});

export const getById = query({
  args: { resourceId: v.id("resources") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("resources"),
      name: v.string(),
      slug: v.string(),
    }),
  ),
  handler: async (ctx, { resourceId }) => {
    await requireResourceRole(ctx, resourceId, "viewer");
    const resource = await ctx.db.get("resources", resourceId);
    if (!resource) return null;
    return {
      _id: resource._id,
      name: resource.name,
      slug: resource.slug,
    };
  },
});
