import {


  hasCapability,
  roleAtLeast
} from "./authz";
import type {PlatformRole, ScopeRole} from "./authz";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type PermissionsCtx = QueryCtx | MutationCtx;

const appUserLookupCache = new WeakMap<object, Promise<Doc<"users"> | null>>();

export async function requireAuth(ctx: PermissionsCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity;
}

export async function requireAuthUser(ctx: PermissionsCtx) {
  const identity = await requireAuth(ctx);
  const cacheKey = ctx as unknown as object;
  let lookup = appUserLookupCache.get(cacheKey);
  if (!lookup) {
    lookup = ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();
    appUserLookupCache.set(cacheKey, lookup);
  }

  const user = await lookup;
  if (!user) throw new Error("User record not found");
  return user;
}

export async function requirePlatformCapability(
  ctx: PermissionsCtx,
  capability: string,
) {
  const user = await requireAuthUser(ctx);
  if (!hasCapability((user.platformRole ?? "user"), capability)) {
    throw new Error("Insufficient permissions");
  }
  return user;
}

export async function requireSuperAdmin(ctx: PermissionsCtx) {
  return requirePlatformCapability(ctx, "users:read");
}

export async function findOrganizationMembership(
  ctx: PermissionsCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_userId_and_organizationId", (q) =>
      q.eq("userId", userId).eq("organizationId", organizationId),
    )
    .first();
}

export async function findResourceMembership(
  ctx: PermissionsCtx,
  userId: Id<"users">,
  resourceId: Id<"resources">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_userId_and_resourceId", (q) =>
      q.eq("userId", userId).eq("resourceId", resourceId),
    )
    .first();
}

export async function requireOrganizationRole(
  ctx: PermissionsCtx,
  organizationId: Id<"organizations">,
  minimumRole: ScopeRole,
) {
  const user = await requireAuthUser(ctx);
  if (
    hasCapability((user.platformRole ?? "user"), "organizations:manage")
  ) {
    return user;
  }

  const membership = await findOrganizationMembership(
    ctx,
    user._id,
    organizationId,
  );
  if (
    !membership ||
    membership.status !== "active" ||
    !roleAtLeast(membership.role, minimumRole)
  ) {
    throw new Error("Insufficient organization permissions");
  }
  return user;
}

export async function requireResourceRole(
  ctx: PermissionsCtx,
  resourceId: Id<"resources">,
  minimumRole: ScopeRole,
) {
  const user = await requireAuthUser(ctx);
  if (
    hasCapability((user.platformRole ?? "user"), "resources:manage")
  ) {
    return user;
  }

  const membership = await findResourceMembership(ctx, user._id, resourceId);
  if (
    !membership ||
    membership.status !== "active" ||
    !roleAtLeast(membership.role, minimumRole)
  ) {
    throw new Error("Insufficient resource permissions");
  }
  return user;
}
