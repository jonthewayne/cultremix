# Admin Dashboard

Use this recipe when the app needs an internal `/admin` area for operators, support, or owners.

## Suggested Shape

- Keep `/admin` behind route guards and server-side Convex authorization checks.
- Add product capabilities such as `orders:read`, `billing:manage`, or `styles:manage` to `convex/lib/authz.ts`.
- Keep list/detail/write operations in product-specific Convex modules instead of mixing them into auth files.
- Show read-only views to support roles and mutation controls only to ops/owner roles.

## Setup Checklist

1. Add product tables to `convex/schema.ts`.
2. Add queries and mutations in a new `convex/<feature>Admin.ts` module.
3. Add capabilities and unit tests.
4. Build the `/admin` route using existing shadcn/ui components.
5. Add smoke coverage for the route once authentication bootstrap is available.
