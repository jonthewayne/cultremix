# Cloudflare Deployment

The starter deploys a TanStack Start server entry to Cloudflare Workers with `nodejs_compat`.

## How CultRemix deploys

This repo has no GitHub deploy workflow: the starter's GitHub Actions workflow, with the branches, secrets, and variables it needed, never came into it. Deploys run by hand from the package scripts. Only the Ops thread deploys production, from the Builder's latest Ops message and in the order under [Production deploys](#production-deploys). Staging is described below.

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
4. Run the Ops message's seeds and backfills. Pages already work before they finish: a switch with no saved row uses its default, and an image still in Convex storage loads through the `/img/` route until `sizing:organize` moves it to R2.

If something breaks after step 3, fix it forward with another deploy. Rolling back only the Worker (`bunx wrangler rollback`) puts the old pages in front of the new functions, which is the crash above. Restoring the backup is the last resort and needs Jon's go-ahead, because it throws away everything written after the backup:

1. With the new functions still deployed, run `bunx convex import --prod --replace-all -y <the backup zip>`. From 8bc367d (production since September 30) to the October deploy, the schema only gained tables, optional fields, and indexes, so the old data fits the new schema. For a later deploy, check the same with `git diff <old commit> -- convex/schema.ts convex/schema/`.
2. From a checkout of the old commit, run `bunx convex deploy -y && bun run deploy:prod`.

The import hasn't been rehearsed against a copy of production, so go through it with the Builder before running it.

## Security Headers

`src/start.ts` adds security headers to every response the Worker makes (pages, server routes such as `/economics/v1.json`, and server functions): `X-Frame-Options: DENY` with a Content-Security-Policy of `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that turns off the camera, microphone, location, payment, and USB. On `cultremix.com` and its subdomains it also sends `Strict-Transport-Security` for a year, without `includeSubDomains`, so a subdomain pointed at another service later isn't pinned by it. The policy doesn't limit scripts, styles, images, or connections; that would need every Convex, R2, and Shopify origin listed and tested first. TanStack Start reads `src/start.ts` when the server starts, so a running dev server needs a restart to send them. The e2e smoke test checks them on any `https://` `BASE_URL`.

## Type Generation

```bash
bun run cf-typegen
```

This writes Worker binding types from `wrangler.jsonc`. Runtime Worker vars are not the same as Vite build-time `.env.{mode}` values.

## Wrangler Logs

The package scripts set `WRANGLER_LOG_PATH=.wrangler/logs` so Wrangler writes debug logs inside the project instead of the user-level Wrangler config directory. `.wrangler/` is ignored by git. This avoids sandbox permission noise in agent environments while preserving local logs when Wrangler needs them.
