# Recipes

Recipes are optional patterns for product-specific features that should not be baked into the starter core. Start with the generic auth, roles, deployment, and testing foundation, then copy in only the recipes your app needs.

## Available Recipes

- [Admin Dashboard](admin-dashboard.md): turn the starter admin route into a product operations surface.
- [Cloudflare R2 Buckets](r2-buckets.md): add object storage without moving provider secrets into the Worker by accident.
- [Background Workflows](background-workflows.md): model long-running or scheduled product work around Convex functions.
- [Payments](payments.md): add a billing provider while keeping auth and roles DB-authoritative.

## Recipe Rules

- Keep provider secrets in Convex env unless Worker runtime code truly needs them.
- Add env vars to `scripts/lib/config.ts`, `scripts/setup.ts`, `scripts/doctor.ts`, and `docs/environment-variables.md` together.
- Add product permissions to `convex/lib/authz.ts` and tests to `tests/unit/authz.test.ts`.
- Prefer a narrow, working route over a broad abstraction when first adding a product feature.
