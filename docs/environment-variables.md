# Environment Variables

Run `bun run setup`, apply the printed Convex env commands, then run `bun run doctor`. Run `bun run doctor:external` after Convex env is set.

## Sources

`VITE_*` values are Vite build-time values. They are read by browser/server bundle code and must exist in `.env.development` and `.env.production` before build.

Convex backend env vars are separate. Set them with `bunx convex env set`. Convex production env vars use `bunx convex env set --prod`. Cloudflare Worker runtime vars and secrets are separate again. GitHub Actions variables/secrets are separate again.

The setup wizard writes `.starter/setup-state.json` as a non-secret report of what it configured. Use it to understand setup choices, not as an env source.

## Matrix

| Variable | Where | Committed | Sensitive | Set By | Read By |
| --- | --- | --- | --- | --- | --- |
| `CONVEX_DEPLOYMENT` | `.env.local` | no | no | wizard/Convex CLI | Convex dev CLI |
| `VITE_CONVEX_URL` | `.env.local`, `.env.development`, `.env.production`, Worker vars, GitHub vars | dev/prod yes, local no | no | wizard | router, auth server |
| `VITE_CONVEX_SITE_URL` | `.env.local`, `.env.development`, `.env.production`, Worker vars, GitHub vars | dev/prod yes, local no | no | wizard | auth server |
| `SITE_URL` | `.env.local`, Convex env, Worker vars | local no, wrangler yes | no | wizard | Better Auth base URL, SMS links |
| `CONVEX_SITE_URL` | Convex system env | no | no | Convex | invite magic-link trigger |
| `AUTH_SECRET` | `.env.local`, Convex env | no | yes | wizard | Better Auth |
| `AUTH_TRUSTED_ORIGINS` | `.env.local`, Convex env | local no | no | wizard | Better Auth |
| `AUTH_EMAIL_FROM` | `.env.local`, Convex env | no | no | wizard | email provider |
| `AUTH_EMAIL_PROVIDER` | `.env.local`, Convex env | no | no | wizard | email provider |
| `AUTH_EMAIL_OTP_ENABLED` | `.env.local`, Convex env | no | no | wizard | auth callbacks |
| `AUTH_MAGIC_LINK_ENABLED` | `.env.local`, Convex env | no | no | wizard | magic-link callback |
| `RESEND_API_KEY` | Convex env | no | yes | wizard/manual | Resend |
| `AUTH_PHONE_ENABLED` | `.env.local`, Convex env | no | no | wizard | phone auth callbacks |
| `AUTH_SMS_PROVIDER` | `.env.local`, Convex env | no | no | wizard | SMS provider |
| `PHONE_TEMP_EMAIL_DOMAIN` | `.env.local`, Convex env | no | no | wizard | phone temp email helpers |
| `TELNYX_API_KEY` | Convex env | no | yes | wizard/manual | SMS provider |
| `TELNYX_PHONE_NUMBER` | Convex env | no | no-ish | wizard/manual | SMS provider |
| `FIRST_SUPER_ADMIN_EMAIL` | `.env.local`, Convex env | no | no | wizard | bootstrap mutation |
| `TEST_HELPER_SECRET` | `.env.local`, Convex env, CI secret | no | yes | wizard | tests/test helpers |
| `ENABLE_TEST_OTP_STORAGE` | `.env.local`, Convex env | no | no | wizard | auth test callback |
| `CONVEX_DEPLOY_KEY_DEV` | GitHub secret | no | yes | manual/wizard command | deploy workflow |
| `CONVEX_DEPLOY_KEY_PROD` | GitHub secret | no | yes | manual/wizard command | deploy workflow |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | no | yes | manual/wizard command | deploy/cleanup workflows |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub variable, wrangler | wrangler placeholder yes | no | wizard | workflows/wrangler |
| `CLOUDFLARE_ZONE_ID` | GitHub variable | no | no | wizard | cleanup workflow |
| `CLOUDFLARE_ZONE_NAME` | GitHub variable | no | no | wizard/manual | preview route patch |
| `CLOUDFLARE_PROJECT_NAME` | GitHub variable | no | no | wizard | workflow Worker names |
| `DEV_URL`, `PROD_URL`, `PREVIEW_BASE_DOMAIN` | GitHub variables | no | no | wizard/manual | deploy workflow |
| `DEPLOYMENT_ENV` | Convex env (dev, staging, prod) | no | no | manual | which environment this is: `dev`, `staging`, or `prod`. Staging and dev (and an unset value) show the Testnet badge, so production must say `prod`; prod shows Early access until checkout opens (`api.deployment.get`, the only way the browser learns it); dev allows the stand-in image generator; it also decides dev-only resets, whether test orders create (simulated) earnings, and Printful auto-confirm (production only) |
| `AI_GATEWAY_API_KEY` | Convex env | no | yes | manual | image designs, model photos, image notes |
| `IMAGE_PROVIDER` | Convex env (optional) | no | no | manual | `gateway` or `chatgpt` forces the image provider |
| `IMAGE_QUALITY`, `PHOTO_QUALITY` | Convex env (optional) | no | no | manual | design and model-photo quality (default `medium`) |
| `STYLE_NOTES_MODEL` | Convex env (optional) | no | no | manual | model for image notes (default `openai/gpt-6-luna`) |
| `GRID_QUALITY` | Convex env (optional) | no | no | manual | quality of the studio's grid call (default `high`) |
| `STUDIO_LAYOUT` | Convex env (optional) | no | no | manual | `single` makes four separate designs per batch instead of one grid |
| `IMAGE_STORE` | Convex env (optional) | no | no | manual | `convex` stores images in Convex when R2 keys are missing |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL` | Convex env | no | no | manual | image storage: the environment's public R2 bucket and its address |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Convex env | no | yes | manual | image storage; images go to R2 whenever these are set |
| `FAL_KEY` | Convex env (dev, staging, production; one key per environment, each with a fal spend limit) | no | yes | manual | "Upscale for print" (fal Topaz Transparent, `convex/upscale.ts`); without it an upscale fails and refunds its credits. `scripts/spikes/fal-topaz.ts` reads its own copy from `~/.config/cultremix/fal.env` |
| `SHOPIFY_SHOP_DOMAIN` | Convex env, Worker secret/var | no | no | manual | the store's `*.myshopify.com` domain: Admin API, webhook check, Storefront API |
| `SHOPIFY_CLIENT_ID` | Convex env | no | no | manual | Admin API client-credentials token (product sync, order hydration) |
| `SHOPIFY_CLIENT_SECRET` | Convex env | no | yes | manual | Admin API token, and the key that signs Shopify webhooks |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | Worker secret | no | yes | manual | Storefront API cart and checkout (TanStack Start server functions) |
| `SHOPIFY_API_VERSION` | Convex env, Worker var (optional) | no | no | manual | overrides the API version pinned in `shared/config/shopify.ts` (`2026-07`); leave unset |
| `PRINTFUL_API_TOKEN` | Convex env | no | yes | manual | Printful v2 orders, shipments, and confirmations |
| `PRINTFUL_STORE_ID` | Convex env | no | no | manual | the Printful store orders go to; webhooks from other stores are ignored |
| `PRINTFUL_WEBHOOK_SECRET` | Convex env | no | yes | manual | verifies `x-pf-webhook-signature` on `/webhooks/printful` |
| `PRINTFUL_AUTO_CONFIRM` | Convex env (prod only) | no | no | manual | `true` lets production confirm Printful drafts after the 1-hour hold |

Image settings are explained in `docs/image-generation/README.md`.

## Shop (Shopify and Printful)

Each environment has its own Shopify store and Printful store. Set the same names in dev, staging, and production, with that environment's values.

- Products, orders, and earnings run in Convex: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`. Without them product sync and order hydration wait, and `/webhooks/shopify` answers 503.
- The cart runs in the Worker: `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`. Buying is also behind the `commerce.checkout` feature flag; with it off the work page is unchanged.
- Fulfillment runs in Convex: `PRINTFUL_API_TOKEN`, `PRINTFUL_STORE_ID`, `PRINTFUL_WEBHOOK_SECRET`. Without the first two, paid orders wait and the 30-minute sweep picks them up once they are set. Without the secret, `/webhooks/printful` answers 503.
- Print files go to Printful by their public address, so `R2_PUBLIC_URL` must be set wherever orders are fulfilled.
- Drafts are confirmed only when `DEPLOYMENT_ENV=prod` and `PRINTFUL_AUTO_CONFIRM=true`, and the `fulfillment.autoConfirm` flag isn't turned off (turning it off pauses confirmation). Never set `PRINTFUL_AUTO_CONFIRM` in dev or staging; it has no effect there.
- Test orders (Shopify `test`) make labeled test earnings and Printful drafts in dev and staging, and nothing at all in production. An unset or unrecognized `DEPLOYMENT_ENV` is treated like production for test orders and never confirms.

## Common Fixes

If Vite builds against the wrong Convex deployment, check `.env.development`, `.env.production`, and GitHub variables. If Better Auth redirects to the wrong origin, check Convex `SITE_URL`, `AUTH_TRUSTED_ORIGINS`, and Worker `SITE_URL`.

The setup wizard asks for one root domain and derives URL defaults from it:

- `https://dev.<domain>` for the canonical/shared dev app URL
- `https://<domain>` for production
- `preview.<domain>` for branch preview hostnames

For shared dev deployments, `SITE_URL` should be the canonical dev app URL, such as `https://dev.example.com`, rather than localhost. Put dev, preview, and local origins in `AUTH_TRUSTED_ORIGINS`, for example `https://*.dev.example.com,https://*.preview.example.com,http://localhost:3000,http://localhost:5173`. This makes login links stable while allowing branch previews and local development to initiate auth flows.

For local sign-in without real email delivery, choose `AUTH_EMAIL_PROVIDER=console` and leave `RESEND_API_KEY` unset. The console provider logs the email payload instead of calling Resend. Choose `AUTH_EMAIL_PROVIDER=resend` only when `AUTH_EMAIL_FROM` uses a verified Resend sender/domain and `RESEND_API_KEY` is set in Convex.

Keep `ENABLE_TEST_OTP_STORAGE=true` in local/dev test environments so tests can retrieve OTPs. Do not set `TEST_HELPER_SECRET` or `ENABLE_TEST_OTP_STORAGE` in Convex production env; `bun run doctor:deployment` checks for that.

Rerunning setup preserves `AUTH_SECRET` and `TEST_HELPER_SECRET`. Use `bun run setup --rotate-secrets` only for intentional rotation, then reapply the printed Convex env commands.

Use the right doctor mode:

```bash
bun run doctor              # local setup
bun run doctor:external     # local + Convex/Cloudflare CLI checks
bun run doctor:deployment   # strict production/deployment setup
```
