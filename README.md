# Convex Start Better Auth Starter

A product-agnostic starter for Bun, Vite, React, TanStack Start, Convex, Better Auth, Cloudflare Workers, Tailwind, shadcn/ui, and Resend.

The app is SSR-enabled through TanStack Start on Cloudflare Workers. Initial loads render on the server, then TanStack Router handles internal navigation client-side after hydration.

## 5-Minute Start

From this starter directory, create a clean project copy:

```bash
bun run new-project ../my-app
cd ../my-app
```

Then set up the new project:

```bash
bun install
bun run setup
bun run doctor
bun run dev
```

The setup wizard walks through project identity, Convex, domains, auth providers, optional deployment, and verification. Choose `local` for an account-free Convex deployment; for cloud projects, enter an existing team slug, type `interactive` to take over Convex CLI prompts yourself, or create a new team in the Convex dashboard and rerun setup. The wizard writes env files, patches `package.json` and `wrangler.jsonc`, preserves existing secrets on rerun, writes `.starter/setup-state.json`, applies backend env values to an account-free local Convex deployment, and prints pending commands for cloud services.

Use `bun run setup --dry-run` to preview changes. Use `bun run setup --local-only` to skip deployment prompts. Use `bun run setup --skip-convex` if you want to run `bunx convex dev --configure new --once` yourself. Use `bun run setup --defaults --dry-run` for a non-interactive preview. Use `bun run setup --rotate-secrets` only when you intentionally want new auth/test secrets. Use `bun run setup --apply-external` when you are authenticated with `convex`, `wrangler`, and `gh` and want the wizard to attempt external CLI setup too.

For local sign-in, choose `console` email mode and leave Resend for later. Console mode logs auth emails/OTPs to Convex/dev logs and enables test OTP storage locally.

Phone authentication is disabled by default. Normal installation, setup, tests, and builds do not need Telnyx credentials; live SMS needs them only after you enable phone auth and select Telnyx.

For local development, `bun run doctor` checks the local path only. When you are ready to deploy, run:

```bash
bun run doctor:deployment
```

That stricter check verifies Cloudflare, GitHub, production Vite values, and external CLI auth.

## Commands

```bash
bun run dev          # Convex + TanStack Start dev
bun run new-project  # copy this starter into a clean project directory
bun run doctor       # local/env/config checks
bun run doctor:deployment # stricter Cloudflare/GitHub/production checks
bun run typecheck    # TypeScript + Convex typecheck
bun run test         # default local unit tests
bun run test:convex  # Convex integration tests when a test backend is configured
bun run test:e2e     # browser smoke test with agent-browser
bun run build        # production build + typecheck
bun audit            # dependency security audit
```

## What Is Included

- Better Auth with Convex persistence via `@convex-dev/better-auth`
- Email OTP and optional magic links
- Optional phone OTP, disabled by default, with E.164 normalization, local/Telnyx provider seam, tap-code route, and cross-device magic-link handoff
- Resend email delivery in production and console providers for local/tests
- DB-authoritative platform roles, scoped memberships, invites, capability checks, and route guards
- `ConvexQueryClient` with `expectAuth: true` for authenticated app code
- Standalone pre-auth Convex client for login and verification flows
- Same-origin `/api/auth/*` proxy through TanStack Start
- Clean shadcn-style UI with light/dark mode
- Cloudflare Worker deployment workflows for `main`, `dev`, and preview branches

## Setup Flow

1. Install dependencies with `bun install`.
2. Run `bun run setup`; choose the intended Convex team slug when prompted, and choose local-only first if you do not have Cloudflare/GitHub details yet.
3. Run `bun run doctor`.
4. Run `bun run dev`.
5. Sign in with `FIRST_SUPER_ADMIN_EMAIL`, open Settings, and bootstrap the first owner.

The wizard is safe to rerun. It merges env files instead of deleting them, preserves existing generated secrets unless `--rotate-secrets` is passed, and prints pending commands when a CLI is not authenticated or an external project does not exist yet.

For a fuller walkthrough of how the pieces fit together, read [How To Use This Starter](docs/usage-flow.md).

## First Super Admin

1. Set `FIRST_SUPER_ADMIN_EMAIL` through the wizard.
2. Sign in with that email.
3. Open Settings and click **Bootstrap my account**.

The mutation only succeeds when no other `super_admin_owner` exists.

## Theming

This starter uses the full shadcn/ui CSS variable contract in `src/styles/app.css`, including base, chart, sidebar, and radius tokens. Generate a theme at https://ui.shadcn.com/themes, then replace the `:root` and `.dark` variable blocks while keeping the `@theme inline` block intact. The app shell and components use those semantic tokens, so the new theme flows through automatically.

## More Docs

- [Architecture](docs/architecture.md)
- [How To Use This Starter](docs/usage-flow.md)
- [Setup](docs/setup.md)
- [Auth](docs/auth.md)
- [Authorization](docs/authorization.md)
- [Environment Variables](docs/environment-variables.md)
- [Cloudflare Deployment](docs/deployment-cloudflare.md)
- [Testing](docs/testing.md)
- [Theming](docs/theming.md)
- [Recipes](docs/recipes/README.md)
- [Starter Improvements Log](docs/starter-improvements.md)
