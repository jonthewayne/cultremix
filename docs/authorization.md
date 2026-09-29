# Authorization And Roles

Roles are DB-authoritative. JWT payloads include identity/profile fields only; they do not carry app authorization roles.

## Platform Roles

- `user`
- `super_admin_support`
- `super_admin_ops`
- `super_admin_owner`

Capabilities live in `convex/lib/authz.ts`. `super_admin_owner` has wildcard access. Lower admin tiers get explicit capabilities such as `users:read`, `users:invite`, `organizations:manage`, and `resources:manage`.

## Scoped Roles

Organizations and resources use memberships:

- `owner`
- `admin`
- `staff`
- `viewer`
- `member`

Use `requireOrganizationRole` and `requireResourceRole` from `convex/lib/permissions.ts` inside Convex functions. Do not duplicate role hierarchy logic in route components.

## Invites

Invites contain grants. Each grant is validated structurally and authorized independently. This prevents privilege escalation where a low-privilege user tries to smuggle a platform grant into an organization invite.

When an invite is accepted, the inviter's current permissions and the recipient's current role are checked again. A lower-tier admin cannot downgrade a platform or scoped owner through an invite. Accepted invites then patch the platform role or create/update the scoped membership.
