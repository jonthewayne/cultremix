# Setup

The intended setup path is local-first. You should be able to get a working local app before touching Cloudflare, GitHub Actions, Resend, or Telnyx.

For the big-picture flow and feature overview, read [How To Use This Starter](usage-flow.md).

## Prerequisites

- Bun
- A Convex account or anonymous local Convex development
- Cloudflare account only when deploying
- GitHub CLI only when wiring CI
- Resend only when sending real email
- Telnyx only when enabling real SMS

The default setup uses console email and keeps phone auth disabled. Normal dependency installation, setup, tests, and builds do not need Telnyx credentials. Telnyx is required only when phone auth is enabled and the SMS provider is set to `telnyx`.

## Local Setup

If you are starting from this starter directory, create a clean project copy first:

```bash
bun run new-project ../my-app
cd ../my-app
```

`bun run new-project` copies the starter while excluding generated directories such as `node_modules`, `.tmp`, `.wrangler`, `.starter`, and `.env.local`. It does not install dependencies or run setup unless you pass `--install` or `--setup`.

Generated projects also omit `.convex` deployment state and runtime `.dev.vars*` files, and start from the checked-in generic `wrangler.jsonc.template` so configured account IDs and routes are not carried into a new app.

```bash
bun install
bun run setup
bun run doctor
bun run dev
```

The wizard is split into phases:

- Project: package/Worker name and display name.
- Convex: create, connect, use local Convex, or skip.
- Domains: one root domain, then derived dev/prod defaults.
- Auth and providers: console or Resend email, optional phone/SMS, first super admin.
- Convex env values: dev/prod Convex URLs read from `.env.local` when Convex setup succeeds.
- Deployment: Cloudflare and GitHub values only when you opt in.
- External services: exact commands for Convex env, GitHub variables/secrets, and provider setup.

The wizard asks for the project name before Convex setup so the Convex project can use the same name. For a cloud project, choose the intended Convex team explicitly. Enter an existing team slug, type `interactive` only when you want to take over Convex CLI prompts yourself, or type `dashboard` if you need to create a new team in the Convex dashboard first. The `local` choice creates a local deployment without a Convex account. Convex writes deployment details into `.env.local`, and the wizard reads those values back as defaults. Setup also applies the generated backend env values to that local deployment.

Agents running setup for a human must stop and ask which Convex team slug to use. Do not leave the team choice blank or rely on whichever Convex account/team happens to be active in local CLI state.

For domains, enter the root domain once, such as `example.com`. Setup derives `https://dev.example.com`, `https://example.com`, and `preview.example.com` defaults from that value. You can still override any URL prompt. For auth, use a canonical dev app URL such as `https://dev.example.com` for `SITE_URL`, not `http://localhost:3000`. Localhost remains allowed through `AUTH_TRUSTED_ORIGINS`, while Better Auth magic links and invite links use the stable dev URL configured for the Convex deployment.

When the wizard asks for email delivery mode, choose `console` for local development. That selects `AUTH_EMAIL_PROVIDER=console`, so email OTPs are logged locally instead of delivered through Resend. Choose `resend` only when you want real email delivery and have a verified sender/domain ready.

During `bun run setup`, choose `no` for deployment setup if you only want local development. You can rerun the wizard later and choose `yes` when you have Cloudflare and GitHub details.

For an account-free local Convex backend, choose `local` in the wizard's Convex setup prompt. The CLI starts a local deployment without asking for a team. If you prefer to configure Convex yourself, use:

```bash
bun run setup --skip-convex
bunx convex dev --configure new --once
bun run setup
```

## What The Wizard Writes

- `.env.local`
- `.env.development`
- `.env.production`
- `wrangler.jsonc`
- `package.json` package name

It also prints commands for:

- Convex backend env vars with `bunx convex env set`
- Convex production env vars with `bunx convex env set --prod` once production URLs exist
- Cloudflare Worker secrets with `wrangler secret put` only if you later add Worker-only secrets
- GitHub Actions variables/secrets with `gh variable set` and `gh secret set`

For an account-free local Convex deployment, setup runs the dev backend env commands automatically. Cloud backend and GitHub commands remain pending unless you pass `--apply-external`.

Wrangler commands in `package.json` set `WRANGLER_LOG_PATH=.wrangler/logs`. The `.wrangler/` directory is ignored by git and keeps Wrangler debug logs project-local, which avoids permission issues in sandboxed agent environments.

Use `bun run setup --dry-run` to preview file changes. Use `bun run setup --local-only` to skip deployment prompts. Use `bun run setup --defaults --dry-run` for a non-interactive preview. Use `bun run setup --apply-external` after logging in with `convex`, `wrangler`, and `gh` to let the wizard run cloud commands where it safely can. Applied values are passed as CLI arguments, so shell syntax in entered values is not evaluated.

Use `bun run setup --rotate-secrets` only when you intentionally want to replace existing `AUTH_SECRET` and `TEST_HELPER_SECRET` values. By default, rerunning setup preserves existing generated secrets.

The dev Convex env commands set:

- `SITE_URL` to the canonical dev URL, for example `https://dev.example.com`.
- `AUTH_TRUSTED_ORIGINS` to dev, preview, and local origins, for example `https://*.dev.example.com,https://*.preview.example.com,http://localhost:3000,http://localhost:5173`.

Production env commands use the production URL for `SITE_URL` and include the production host plus `www` as trusted origins.

Production Convex env commands intentionally exclude `TEST_HELPER_SECRET` and `ENABLE_TEST_OTP_STORAGE`. Those are local/dev testing helpers and should never be set in production. As a second guard, the test helpers (`convex/testHelpers.ts`) refuse to run and test OTPs are never stored when `DEPLOYMENT_ENV=prod`, even if one were set there by mistake.

## Setup State

The wizard writes `.starter/setup-state.json` with non-secret setup decisions:

- project name and app name
- root domain and derived URLs
- Convex deployment URLs
- selected email/SMS providers
- first super admin email
- whether secrets were generated, reused, or rotated

The file intentionally omits secret values and is ignored by git. It is there so a future developer or agent can understand what setup already did.

## Doctor Modes

```bash
bun run doctor
```

Checks local files and local Vite/Convex values.

```bash
bun run doctor:external
```

Also checks Convex backend env vars and CLI auth.

```bash
bun run doctor:deployment
```

Runs the strict deployment check for Cloudflare, GitHub Actions, production Vite values, and external CLI auth.

## First Super Admin

Set `FIRST_SUPER_ADMIN_EMAIL` during setup. After signing in with that email, open Settings and click **Bootstrap my account**. The mutation refuses to create a second platform owner.

## Resuming Setup

The wizard is idempotent:

- Existing env files are parsed and merged.
- Existing Convex values are reused as defaults.
- Secrets are preserved by default and regenerated only with `--rotate-secrets`.
- External commands that cannot run are printed as copy-paste pending steps.

## Testing With Existing Accounts

You can validate the starter with the same Convex, Cloudflare, GitHub, and Resend accounts you use for another app, but always use separate resources:

- Create a new Convex project or dedicated test deployment.
- Use a new Cloudflare Worker name.
- Use a test hostname or subdomain.
- Use a test GitHub repository, or move the starter to the root of a temporary repo.
- Use a Resend sender on a verified domain, but avoid reusing production-only secrets.

This keeps the starter test realistic without risking production deployments or production auth secrets.
