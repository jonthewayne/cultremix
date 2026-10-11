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

Staging (`env.staging`, Worker `cultremix-staging` at `staging.cultremix.com`) builds in Vite's `staging` mode so the browser bundle reads `.env.staging` instead of `.env.production`: `bun run deploy:staging`. The steps are in `docs/launch-checklist.md`.

Preview builds use development mode, then the workflow patches `dist/server/wrangler.json` with the preview Worker name and route before deploy.

The deploy workflow runs unit tests and TypeScript checks first. It builds before deploying Convex functions or the Worker, so a failed test or build does not update either deployment.

## Security Headers

`src/start.ts` adds security headers to every response the Worker makes (pages, server routes such as `/economics/v1.json`, and server functions): `X-Frame-Options: DENY` with a Content-Security-Policy of `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that turns off the camera, microphone, location, payment, and USB. On `cultremix.com` and its subdomains it also sends `Strict-Transport-Security` for a year. The policy doesn't limit scripts, styles, images, or connections; that would need every Convex, R2, and Shopify origin listed and tested first. TanStack Start reads `src/start.ts` when the server starts, so a running dev server needs a restart to send them. The e2e smoke test checks them on any `https://` `BASE_URL`.

## Type Generation

```bash
bun run cf-typegen
```

This writes Worker binding types from `wrangler.jsonc`. Runtime Worker vars are not the same as Vite build-time `.env.{mode}` values.

## Wrangler Logs

The package scripts set `WRANGLER_LOG_PATH=.wrangler/logs` so Wrangler writes debug logs inside the project instead of the user-level Wrangler config directory. `.wrangler/` is ignored by git. This avoids sandbox permission noise in agent environments while preserving local logs when Wrangler needs them.
