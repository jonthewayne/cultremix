# Accounts and setup (ops lane)

Ops record for the 2026-09-29 sprint. No secrets here. Keys live only on mighteous in `~/.config/cultremix/*.env` (mode 600); save them with `~/.config/cultremix/put-secret <file>.env VAR ...`, which reads each value from a hidden prompt.

## Secret files

| File | Variables | Status |
|---|---|---|
| `gateway.env` | `AI_GATEWAY_API_KEY` (Vercel AI Gateway key `cultremix`) | saved 3:05; set on dev and production |
| `r2.env` | not secret: `R2_ENDPOINT`, `R2_BUCKET_DEV`, `R2_BUCKET_PROD`, `R2_PUBLIC_URL_DEV`, `R2_PUBLIC_URL_PROD`; secret, not created today: `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | no R2 token today; images use Convex storage |
| `resend.env` | `RESEND_API_KEY` | not today: Jon chose no email sending |
| `prod.env` | `AUTH_SECRET` (production only) | set on production |

The app stores images in R2 whenever `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are all set; otherwise `IMAGE_STORE=convex` uses Convex file storage served from `/img/`. Setting the two R2 keys later switches new images to R2 with no other change.

## Convex

- Project `cultremix` (team `curiousentity`). Dev deployment `vibrant-rook-798`.
- Production deployment `savory-tiger-504`: https://savory-tiger-504.convex.cloud and https://savory-tiger-504.convex.site. Deployed with `bunx convex deploy -y` from `~/Projects/CultRemix-deploy`.
- Production env: `SITE_URL` and `AUTH_TRUSTED_ORIGINS` = https://cultremix-prod.jonthewayne.workers.dev, `APP_NAME=CultRemix`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_PROVIDER=console`, `AUTH_EMAIL_OTP_ENABLED=true`, `AUTH_MAGIC_LINK_ENABLED=false`, `AUTH_PHONE_ENABLED=false`, `AUTH_SMS_PROVIDER=console`, `PHONE_TEMP_EMAIL_DOMAIN`, `DEPLOYMENT_ENV=prod`, `FIRST_SUPER_ADMIN_EMAIL=jonthewayne@gmail.com`, `R2_ENDPOINT`, `R2_BUCKET=cultremix-prod-public`, `R2_PUBLIC_URL`, `AUTH_SECRET`, `AI_GATEWAY_API_KEY`, `IMAGE_STORE=convex`. No `ENABLE_TEST_OTP_STORAGE`, `TEST_HELPER_SECRET`, or ChatGPT token.
- Images on production go through the Vercel AI Gateway (Jon's decision at 3:05). The dev deployment also has `CHATGPT_ACCESS_TOKEN` and `CHATGPT_ACCOUNT_ID` (set by the Builder at 3:01), and the app prefers them, so dev images spend Jon's ChatGPT plan until they are removed.

## Sign-in without email

Production uses the console email provider: nothing is sent, and each sign-in code is written to the production logs as an `[email.console]` line (Convex dashboard → cultremix → Production → Logs).

## Cloudflare

- Account: Jonthewayne@gmail.com's Account (`e118a9fae1084226a1733eb812e337b5`); `workers.dev` subdomain `jonthewayne`. Wrangler on mighteous is signed in with OAuth.
- R2 buckets `cultremix-dev-public` (https://pub-9fa5537465754fb5a384ad1a5109a04f.r2.dev) and `cultremix-prod-public` (https://pub-4c63aeb732c445d5b2850fa3e9485f53.r2.dev), both with CORS for GET and PUT from the tailnet dev URLs, `http://localhost:3000`, and the production URL (`~/cultremix-ops/r2-cors.json`). Unused until an R2 token exists.
- Production Worker `cultremix-prod` at https://cultremix-prod.jonthewayne.workers.dev (`wrangler.jsonc` `env.production`, `.env.production`); deploy with `bun run deploy:prod` from the deploy clone.

## Domain

- `cultremix.com` is registered through Vercel (Name.com) with DNS on Cloudflare since 4:20 p.m. (zone active; nameservers `brenna.ns.cloudflare.com` and `leonidas.ns.cloudflare.com`).
- `cultremix.com` and `www.cultremix.com` are custom domains on `cultremix-prod` (`wrangler.jsonc` `env.production.routes`); `workers.dev` stays on.
- Production `SITE_URL=https://cultremix.com` (Convex and Worker); `AUTH_TRUSTED_ORIGINS` = `https://cultremix.com`, `https://www.cultremix.com`, `https://cultremix-prod.jonthewayne.workers.dev`. R2 CORS includes both new origins.
- Wrangler's OAuth login cannot read or edit DNS records, so conflicting records must be deleted in the dashboard before attaching a custom domain.
- Share tags (`og:url`, `og:image`) come from the hardcoded `SITE_URL` in `src/lib/site.ts`, still the `workers.dev` URL.

## Log

- 1:26 R2 enabled; buckets created; `r2.dev` URLs on; CORS set.
- 2:04 Convex production deployment created and its env set; production vars filled; first `deploy:prod`.
- 3:07 Gateway key saved and verified ($22.16 credit); set on production and dev.
- 3:09 Production redeployed from `dev` at `7b273ee`; `IMAGE_STORE=convex` on production; production self-test generated and stored a transparent design through the gateway; Worker version `9a5df58e`.
- 3:12 Image check and demo seeds done (`docs/setup/image-check.md`, `~/cultremix-seed/`); submission draft in `docs/hackathon/submission.md`.
- 3:50 Production deployed from `dev` at `f2d02db` (Convex, then Worker version `5dfc3fb0`); `AUTH_INSTANT_SIGNIN=true` (the first try got a Convex 503; the retry worked); `bootstrap:ensureDefaults` had nothing to add. Smoke test in fresh browser sessions: a new email reached onboarding in 6.6 s with no code; the owner email got the code box. Test account `ops-smoke-280336@example.com` left on production. Turn off with `bunx convex env set --prod AUTH_INSTANT_SIGNIN false`.
- 4:24 Production Worker deployed from `dev` at `bf3191c` (icon, share image, metadata); version `d973e362`.
- 4:37 Custom domains attached after Jon deleted the Vercel records imported into the zone; 4:40 `SITE_URL` and `AUTH_TRUSTED_ORIGINS` switched to `cultremix.com`; Worker version `ac0e8b3b`. Instant sign-in checked in fresh browser sessions on `cultremix.com` (6.8 s to onboarding) and `workers.dev` (8.5 s). Test accounts `ops-smoke-crworkers-32803@example.com` and `ops-smoke-domain-57972@example.com` left on production.
