export type PlatformRole =
  | "user"
  | "super_admin_support"
  | "super_admin_ops"
  | "super_admin_owner";

export type ScopeRole = "owner" | "admin" | "staff" | "viewer" | "member";
export type ScopeType = "platform" | "organization" | "resource";

export const PLATFORM_ROLES: ReadonlyArray<PlatformRole> = [
  "user",
  "super_admin_support",
  "super_admin_ops",
  "super_admin_owner",
] as const;

export const SCOPE_ROLES: ReadonlyArray<ScopeRole> = [
  "owner",
  "admin",
  "staff",
  "viewer",
  "member",
] as const;

export const PLATFORM_CAPABILITIES: Record<
  PlatformRole,
  ReadonlyArray<string>
> = {
  user: [],
  super_admin_support: [
    "users:read",
    "organizations:read",
    "resources:read",
    "invites:read",
  ],
  super_admin_ops: [
    "users:read",
    "users:invite",
    "organizations:manage",
    "resources:manage",
    "invites:manage",
  ],
  super_admin_owner: ["*"],
} as const;

export const PLATFORM_ROLE_HIERARCHY: Record<PlatformRole, number> = {
  user: 0,
  super_admin_support: 1,
  super_admin_ops: 2,
  super_admin_owner: 3,
} as const;

export const SCOPE_ROLE_HIERARCHY: Record<ScopeRole, number> = {
  member: 0,
  viewer: 0,
  staff: 1,
  admin: 2,
  owner: 3,
} as const;

export function isValidPlatformRole(role: string): role is PlatformRole {
  return (PLATFORM_ROLES as ReadonlyArray<string>).includes(role);
}

export function isValidScopeRole(role: string): role is ScopeRole {
  return (SCOPE_ROLES as ReadonlyArray<string>).includes(role);
}

export function hasCapability(
  role: PlatformRole | undefined,
  capability: string,
): boolean {
  if (!role) return false;
  const capabilities = PLATFORM_CAPABILITIES[role];
  return capabilities.includes("*") || capabilities.includes(capability);
}

export function canGrantPlatformRole(
  inviterRole: PlatformRole | undefined,
  targetRole: string,
): boolean {
  if (!inviterRole || !isValidPlatformRole(targetRole)) return false;
  return (
    PLATFORM_ROLE_HIERARCHY[inviterRole] >=
    PLATFORM_ROLE_HIERARCHY[targetRole]
  );
}

export function roleAtLeast(
  actualRole: ScopeRole | undefined,
  minimumRole: ScopeRole,
): boolean {
  if (!actualRole) return false;
  return SCOPE_ROLE_HIERARCHY[actualRole] >= SCOPE_ROLE_HIERARCHY[minimumRole];
}

export function canManageOrganizationMemberRole(
  actorRole: ScopeRole | undefined,
  currentRole: ScopeRole,
  requestedRole: ScopeRole,
  canManageOrganizations: boolean,
): boolean {
  if (canManageOrganizations || actorRole === "owner") return true;
  return (
    actorRole === "admin" &&
    currentRole !== "owner" &&
    requestedRole !== "owner"
  );
}

export function canCreateResourceInOrganization(
  membershipRole: ScopeRole | undefined,
  membershipStatus: "active" | "invited" | "disabled" | undefined,
  canManageOrganizations: boolean,
): boolean {
  return (
    canManageOrganizations ||
    (membershipStatus === "active" && roleAtLeast(membershipRole, "admin"))
  );
}

export function isSuperAdminTier(role: string | undefined): boolean {
  return (
    role === "super_admin_support" ||
    role === "super_admin_ops" ||
    role === "super_admin_owner"
  );
}
