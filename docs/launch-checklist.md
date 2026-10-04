# Launch checklist

Staging is the hackathon build (Monad testnet, test checkout) and stays as the rehearsal for production. Production (`cultremix.com`) runs the same code and schema with its own data. Nothing is ever copied between environments; each one is set up by script.

Tick each box on the day. Values for env vars come from the owner's key store and are never pasted into docs, chat, or commits.

## Before either environment

- [ ] `bun run typecheck`, `bun run test`, and `bun run build` pass on the commit you're shipping.
- [ ] The build log (`docs/hackathon/log.md`) lists what this deploy needs (schema changes, jobs to run).
- [ ] The judge list (`judges.txt`, gitignored) has each judge's email and a username.

## Staging (`staging.cultremix.com`, Monad testnet)

Follow these in order. Each step says exactly what to run or click; nothing here needs a decision. Commands run from a clean checkout of the commit you're shipping, in a login shell (`zsh -lc`), from the repo root. Wherever a step says `<staging key>`, use the staging deploy key from step 1, set only for that command and never saved to a file.

### 1. A separate Convex project for staging

Staging gets its own Convex project, so its data, env, and keys can never mix with dev or production.

- [ ] In the Convex dashboard, on the same team as production, **Create project** named `cultremix-staging`.
- [ ] Open the project's **Production** deployment (this is staging; the project has no other use). Note its two URLs from **Settings → URL & deploy key**: `https://<name>.convex.cloud` and `https://<name>.convex.site`.
- [ ] On the same page, **Generate production deploy key**. Keep it in the owner's key store as `CONVEX_DEPLOY_KEY_STAGING`. Every command below that says `CONVEX_DEPLOY_KEY=<staging key>` reaches staging only.
- [ ] Never pass `--prod` with the staging key, and never run `bunx convex dev` against it.

### 2. The R2 bucket

- [ ] Create the bucket: `wrangler r2 bucket create cultremix-staging-public`.
- [ ] Turn on its public URL: `wrangler r2 bucket dev-url enable cultremix-staging-public`. Note the `https://pub-….r2.dev` address it prints; that's `R2_PUBLIC_URL`.
- [ ] CORS: copy production's policy (`~/cultremix-ops/r2-cors.json`) to `~/cultremix-ops/r2-cors-staging.json`, set its allowed origins to `https://staging.cultremix.com` and `https://cultremix-staging.jonthewayne.workers.dev` (GET and PUT), then `wrangler r2 bucket cors set cultremix-staging-public --file ~/cultremix-ops/r2-cors-staging.json`. The Print Studio's knockout preview and studio uploads need it.
- [ ] In the Cloudflare dashboard, **R2 → Manage API tokens → Create API token**: permission **Object Read & Write**, limited to `cultremix-staging-public` only. Save the access key ID and secret in the key store; they're shown once.
- [ ] `R2_ENDPOINT` is `https://e118a9fae1084226a1733eb812e337b5.r2.cloudflarestorage.com` (the account's S3 endpoint).

There is one public bucket per environment and no private bucket: published works live under `works/<family>/<expression>/`, and everything else sits under an unguessable 128-bit code. See [Storage and sizes](image-generation/README.md#storage-and-sizes).

### 3. Keys for staging's own services

Each is new for staging, with its own limit, and never copied from production.

- [ ] CultRemix Gateway: a staging key with a budget.
- [ ] fal: a staging key with a spend limit set in fal's dashboard.
- [ ] Resend: a staging API key for the verified `cultremix.com` domain.
- [ ] `AUTH_SECRET`: a fresh one, `openssl rand -base64 32`. Store it; don't reuse dev's or production's.

### 4. Convex env (staging)

Set each with `CONVEX_DEPLOY_KEY=<staging key> bunx convex env set NAME 'value'`. Paste secret values straight from the key store into your terminal; never into docs, chat, or commits. What each one does is in [Environment variables](environment-variables.md).

Which environment this is:

- [ ] `DEPLOYMENT_ENV=staging`: shows the **Testnet** badge on CR numbers and the header, and turns off the dev stand-in generator.

Site and sign-in:

- [ ] `SITE_URL=https://staging.cultremix.com`
- [ ] `AUTH_TRUSTED_ORIGINS=https://staging.cultremix.com,https://cultremix-staging.jonthewayne.workers.dev`
- [ ] `AUTH_SECRET` (from step 3)
- [ ] `APP_NAME=CultRemix`
- [ ] `AUTH_EMAIL_PROVIDER=resend`
- [ ] `AUTH_EMAIL_FROM='CultRemix <heyyo@cultremix.com>'`
- [ ] `RESEND_API_KEY` (from step 3)
- [ ] `AUTH_EMAIL_OTP_ENABLED=true`
- [ ] `AUTH_MAGIC_LINK_ENABLED=false`
- [ ] `AUTH_PHONE_ENABLED=false`
- [ ] `AUTH_SMS_PROVIDER=console`
- [ ] `FIRST_SUPER_ADMIN_EMAIL` (the owner's email, the same as production's)

Images and print:

- [ ] `AI_GATEWAY_API_KEY` (from step 3)
- [ ] `R2_ENDPOINT`, `R2_BUCKET=cultremix-staging-public`, `R2_PUBLIC_URL` (from step 2)
- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (from step 2)
- [ ] `FAL_KEY` (from step 3)

Leave these unset (each has a working default): `IMAGE_PROVIDER`, `IMAGE_QUALITY`, `PHOTO_QUALITY`, `STYLE_NOTES_MODEL`, `GRID_QUALITY`, `STUDIO_LAYOUT`, `PHONE_TEMP_EMAIL_DOMAIN`.

Must not be set on staging: `TEST_HELPER_SECRET`, `ENABLE_TEST_OTP_STORAGE`, `IMAGE_STORE`, `AUTH_INSTANT_SIGNIN`, `CHATGPT_ACCESS_TOKEN`, `CHATGPT_ACCOUNT_ID`, `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`.

- [ ] Check: `CONVEX_DEPLOY_KEY=<staging key> bunx convex env list` shows exactly the names above, and none from the must-not list.

### 5. Worker env

The staging Worker is `cultremix-staging`, served at `staging.cultremix.com`. Its settings are in two committed, non-secret files; the app's secrets all live in Convex, so the Worker has none.

- [ ] In `wrangler.jsonc` → `env.staging.vars`, replace `REPLACE_WITH_STAGING_DEPLOYMENT` in `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` with the staging deployment's name from step 1. `SITE_URL` is already `https://staging.cultremix.com`. Don't touch `env.production`.
- [ ] In `.env.staging`, make the same two replacements. The browser bundle takes its Convex address from this file at build time; `wrangler.jsonc` covers the server side.
- [ ] Commit both files on the release branch.
- [ ] In the Cloudflare dashboard, make sure `cultremix.com` has no DNS record named `staging`; the deploy creates it. Wrangler's login can't remove one.

### 6. Deploy

- [ ] `bun run typecheck && bun run test && bun run build` pass.
- [ ] Convex functions and schema: `CONVEX_DEPLOY_KEY=<staging key> bunx convex deploy`. On a fresh project this creates every table, including `photoShootStarts`, the lineage, social, and print tables, and the hourly metrics job.
- [ ] Worker: `bun run deploy:staging`. It builds with `.env.staging` and `CLOUDFLARE_ENV=staging`, then deploys `cultremix-staging` with the `staging.cultremix.com` custom domain.
- [ ] `https://staging.cultremix.com` loads with the **Testnet** badge in the header. If the custom domain isn't ready yet, `https://cultremix-staging.jonthewayne.workers.dev` should work already.

### 7. Seed and backfill

- [ ] `CONVEX_DEPLOY_KEY=<staging key> bun run seed:environment`: app settings, every switch at its default, CR counters.
- [ ] Run it a second time; it says “Already set up. Nothing changed.”
- [ ] `CONVEX_DEPLOY_KEY=<staging key> bunx convex run activity:backfill`. On a fresh staging there's nothing to fill, and it returns `isDone: true`. It's safe to rerun, and it's needed if any works were published before the deploy.
- [ ] Sign in with the owner email and claim the owner account in **Settings** (Creator № 1).
- [ ] In `/admin`, set the switches:
  - On: **Studio**, **Publishing**, and **Print-size art** (the Print Studio's upscale; it needs `FAL_KEY`).
  - Off: **Checkout**, **Monad records**, and **Backs**, until each one's builder says it's ready.
- [ ] Check `/admin` settings: signup credits (24), daily image budget, and **Photo shoots per member per day** (3).

### 8. Judges

- [ ] `judges.txt` (gitignored) has one judge per line: email, then username.
- [ ] Dry run: `CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --dry-run --file judges.txt`
- [ ] Provision: `CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --file judges.txt`
- [ ] Send each judge their password privately from `.judges.local.json`, then delete the file.
- [ ] Sign in as one judge on a phone with **Have a password? Sign in with it**: the studio opens with 40 credits.
- [ ] Put the staging link in the [submission](hackathon/submission.md#links).

### 9. Smoke test (phone and desktop)

- [ ] The header shows **Testnet**, and CR numbers on the feed and work pages carry the Testnet badge.
- [ ] A new member signs in with an email code, picks a username, and gets their starting credits.
- [ ] Studio: two images and a style in the mixer. Generate gives four designs, and credits drop by 2. Heart one; it shows in the favorites tray. Open it full screen.
- [ ] Publish one: the CR reveal, the feed row, the model photo arrives, and the work page loads with its fingerprint, Economics panel, and Lineage.
- [ ] `https://staging.cultremix.com/economics/v1.json` loads, and `curl -s https://staging.cultremix.com/economics/v1.json | shasum -a 256` matches the hash on the Economics panel.
- [ ] Remix it as a variation: it publishes as the next number in the family. Remix again as a fork: it starts a new family and says “Forked from”.
- [ ] Photo shoot limit: as a member (not the owner), publish a fourth work in one day. It publishes; its photo says “Photo coming soon”, and its creator sees “You’ve had your photo shoots for today. Try again tomorrow.”
- [ ] Print Studio: from your own work's page, **Prepare for print**. Knock out, upscale (2 credits), and make the print file; its SHA-256 shows.
- [ ] Social: follow the remixer and see their work under **Following**. Heart a work; the count goes up. `/u/<username>` loads signed out.
- [ ] `/admin/lineage`: look up the variation's CR and see its lineage. Don't confirm a test correction unless you mean to keep it.
- [ ] `/admin/metrics` → **Recount these 7 days** shows today's sign-ups, batches, designs, and works.
- [ ] Signed out: the feed, a work page, and a profile load; the studio asks to sign in.

## Production (`cultremix.com`, Monad mainnet)

Production has been live since 2026-09-29, so most of this is about the new launch pieces.

### Convex env (production)

- [ ] `DEPLOYMENT_ENV=prod` (shows Early access until Checkout is on)
- [ ] Every key above with production values (`cultremix-prod-public` bucket, prod gateway key and budget, a prod `FAL_KEY` with its own fal spend limit); nothing copied from staging.
- [ ] Not set: `TEST_HELPER_SECRET`, `ENABLE_TEST_OTP_STORAGE`. `bun run doctor:deployment` checks this.
- [ ] `AUTH_INSTANT_SIGNIN` turned off once real email is live (`RESEND_API_KEY`, `AUTH_EMAIL_PROVIDER=resend`, `AUTH_EMAIL_FROM="CultRemix <auth@cultremix.com>"`).

### Deploy and seed

- [ ] Staging smoke passed on the same commit.
- [ ] Deploy Convex to production, then the Worker (`bun run deploy:prod`).
- [ ] `bun run seed:environment -- --prod` (asks you to type `production`). It only adds what's missing, so the existing settings and CR numbers stay.
- [ ] `bunx convex run --prod activity:backfill`, so works published before the social merge show in Following and on profiles. It's safe to rerun.
- [ ] `bunx convex run --prod lineage:backfillEffectiveParents`, then again with `'{"cursor":"<cursor it returned>"}'` until the cursor is `null`, so older remixes show under **Remixes of this**.
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
