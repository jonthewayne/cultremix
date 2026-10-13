# Cloudflare Deployment

The starter deploys a TanStack Start server entry to Cloudflare Workers with `nodejs_compat`.

## How CultRemix deploys

This repo has no GitHub deploy workflow: the starter's GitHub Actions workflow, with the branches, secrets, and variables it needed, never came into it. Deploys run by hand from the package scripts, in the one checkout on mighteous (`~/Projects/CultRemix`); since October 12 there are no clones or worktrees. The CultRemix Builder thread builds and deploys production from it, in the order under [Production deploys](#production-deploys). A production build there reads `.env.production` over `.env.local`'s dev values, so its pages point only at production, and the dev values it copies into `dist/server/.dev.vars` are for local previews and never uploaded: on October 12 its build matched the old deploy clone's exactly, and the dry run in step 2 listed only production's four settings. Staging is described below.

Provider secrets such as `AUTH_SECRET`, `RESEND_API_KEY`, and `TELNYX_API_KEY` live in Convex backend env vars.

Do not set local/dev test helpers in production Convex env. Production should exclude `TEST_HELPER_SECRET` and `ENABLE_TEST_OTP_STORAGE`.

## Important Cloudflare Vite Detail

The Cloudflare Vite plugin flattens `wrangler.jsonc` during build. Select `CLOUDFLARE_ENV` before building production or development:

```bash
CLOUDFLARE_ENV=production bun run build
CLOUDFLARE_ENV=development bun run build
```

Staging (`env.staging`, Worker `cultremix-staging` at `staging.cultremix.com`) builds in Vite's `staging` mode so the browser bundle reads `.env.staging` instead of `.env.production`: `bun run deploy:staging`. The steps are in `docs/launch-checklist.md`.

## Production deploys

Production's pages (the Worker) and its functions (Convex) only work in matching pairs. On October 11, the Worker then on production showed "Something went wrong!" on work pages and an empty feed when run against the new functions, and the new Worker crashed work pages against the old functions. So each production deploy goes in this order:

1. Back up production: `bunx convex export --prod --include-file-storage --path ~/cultremix-backups/prod-before-<commit>-<date>.zip`. The zip holds every table and stored file, members' emails included, so it stays private and out of any repo. On dev, where most images are already in R2, the export took 6 seconds; production's first big deploy takes longer, since all its images are still in Convex storage.
2. Build the Worker: `CLOUDFLARE_ENV=production bun run build`. A dry run of that build (`bunx wrangler deploy --dry-run`) names the Worker `cultremix-prod` and production's Convex address.
3. Deploy both, back to back: `bunx convex deploy -y && WRANGLER_LOG_PATH=.wrangler/logs bunx wrangler deploy`. With the build done, only the Worker upload sits between the two. A failed Convex deploy changes nothing, and `&&` then skips the Worker.
4. Run the data steps: `bun run deploy:migrate -- --prod`, then type `production` when it asks (in a shell without a terminal the question gets no answer and nothing runs, so pipe it in: `echo production | bun run deploy:migrate -- --prod`). It seeds missing switches, moves images into R2, and fills in what earlier code left out, in this order: `seed:environment`, `sizing:organize` (run a second time when the first moved anything, which retries failures and confirms nothing is left), `sizing:backfill`, `imageNotes:backfillWorks` (a second pass when a reading failed), `images:reanalyzeAll`, `remixFields:backfill`, `remixPartsActions:backfillWorks`, `activity:backfill`, `lineage:backfillEffectiveParents`, and `trending:rebuild`. It follows every cursor and continuation itself, prints each result beside what the October 11 rehearsal on a copy of production reported, and ends with anything that needs a look. A failed step stops the run and names itself; fix the cause and run again with `--from <step>` (steps: seed, organize, sizes, notes, reread, words, parts, activity, lineage, trending). Every step is safe to rerun, `--only <a,b>` runs just those, and `--skip <a,b>` leaves some out. Without `--prod` it runs on dev, and with `CONVEX_DEPLOY_KEY` set for the command, on staging. Pages already work before the steps finish: a switch with no saved row uses its default, and an image still in Convex storage loads through the `/img/` route until it moves to R2.

   The two image steps stop each run after about 6 minutes. Called on their own they schedule their continuation, which only `bunx convex logs` shows finishing; the runner passes `returnNext` so each run returns where it stopped and the runner calls it again from there. `--one-page-runs` makes every run stop after one page, to check that path on a deployment too small to reach 6 minutes.

If something breaks after step 3, fix it forward with another deploy. Rolling back only the Worker (`bunx wrangler rollback`) puts the old pages in front of the new functions, which is the crash above. Restoring the backup is the last resort and needs Jon's go-ahead, because it throws away everything written after the backup:

1. With the new functions still deployed, run `bunx convex import --prod --replace-all -y <the backup zip>`. From 8bc367d (production since September 30) to the October deploy, the schema only gained tables, optional fields, and indexes, so the old data fits the new schema. For a later deploy, check the same with `git diff <old commit> -- convex/schema.ts convex/schema/`.
2. From a checkout of the old commit, run `bunx convex deploy -y && bun run deploy:prod`.

Importing production's export into a fresh deployment worked in the October 11 rehearsal below (393 records and 118 files, the auth and email components included). Restoring over production itself hasn't been tried, so go through it with the Builder first. A restore keeps production's `AUTH_SECRET` (env vars aren't in the export), so sign-in keeps working.

## Rehearsing a big deploy

Before the October deploy, the whole Ops sequence ran on a copy of production without touching it, on October 11 and again on October 12 from a fresh export. Every step passed; the Ops message carries the numbers. The second run also set `MANAGED_WALLET_SECRET` on the copy: within five minutes all 8 members had managed wallets, so the 11 earlier works' records would no longer wait for wallets. It also caught a check that only fails on production: the smoke test expects "Monad mainnet" on /onchain, which said "Monad" (fixed in 5ca3163).

1. Export production, read-only: `bunx convex export --prod --include-file-storage --path <zip>`. It holds members' emails, so keep it private and delete it afterwards.
2. With production's commit checked out away from the dev server (the October 11 and 12 rehearsals used a temporary worktree; since October 12 the rule is one checkout, so ask Jon before making another copy), start a local backend with `CONVEX_AGENT_MODE=anonymous bunx convex dev < /dev/null` (without the redirect it waits at a first-run question). Give it production's env names with safe values: no Resend key, `AUTH_EMAIL_PROVIDER=console` (sign-in codes go to its log), and a fresh `AUTH_SECRET`. Then `bunx convex import --replace-all -y <zip>`.
3. For R2, run a local S3 server (`s3rver` on 127.0.0.1; the SDK switches to path-style addresses for an IP endpoint) and point the copy's `R2_*` values at it. Never use dev's bucket: work keys like `works/101/001/` exist in both, and step 7's cleanup deletes everything outside `members/` and `works/` in whatever bucket it's given.
4. Check out the new commit, run `bun install`, and let the watcher push it: that's the deploy. Build the Worker with `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` exported for the local backend, and serve it with `wrangler dev --var VITE_CONVEX_URL:... --var VITE_CONVEX_SITE_URL:... --var SITE_URL:...`, because the built config's own vars point at dev.
5. Run the message's seeds and backfills and its cleanup, the e2e smoke from that checkout (`BASE_URL=http://127.0.0.1:<port> bash tests/e2e/run-e2e.sh`), and sign in to look at the studio and Admin.

Signing in on the copy needs one more step. Production's auth signing key (the `betterAuth` component's `jwks` table) is encrypted with production's `AUTH_SECRET`, so under a fresh secret every token request fails with "Failed to decrypt private key" until that table is emptied: `bunx convex import --component betterAuth --table jwks --replace -y --format jsonArray <a file holding []>`. Production would fail the same way if its `AUTH_SECRET` ever changed.

## Open tabs after a deploy

A tab opened before a deploy keeps running the build it loaded. Its next page can ask for a code file the new build no longer has, which used to break that page, and its live queries keep calling functions that may have changed. Every build knows its git commit (`vite.config.ts` sets it, and `CULTREMIX_BUILD_ID` overrides it), and `/version.json` says which one is live (`{"build":"ab6cf9e"}`, never cached). An open tab checks it when it comes back into view and every five minutes, and once a newer build is live, its next click to another page loads that page fresh (`src/lib/buildVersion.ts`). A code file that fails to load mid-click loads where the click was going, and a page that errors after a deploy loads itself fresh, at most once a minute. On October 12, two production builds served in turn by `wrangler dev`: a tab opened on the first build moved onto the second at its next click, a tab that clicked a page whose code the second build didn't have landed on that page instead of breaking, and a tab opened on the second build never reloaded.

`/version.json` also tells Ops what's live: the smoke test prints it (`Live build: …`), and it should match the commit the Ops message names.

## Security Headers

`src/start.ts` adds security headers to every response the Worker makes (pages, server routes such as `/economics/v1.json`, and server functions): `X-Frame-Options: DENY` with a Content-Security-Policy of `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that turns off the camera, microphone, location, payment, and USB. On `cultremix.com` and its subdomains it also sends `Strict-Transport-Security` for a year, without `includeSubDomains`, so a subdomain pointed at another service later isn't pinned by it. The policy doesn't limit scripts, styles, images, or connections; that would need every Convex, R2, and Shopify origin listed and tested first. TanStack Start reads `src/start.ts` when the server starts, so a running dev server needs a restart to send them. The e2e smoke test checks them on any `https://` `BASE_URL`.

## Type Generation

```bash
bun run cf-typegen
```

This writes Worker binding types from `wrangler.jsonc`. Runtime Worker vars are not the same as Vite build-time `.env.{mode}` values.

## Wrangler Logs

The package scripts set `WRANGLER_LOG_PATH=.wrangler/logs` so Wrangler writes debug logs inside the project instead of the user-level Wrangler config directory. `.wrangler/` is ignored by git. This avoids sandbox permission noise in agent environments while preserving local logs when Wrangler needs them.
