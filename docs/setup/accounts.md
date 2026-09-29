# Accounts and setup (ops lane)

Ops record for the 2026-09-29 sprint. No secrets here. Keys live only on mighteous in `~/.config/cultremix/*.env` (mode 600); save them with `~/.config/cultremix/put-secret <file>.env VAR ...`, which reads each value from a hidden prompt.

## Secret files

| File | Variables | Source | Status |
|---|---|---|---|
| `gateway.env` | `AI_GATEWAY_API_KEY` | Vercel AI Gateway key `cultremix`, $50 budget, no refresh | waiting on Jon |
| `r2.env` | secret: `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; not secret: `R2_ENDPOINT`, `R2_BUCKET_DEV`, `R2_BUCKET_PROD`, `R2_PUBLIC_URL_DEV`, `R2_PUBLIC_URL_PROD` | one R2 API token, Object Read & Write, both buckets | non-secret values written; token waiting on Jon |
| `resend.env` | `RESEND_API_KEY` | Resend | waiting on Jon |
| `prod.env` | `AUTH_SECRET` (production only) | generated on mighteous | done |

The app reads `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, and `R2_PUBLIC_URL` (plus `R2_TOKEN` for `@convex-dev/r2`). On the dev deployment set `R2_BUCKET` and `R2_PUBLIC_URL` from the `_DEV` values; production uses the `_PROD` values.

## Convex

- Project `cultremix` (team `curiousentity`). Dev deployment `vibrant-rook-798`.
- Production deployment `savory-tiger-504`: https://savory-tiger-504.convex.cloud and https://savory-tiger-504.convex.site. Created with `bunx convex deploy -y` from `~/Projects/CultRemix-deploy`.
- Production env set: `SITE_URL` and `AUTH_TRUSTED_ORIGINS` = https://cultremix-prod.jonthewayne.workers.dev, `APP_NAME=CultRemix`, `AUTH_EMAIL_FROM="CultRemix <onboarding@resend.dev>"`, `AUTH_EMAIL_PROVIDER=console` (switches to `resend` when the key lands), `AUTH_EMAIL_OTP_ENABLED=true`, `AUTH_MAGIC_LINK_ENABLED=false`, `AUTH_PHONE_ENABLED=false`, `AUTH_SMS_PROVIDER=console`, `PHONE_TEMP_EMAIL_DOMAIN`, `DEPLOYMENT_ENV=prod`, `FIRST_SUPER_ADMIN_EMAIL` (jonthewayne@gmail.com, pending Jon's confirmation), `R2_ENDPOINT`, `R2_BUCKET=cultremix-prod-public`, `R2_PUBLIC_URL`, and a new `AUTH_SECRET`. No `ENABLE_TEST_OTP_STORAGE` or `TEST_HELPER_SECRET`.
- Still to set on production: `AI_GATEWAY_API_KEY`, `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`.

## Cloudflare

- Account: Jonthewayne@gmail.com's Account (`e118a9fae1084226a1733eb812e337b5`); `workers.dev` subdomain `jonthewayne`. Wrangler on mighteous is signed in with OAuth.
- R2 is enabled.
- `cultremix-dev-public`: public at https://pub-9fa5537465754fb5a384ad1a5109a04f.r2.dev
- `cultremix-prod-public`: public at https://pub-4c63aeb732c445d5b2850fa3e9485f53.r2.dev
- CORS on both buckets: methods GET and PUT, header `Content-Type`, exposes `ETag`, max age 3600, from `https://mighteous.tailb6e2ea.ts.net:3000`, `https://mighteous.tailb6e2ea.ts.net:3001`, `http://localhost:3000`, and `https://cultremix-prod.jonthewayne.workers.dev`. Source: `~/cultremix-ops/r2-cors.json`; apply with `wrangler r2 bucket cors set <bucket> --file ~/cultremix-ops/r2-cors.json -y`.
- Production Worker: `cultremix-prod` at https://cultremix-prod.jonthewayne.workers.dev (`wrangler.jsonc` `env.production`, `.env.production`).

## Email

- Resend key: waiting on Jon.
- Sender: `onboarding@resend.dev` unless `cultremix.com` is verified in Resend; that sender delivers only to the Resend account's own address.

## Log

- 1:26 R2 confirmed enabled; buckets created with wrangler; `r2.dev` URLs on; CORS set.
- 1:37 Production `AUTH_SECRET` generated into `prod.env`.
- 2:04 B1 on `dev`; Convex production deployment created; production env set; `wrangler.jsonc` production vars and `.env.production` filled.
