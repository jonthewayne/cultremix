# Launch checklist

Staging is the hackathon build (Monad testnet, test checkout) and stays as the rehearsal for production. Production (`cultremix.com`) runs the same code and schema with its own data. Nothing is ever copied between environments; each one is set up by script.

Tick each box on the day. Values for env vars come from the owner's key store and are never pasted into docs, chat, or commits.

## Before either environment

- [ ] `bun run typecheck`, `bun run test`, and `bun run build` pass on the commit you're shipping.
- [ ] The build log (`docs/hackathon/log.md`) lists what this deploy needs (schema changes, jobs to run).
- [ ] The judge list (`judges.txt`, gitignored) has each judge's email and a username.

## Staging (`staging.cultremix.com`, Monad testnet)

### Accounts and keys

- [ ] Convex staging project exists; you have its deploy key for this session only.
- [ ] Cloudflare Worker for `staging.cultremix.com` and the `cultremix-staging-public` R2 bucket, with its own token limited to that bucket and a custom domain for images.
- [ ] CultRemix Gateway staging key, with a budget.

### Convex env (staging)

Set with the staging deploy key. See [Environment variables](environment-variables.md) for what each one does.

- [ ] `DEPLOYMENT_ENV=staging` (shows the Testnet badge on CR numbers and the header)
- [ ] `SITE_URL`, `AUTH_TRUSTED_ORIGINS`, `AUTH_SECRET` (new for staging, never copied)
- [ ] `AUTH_EMAIL_FROM`, `AUTH_EMAIL_PROVIDER`, `AUTH_EMAIL_OTP_ENABLED=true`, `RESEND_API_KEY` if email is on
- [ ] `FIRST_SUPER_ADMIN_EMAIL`
- [ ] `AI_GATEWAY_API_KEY`
- [ ] `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- [ ] Not set: `TEST_HELPER_SECRET`, `ENABLE_TEST_OTP_STORAGE`, `IMAGE_STORE`

### Deploy and seed

- [ ] Deploy Convex functions and schema to staging (new tables: `creatorAccess`, `metricsDays`, `metricsGenerators`; the hourly metrics job).
- [ ] Deploy the Worker with staging's `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`.
- [ ] `CONVEX_DEPLOY_KEY=<staging key> bun run seed:environment` — settings, switches, CR counters. Run it twice; the second run says “Already set up.”
- [ ] Sign in with the owner email and claim the owner account in Settings (Creator № 1).
- [ ] `/admin`: Studio and Publishing on; Checkout, Monad records, Backs, Print-size art off until each is ready.
- [ ] `/admin`: signup credits, daily image budget, and photo shoots per member look right.

### Judges

- [ ] `CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --dry-run --file judges.txt`
- [ ] `CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --file judges.txt`
- [ ] Send each judge their password privately from `.judges.local.json`, then delete the file.
- [ ] Sign in as one judge on a phone with **Have a password?**; the studio opens with 40 credits.

### Smoke test (phone and desktop)

- [ ] The header shows **Testnet**; CR numbers on the feed and shop pages carry the Testnet badge.
- [ ] A new member signs in with an email code, picks a username, and gets their starting credits.
- [ ] Studio: two images and a style in the mixer; Generate gives four designs; credits drop by 2.
- [ ] Publish one: the CR reveal, the feed row, the model photo arrives, the shop page loads.
- [ ] Remix it: the result publishes as the next number in the family.
- [ ] `/admin/metrics` → **Recount these 7 days** shows today's sign-ups, batches, designs, and works.
- [ ] Signed out: the feed and a shop page load; the studio asks to sign in.

## Production (`cultremix.com`, Monad mainnet)

Production has been live since 2026-09-29, so most of this is about the new launch pieces.

### Convex env (production)

- [ ] `DEPLOYMENT_ENV=prod` (shows Early access until Checkout is on)
- [ ] Every key above with production values (`cultremix-prod-public` bucket, prod gateway key and budget); nothing copied from staging.
- [ ] Not set: `TEST_HELPER_SECRET`, `ENABLE_TEST_OTP_STORAGE`. `bun run doctor:deployment` checks this.
- [ ] `AUTH_INSTANT_SIGNIN` turned off once real email is live (`RESEND_API_KEY`, `AUTH_EMAIL_PROVIDER=resend`, `AUTH_EMAIL_FROM="CultRemix <auth@cultremix.com>"`).

### Deploy and seed

- [ ] Staging smoke passed on the same commit.
- [ ] Deploy Convex to production, then the Worker (`bun run deploy:prod`).
- [ ] `bun run seed:environment -- --prod` (asks you to type `production`). It only adds what's missing, so the existing settings and CR numbers stay.
- [ ] `/admin`: the switches match staging's except where production should differ.
- [ ] `/admin/metrics` → **Recount these 90 days** once, so the history from before the launch fills in.

### Judges (only if they judge on production)

- [ ] `bun run judges:provision -- --prod --file judges.txt`
- [ ] Send passwords privately; delete `.judges.local.json`.

### Smoke test

- [ ] The header shows **Early access**, and no Testnet badge appears anywhere.
- [ ] The staging smoke list above, on a phone, with one real batch.
- [ ] Turn off creator access for judges after judging (**Admin → Members**).

## After launch

- [ ] Fill in [Launch metrics](launch/metrics.md) each day from `/admin/metrics`.
- [ ] Keep [Cohort notes](launch/cohort.md) for the first members.
- [ ] Turn Checkout on only when the store is ready; production's Early access label goes away by itself.
