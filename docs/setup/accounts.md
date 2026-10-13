# Accounts and setup (ops lane)

Ops record for the 2026-09-29 sprint. No secrets here. Keys live only on mighteous in `~/.config/cultremix/*.env` (mode 600); save them with `~/.config/cultremix/put-secret <file>.env VAR ...`, which reads each value from a hidden prompt.

## Secret files

| File | Variables | Status |
|---|---|---|
| `gateway.env` | `AI_GATEWAY_API_KEY` (Vercel AI Gateway key `cultremix`) | saved 3:05; set on dev and production |
| `r2.env` | not secret: `R2_ENDPOINT`, `R2_BUCKET_DEV`, `R2_BUCKET_PROD`, `R2_PUBLIC_URL_DEV`, `R2_PUBLIC_URL_PROD`; secret: `R2_TOKEN_DEV`, `R2_TOKEN_PROD` (one Cloudflare token per bucket, Object Read & Write on that bucket only, created Oct 2) and the S3 keys derived from each, `R2_ACCESS_KEY_ID_DEV`/`_PROD` (the token's ID) and `R2_SECRET_ACCESS_KEY_DEV`/`_PROD` (SHA-256 of the token value) | set on dev Oct 2 (as `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`); production waits for the Ops thread |
| `resend.env` | `RESEND_API_KEY` (sending access only) | saved 4:46; set on production |
| `prod.env` | `AUTH_SECRET` (production only) | set on production |

The app stores images in R2 whenever `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are all set; otherwise `IMAGE_STORE=convex` uses Convex file storage served from `/img/`. Setting the R2 keys switches new images to R2 with no other change; `sizing:organize` then moves the older ones into their folders (see `docs/image-generation/README.md`, "Storage and sizes"). Each key is refused by the other environment's bucket (checked Oct 2).

## Convex

- Project `cultremix` (team `curiousentity`). Dev deployment `vibrant-rook-798`.
- Production deployment `savory-tiger-504`: https://savory-tiger-504.convex.cloud and https://savory-tiger-504.convex.site. Deployed with `bunx convex deploy -y` from `~/Projects/CultRemix`, the only checkout ([Production deploys](../deployment-cloudflare.md#production-deploys)).
- Production env: `SITE_URL` and `AUTH_TRUSTED_ORIGINS` = https://cultremix-prod.jonthewayne.workers.dev, `APP_NAME=CultRemix`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_PROVIDER=console`, `AUTH_EMAIL_OTP_ENABLED=true`, `AUTH_MAGIC_LINK_ENABLED=false`, `AUTH_PHONE_ENABLED=false`, `AUTH_SMS_PROVIDER=console`, `PHONE_TEMP_EMAIL_DOMAIN`, `DEPLOYMENT_ENV=prod`, `FIRST_SUPER_ADMIN_EMAIL` (Jon's Gmail), `R2_ENDPOINT`, `R2_BUCKET=cultremix-prod-public`, `R2_PUBLIC_URL`, `AUTH_SECRET`, `AI_GATEWAY_API_KEY`, `IMAGE_STORE=convex`. No `ENABLE_TEST_OTP_STORAGE`, `TEST_HELPER_SECRET`, or ChatGPT token.
- Images on production go through the Vercel AI Gateway (Jon's decision at 3:05). The dev deployment also has `CHATGPT_ACCESS_TOKEN` and `CHATGPT_ACCOUNT_ID` (set by the Builder at 3:01), and the app prefers them, so dev images spend Jon's ChatGPT plan until they are removed.

## Email

Production sends sign-in codes through Resend from `CultRemix <heyyo@cultremix.com>` (changed from `auth@` at 5:01) (`AUTH_EMAIL_PROVIDER=resend`, since 4:47). `cultremix.com` is verified in Resend; its DKIM (`resend._domainkey`) and `send` records were added to Cloudflare by Resend's automatic setup. Checked October 12: those records are live, and there is no DMARC record (`_dmarc.cultremix.com`). Gmail only requires DMARC of bulk senders, but some inboxes count its absence against a sender, so a TXT record `_dmarc` with `v=DMARC1; p=none` is worth adding (it only reports and never blocks mail; the Ops message lists it as optional). The Convex Resend component runs with `testMode: false`. Instant sign-in is gone: PR #1 was merged and deployed at 5:07 and `AUTH_INSTANT_SIGNIN` is unset, so every sign-in needs the emailed code.

Inbound: Cloudflare Email Routing is enabled on `cultremix.com` (MX `route1-3.mx.cloudflare.net`, root SPF `include:_spf.mx.cloudflare.net`, DKIM `cf2024-1._domainkey`). Rule `heyyo-to-gmail` forwards `heyyo@cultremix.com` to Jon's Gmail (a verified destination). The catch-all is off, so other addresses are dropped. Manage with `wrangler email routing rules list cultremix.com`.

## Cloudflare

- Account: Jon's Cloudflare account (`e118a9fae1084226a1733eb812e337b5`); `workers.dev` subdomain `jonthewayne`. Wrangler on mighteous is signed in with OAuth.
- R2 buckets `cultremix-dev-public` (https://pub-9fa5537465754fb5a384ad1a5109a04f.r2.dev) and `cultremix-prod-public` (https://pub-4c63aeb732c445d5b2850fa3e9485f53.r2.dev), both with CORS for GET and PUT from the tailnet dev URLs, `http://localhost:3000`, and the production URL (`~/cultremix-ops/r2-cors.json`). Unused until an R2 token exists.
- Production Worker `cultremix-prod` at https://cultremix-prod.jonthewayne.workers.dev (`wrangler.jsonc` `env.production`, `.env.production`); deployed from `~/Projects/CultRemix` together with Convex, in the order under [Production deploys](../deployment-cloudflare.md#production-deploys).

## Domain

- `cultremix.com` is registered through Vercel (Name.com) with DNS on Cloudflare since 4:20 p.m. (zone active; nameservers `brenna.ns.cloudflare.com` and `leonidas.ns.cloudflare.com`).
- `cultremix.com` is the custom domain on `cultremix-prod` (`wrangler.jsonc` `env.production.routes`); `workers.dev` stays on.
- `www.cultremix.com` redirects to the root with a zone Redirect Rule, "Redirect from WWW to root [Template]" (`https://www.*` to `https://${1}`, 301, query string kept). `www` stays a custom domain on `cultremix-prod` only so it keeps a proxied DNS record; the rule answers before the Worker runs. The dashboard's warning that `www` may not be proxied does not apply to custom domains. "Always Use HTTPS" is on for the zone, so `http://` requests reach HTTPS first. Keep `www` in the app's routes: removing it deletes its DNS record and the rule stops matching.
- Production `SITE_URL=https://cultremix.com` (Convex and Worker); `AUTH_TRUSTED_ORIGINS` = `https://cultremix.com`, `https://www.cultremix.com`, `https://cultremix-prod.jonthewayne.workers.dev`. R2 CORS includes both new origins.
- Wrangler's OAuth login cannot read or edit DNS records, so conflicting records must be deleted in the dashboard before attaching a custom domain.
- Share tags (`og:url`, `og:image`) come from `SITE_URL` in `src/lib/site.ts`, now `https://cultremix.com` (deployed 5:44).

## Log

- 1:26 R2 enabled; buckets created; `r2.dev` URLs on; CORS set.
- 2:04 Convex production deployment created and its env set; production vars filled; first `deploy:prod`.
- 3:07 Gateway key saved and verified ($22.16 credit); set on production and dev.
- 3:09 Production redeployed from `dev` at `7b273ee`; `IMAGE_STORE=convex` on production; production self-test generated and stored a transparent design through the gateway; Worker version `9a5df58e`.
- 3:12 Image check and demo seeds done (`docs/setup/image-check.md`, `~/cultremix-seed/`); submission draft in `docs/hackathon/submission.md`.
- 3:50 Production deployed from `dev` at `f2d02db` (Convex, then Worker version `5dfc3fb0`); `AUTH_INSTANT_SIGNIN=true` (the first try got a Convex 503; the retry worked); `bootstrap:ensureDefaults` had nothing to add. Smoke test in fresh browser sessions: a new email reached onboarding in 6.6 s with no code; the owner email got the code box. Test account `ops-smoke-280336@example.com` left on production. Turn off with `bunx convex env set --prod AUTH_INSTANT_SIGNIN false`.
- 4:24 Production Worker deployed from `dev` at `bf3191c` (icon, share image, metadata); version `d973e362`.
- 4:37 Custom domains attached after Jon deleted the Vercel records imported into the zone; 4:40 `SITE_URL` and `AUTH_TRUSTED_ORIGINS` switched to `cultremix.com`; Worker version `ac0e8b3b`. Instant sign-in checked in fresh browser sessions on `cultremix.com` (6.8 s to onboarding) and `workers.dev` (8.5 s). Test accounts `ops-smoke-crworkers-32803@example.com` and `ops-smoke-domain-57972@example.com` left on production.
- 4:46 Resend key saved (Jon pasted it in chat; rotate it). A send from `auth@cultremix.com` to `delivered@resend.dev` was accepted, so the domain is verified. 4:47 Production switched to Resend with `AUTH_EMAIL_FROM="CultRemix <auth@cultremix.com>"`; a sign-in code for Jon's Gmail was requested on `cultremix.com` and the Resend component queued it with no failures.
- 5:01 `AUTH_EMAIL_FROM="CultRemix <heyyo@cultremix.com>"` on production (Resend accepted a test send). 5:02 Email Routing enabled with wrangler; destination Jon's Gmail; rule `heyyo-to-gmail`; a sign-in code for Jon and a forwarding test to `heyyo@` sent.
- 5:06 Instant sign-in turned off; PR #1 merged into `dev` (`00ac78c`); typecheck and 64 tests passed; Convex and Worker (`b1bbb140`) deployed; `AUTH_INSTANT_SIGNIN` removed. Smoke test on `cultremix.com` with an outside mail.tm inbox: the code arrived in 6.9 s; "Send a new code" unlocked at 30 s and the new code arrived in 4.2 s; the older code was refused; the newest signed in to onboarding. Test account `crsmoke6928504@uberip.com` left on production.
- 5:14 `www` now redirects to the root: `cultremix-www-redirect` (version `3cf72cc2`) owns `www.cultremix.com`; the app Worker was redeployed with only `cultremix.com` (version `34c6d44f`).
- 5:16 Jon confirmed the email from `heyyo@cultremix.com` reached his Gmail.
- 5:24 Switched `www` to the Redirect Rule Jon created; he turned on Always Use HTTPS. `www` moved back to the app Worker (version `219c8907`) and the temporary `cultremix-www-redirect` Worker was deleted. Checked: http and https `www` URLs end on `https://cultremix.com` with path and query kept; `http://cultremix.com` goes to HTTPS; no loops.
- 5:44 Production Worker deployed from `dev` at `8bc367d` (home page hero; share tags on `cultremix.com`); version `930af695`. Checked: the hero shows "The social creative-commerce platform", "Remix culture, get paid.", and "Remix anything you see. Wear it, share it, sell it."; `og:url` is `https://cultremix.com` and `og:image` is `https://cultremix.com/og.png?v=3` (serves 200).
