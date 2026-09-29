# Cloudflare Deployment

The starter deploys a TanStack Start server entry to Cloudflare Workers with `nodejs_compat`.

## Branches

- `main`: production Worker and production Convex deploy key.
- `dev`: development Worker and development Convex deploy key.
- `feat/*`, `feature/*`, and `fix/*`: preview Worker using the development Convex backend.

## Required GitHub Secrets

- `CLOUDFLARE_API_TOKEN`
- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`

Provider secrets such as `AUTH_SECRET`, `RESEND_API_KEY`, and `TELNYX_API_KEY` live in Convex backend env vars, not GitHub Actions, unless you intentionally add a workflow that manages Convex env.

Do not set local/dev test helpers in production Convex env. Production should exclude `TEST_HELPER_SECRET` and `ENABLE_TEST_OTP_STORAGE`.

## Required GitHub Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_ZONE_NAME`
- `CLOUDFLARE_PROJECT_NAME`
- `DEV_URL`
- `PROD_URL`
- `PREVIEW_BASE_DOMAIN`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`

The setup wizard derives `DEV_URL`, `PROD_URL`, and `PREVIEW_BASE_DOMAIN` from the root domain you enter, then prints matching `gh variable set` commands. Override the prompts when your development or production hostnames do not follow the default `dev.<domain>` and `<domain>` pattern.

## Important Cloudflare Vite Detail

The Cloudflare Vite plugin flattens `wrangler.jsonc` during build. Select `CLOUDFLARE_ENV` before building production or development:

```bash
CLOUDFLARE_ENV=production bun run build
CLOUDFLARE_ENV=development bun run build
```

Preview builds use development mode, then the workflow patches `dist/server/wrangler.json` with the preview Worker name and route before deploy.

The deploy workflow runs unit tests and TypeScript checks first. It builds before deploying Convex functions or the Worker, so a failed test or build does not update either deployment.

## Type Generation

```bash
bun run cf-typegen
```

This writes Worker binding types from `wrangler.jsonc`. Runtime Worker vars are not the same as Vite build-time `.env.{mode}` values.

## Wrangler Logs

The package scripts set `WRANGLER_LOG_PATH=.wrangler/logs` so Wrangler writes debug logs inside the project instead of the user-level Wrangler config directory. `.wrangler/` is ignored by git. This avoids sandbox permission noise in agent environments while preserving local logs when Wrangler needs them.
