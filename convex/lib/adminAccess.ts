import { ConvexError } from "convex/values";
import { isSuperAdminTier } from "./authz";
import type { PlatformRole } from "./authz";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Who may do what in /admin (the auth matrix):
// - "view": any admin (support, ops, owner) may read members and metrics.
// - "manage": ops and the owner change flags, settings, credits, and creator access.
// - "owner": only the owner provisions judge accounts.
export type AdminLevel = "view" | "manage" | "owner";

export function adminAllows(role: PlatformRole | undefined, level: AdminLevel): boolean {
  if (level === "owner") return role === "super_admin_owner";
  if (level === "manage") return role === "super_admin_owner" || role === "super_admin_ops";
  return isSuperAdminTier(role);
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  level: AdminLevel,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
  const user = await ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
    .unique();
  if (!user || !adminAllows(user.platformRole, level)) {
    throw new ConvexError({ code: "FORBIDDEN", message: "You don't have access to this." });
  }
  return user;
}
