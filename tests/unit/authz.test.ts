import { describe, expect, it } from "vitest";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_ROLES,
  PLATFORM_ROLE_HIERARCHY,
  SCOPE_ROLES,
  SCOPE_ROLE_HIERARCHY,
  canCreateResourceInOrganization,
  canGrantPlatformRole,
  canManageOrganizationMemberRole,
  hasCapability,
  isSuperAdminTier,
  isValidPlatformRole,
  isValidScopeRole,
  roleAtLeast,
} from "../../convex/lib/authz";

describe("authz helpers", () => {
  it("keeps regular users capability-free", () => {
    expect(hasCapability("user", "users:read")).toBe(false);
    expect(hasCapability(undefined, "users:read")).toBe(false);
    expect(PLATFORM_CAPABILITIES.user).toHaveLength(0);
  });

  it("supports wildcard platform owners", () => {
    expect(hasCapability("super_admin_owner", "anything:manage")).toBe(true);
    expect(PLATFORM_CAPABILITIES.super_admin_owner).toEqual(["*"]);
  });

  it("keeps support and operations capabilities distinct", () => {
    expect(hasCapability("super_admin_support", "users:read")).toBe(true);
    expect(hasCapability("super_admin_support", "resources:read")).toBe(true);
    expect(hasCapability("super_admin_support", "resources:manage")).toBe(false);
    expect(hasCapability("super_admin_ops", "resources:manage")).toBe(true);
    expect(hasCapability("super_admin_ops", "users:read")).toBe(true);
  });

  it("prevents platform role escalation", () => {
    expect(canGrantPlatformRole("super_admin_support", "super_admin_owner")).toBe(false);
    expect(canGrantPlatformRole("super_admin_support", "super_admin_ops")).toBe(false);
    expect(canGrantPlatformRole("super_admin_support", "super_admin_support")).toBe(true);
    expect(canGrantPlatformRole("super_admin_ops", "super_admin_owner")).toBe(false);
    expect(canGrantPlatformRole("super_admin_owner", "super_admin_ops")).toBe(true);
    expect(canGrantPlatformRole("super_admin_owner", "super_admin_owner")).toBe(true);
    expect(canGrantPlatformRole("user", "super_admin_support")).toBe(false);
    expect(canGrantPlatformRole("user", "user")).toBe(true);
    expect(canGrantPlatformRole(undefined, "user")).toBe(false);
    expect(canGrantPlatformRole("super_admin_owner", "not-a-role")).toBe(false);
  });

  it("validates role catalogs", () => {
    for (const role of PLATFORM_ROLES) expect(isValidPlatformRole(role)).toBe(true);
    for (const role of SCOPE_ROLES) expect(isValidScopeRole(role)).toBe(true);
    expect(isValidPlatformRole("admin")).toBe(false);
    expect(isValidPlatformRole("")).toBe(false);
    expect(isValidScopeRole("super_admin_owner")).toBe(false);
    expect(isValidScopeRole("")).toBe(false);
  });

  it("compares scoped roles", () => {
    expect(roleAtLeast("admin", "staff")).toBe(true);
    expect(roleAtLeast("viewer", "staff")).toBe(false);
    expect(roleAtLeast(undefined, "member")).toBe(false);
    expect(isSuperAdminTier("super_admin_support")).toBe(true);
    expect(isSuperAdminTier("super_admin_ops")).toBe(true);
    expect(isSuperAdminTier("super_admin_owner")).toBe(true);
    expect(isSuperAdminTier("user")).toBe(false);
    expect(isSuperAdminTier(undefined)).toBe(false);
  });

  it("keeps the platform and scoped role hierarchies complete and ordered", () => {
    expect(PLATFORM_ROLES).toHaveLength(4);
    expect(SCOPE_ROLES).toContain("member");
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_CAPABILITIES[role]).toBeDefined();
      expect(PLATFORM_ROLE_HIERARCHY[role]).toBeTypeOf("number");
    }
    expect(PLATFORM_ROLE_HIERARCHY.user).toBeLessThan(
      PLATFORM_ROLE_HIERARCHY.super_admin_support,
    );
    expect(PLATFORM_ROLE_HIERARCHY.super_admin_support).toBeLessThan(
      PLATFORM_ROLE_HIERARCHY.super_admin_ops,
    );
    expect(PLATFORM_ROLE_HIERARCHY.super_admin_ops).toBeLessThan(
      PLATFORM_ROLE_HIERARCHY.super_admin_owner,
    );
    for (const role of SCOPE_ROLES) {
      expect(SCOPE_ROLE_HIERARCHY[role]).toBeTypeOf("number");
    }
  });

  it("prevents scoped admins from assigning or changing an owner role", () => {
    expect(canManageOrganizationMemberRole("admin", "member", "staff", false)).toBe(true);
    expect(canManageOrganizationMemberRole("admin", "admin", "owner", false)).toBe(false);
    expect(canManageOrganizationMemberRole("admin", "owner", "admin", false)).toBe(false);
    expect(canManageOrganizationMemberRole("owner", "admin", "owner", false)).toBe(true);
    expect(canManageOrganizationMemberRole(undefined, "member", "owner", false)).toBe(false);
    expect(canManageOrganizationMemberRole(undefined, "owner", "admin", true)).toBe(true);
  });

  it("requires active organization admin access to create scoped resources", () => {
    expect(canCreateResourceInOrganization("owner", "active", false)).toBe(true);
    expect(canCreateResourceInOrganization("admin", "active", false)).toBe(true);
    expect(canCreateResourceInOrganization("member", "active", false)).toBe(false);
    expect(canCreateResourceInOrganization("admin", "disabled", false)).toBe(false);
    expect(canCreateResourceInOrganization(undefined, undefined, false)).toBe(false);
    expect(canCreateResourceInOrganization(undefined, undefined, true)).toBe(true);
  });
});
