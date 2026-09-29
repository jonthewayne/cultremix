# How To Use This Starter

This starter is meant to become the root of a new app repository. While it lives in a `/starter` folder during extraction, treat that folder as the future repo root: `package.json`, `convex/`, `src/`, `wrangler.jsonc`, and `.github/workflows/` all belong at the top level after you move it out.

## Mental Model

There are four moving parts:

- TanStack Start renders the React app on the server for the first request, then TanStack Router handles internal navigation in the browser.
- Convex stores app data, runs backend functions, and hosts the Better Auth component tables.
- Better Auth manages sessions and sign-in methods; app roles and permissions stay in first-party Convex tables.
- Cloudflare Workers run the TanStack Start server in production, with GitHub Actions deploying Convex and the Worker.

The key split is auth state:

- Authenticated app routes use `ConvexQueryClient` with `expectAuth: true`.
- Pre-auth screens, such as login and verification, use a standalone Convex client so they can create login attempts before a session exists.
- `/api/auth/*` is same-origin and proxies Better Auth requests through TanStack Start to Convex.

## First-Time Local Flow

From the starter root:

```bash
bun run new-project ../my-app
cd ../my-app
bun install
bun run setup
bun run doctor
bun run dev
```

The order matters:

1. `bun run new-project ../my-app` copies the starter into a clean project directory.
2. `bun install` installs app dependencies.
3. `bun run setup` asks for project/app names, then asks for an explicit Convex team choice before it creates or connects a separate Convex project using that name.
4. Convex writes initial deployment values to `.env.local`; the wizard reads them back as defaults for the remaining prompts.
5. The wizard derives URLs from one root domain, writes local env files, updates `wrangler.jsonc`, preserves or generates secrets, writes `.starter/setup-state.json`, and prints any external commands it could not safely run.
6. `bun run doctor` verifies the local configuration.
7. `bun run dev` starts Convex and the TanStack Start app.

You can run `bun run setup --local-only` when you only care about local development. Later, rerun `bun run setup` without that flag to fill in Cloudflare and GitHub deployment values. Use `bun run setup --skip-convex` if you prefer to run `bunx convex dev --configure new --once` manually. If an agent is running setup, it should ask the human for the intended Convex team slug instead of relying on local Convex CLI state.

## What The Wizard Sets Up

Local files:

- `.env.local` for local development secrets and local Convex values.
- `.env.development` for Vite build-time dev values.
- `.env.production` for Vite build-time production values.
- `wrangler.jsonc` for Cloudflare Worker names, routes, and runtime vars.
- `package.json` package name.
- `.starter/setup-state.json` as a non-secret setup report.

External systems:

- Convex backend env vars through printed or executed `bunx convex env set` commands.
- Production Convex env vars with `bunx convex env set --prod` once production Convex URLs exist.
- GitHub Actions variables and secrets through printed or executed `gh variable set` and `gh secret set` commands.
- Cloudflare deployment metadata in `wrangler.jsonc`.

Secrets such as `AUTH_SECRET`, `RESEND_API_KEY`, and `TELNYX_API_KEY` live in Convex backend env vars by default. They are not committed and are not Worker secrets unless you intentionally add Worker-only server code that needs them. Rerunning setup preserves existing generated secrets unless you pass `--rotate-secrets`.

## Feature Overview

Auth:

- Email OTP sign-in.
- Optional magic links.
- Optional phone OTP with E.164 normalization.
- Tap-code route at `/$code`.
- Cross-device phone login handoff through stored magic links.
- Invite magic links.
- Expired, used, and failed auth attempt states.
- Safe redirect sanitization.
- Rate limits and auth attempt records.

Email and SMS providers:

- Console/test providers for local development and tests.
- Resend provider for production email.
- Telnyx provider seam for production SMS.

Authorization:

- Regular users.
- Super admin tiers.
- Scoped memberships for organization/workspace-like scopes.
- Scoped organization and resource roles.
- Invite grants.
- Central role catalogs and capability checks.
- DB-authoritative roles. Roles are not stored in JWT claims.

App UI:

- shadcn/ui CSS variable contract, including base, chart, sidebar, and radius tokens.
- Light/dark theme toggle.
- Login, email verify, phone verify, invite acceptance, unauthorized, not found, dashboard, settings, team, and admin route surfaces.
- Theme generator friendly: replace only the `:root` and `.dark` variable blocks in `src/styles/app.css`.

Deployment:

- Cloudflare Worker runtime with `nodejs_compat`.
- GitHub Actions deployment for `main`, `dev`, and preview branches.
- Preview cleanup workflow for branch deletion.
- Convex deploy in CI.
- Worker deploy in CI.

Testing:

- Default local unit tests that need no external credentials.
- Convex integration tests gated behind Convex test env.
- Browser smoke tests with `agent-browser`.
- `doctor` commands for local, external, and deployment configuration.

## Day-To-Day Development

Use:

```bash
bun run dev
```

Then edit:

- `src/routes/` for screens and route loaders.
- `src/components/` for UI.
- `convex/` for schema, queries, mutations, actions, auth, and permissions.
- `docs/` for project docs.

Run before finishing changes:

```bash
bun run typecheck
bun run test
bun run build
```

For user-facing changes, also run:

```bash
bun run test:e2e
```

## Going To Production

The production path is:

1. Move the starter to a new repository root.
2. Run the setup wizard and create/connect a separate Convex project in the intended team.
3. Rerun the setup wizard with deployment details if you skipped them locally.
4. Set Convex backend env vars.
5. Create Cloudflare Worker API token and DNS route.
6. Set GitHub Actions secrets and variables.
7. Push to `dev` for a development deploy.
8. Push to `main` for production.

Always use separate resources for a starter validation run, even when using the same accounts as another app: separate Convex project, Cloudflare Worker name, hostname, GitHub test repo, and non-production secrets.

## Moving It Out

The starter is self-contained enough to move to a new repository and keep iterating:

- `AGENTS.md` carries project instructions for future Codex sessions.
- `docs/plans/` is available for future project plans.
- `docs/usage-flow.md` explains how the starter is meant to be used.
- `docs/convex_rules.mdc` carries Convex implementation rules.
- `docs/environment-variables.md`, `docs/testing.md`, and `docs/deployment-cloudflare.md` describe the setup contracts.
- `docs/recipes/` contains optional product-building recipes that are deliberately outside the generic core.

After moving it, open the new repository root in your preferred development environment and continue from the starter's setup and architecture docs.

Use:

```bash
bun run doctor:deployment
```

before expecting GitHub Actions deployment to pass.
