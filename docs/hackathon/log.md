# CultRemix build log — 2026-09-29

Builder entries (times Pacific). No secrets here; secret values live only in `~/.config/cultremix/*.env`, `.env.local` (mode 600), and deployment env.

## B1 scaffold

- 13:25 Imported starter `4b5d609` with `bun run new-project ../CultRemix --force` (KTD-P); `bun install`; added `ai`, `@ai-sdk/gateway`, `@convex-dev/r2`, `motion` for B2.
- 13:26 `bunx convex dev --configure existing --team curiousentity --project cultremix --dev-deployment cloud --once` → dev deployment `vibrant-rook-798` (`https://vibrant-rook-798.convex.cloud`).
- The setup wizard was not run because it prints `AUTH_SECRET` and `TEST_HELPER_SECRET`; its steps were done directly. `.tmp/dev-env.ts` (ignored) generates the secrets into `.env.local` and sets the dev deployment without echoing values.
- Dev Convex env: `SITE_URL=https://mighteous.tailb6e2ea.ts.net:3000`; `AUTH_TRUSTED_ORIGINS` = the port-3000 and port-3001 tailnet URLs and `http://localhost:3000`; `APP_NAME=CultRemix`; `AUTH_EMAIL_FROM=CultRemix <auth@cultremix.com>`; `AUTH_EMAIL_PROVIDER=console` (until `resend.env` lands); `AUTH_EMAIL_OTP_ENABLED=true`; `AUTH_MAGIC_LINK_ENABLED=false`; `AUTH_PHONE_ENABLED=false`; `ENABLE_TEST_OTP_STORAGE=true`; `DEPLOYMENT_ENV=dev`; `AUTH_SECRET` and `TEST_HELPER_SECRET` set (values secret). `FIRST_SUPER_ADMIN_EMAIL` waits for O1.
- `wrangler.jsonc`: Workers `cultremix`, `cultremix-dev`, `cultremix-prod`; both named environments `workers_dev: true` with no custom-domain routes. Production vars are `REPLACE_WITH_…` placeholders for the Ops thread (it owns `env.production` and `.env.production` from now on; `.env.production` is no longer gitignored).
- Removed `src/routes/$code.tsx` and both GitHub workflows. Default destination after sign-in is `/studio`; `/` redirects there until the feed lands in B3. `AGENTS.md` Git section replaced with today's rule.
- Starter fix: `@tanstack/react-router-with-query` crashed every server render that created a query (`router.serverSsr.isDehydrated is not a function` against router-core 1.171). Replaced with `@tanstack/react-router-ssr-query@1.167.3`. `expectAuth: false` so public pages can load signed out.
- Vite binds `127.0.0.1:3000` with `strictPort`: `tailscale serve --https=3000 3000` holds port 3000 on the tailnet address, so the starter's `host: true` silently moved Vite to 3001.
- Schema additions (sprint plan names): `users.username`, `usernameLower`, `creatorNumber`, `emailVerified`, `signupGrantAt` with `by_usernameLower` and `by_creatorNumber`; `appSettings` (`main`: signup grant 24, seeded by `bootstrap:ensureDefaults`); `creditLedger`.
- Onboarding: `identity.viewer`, `identity.completeOnboarding` (username 3–20 letters, numbers, or underscores, unique case-insensitively, reserved route names refused; writes the signup grant once, guarded by `signupGrantAt`); `/onboarding`; a root guard sends signed-in members without a username there and back to where they were going. `bootstrapFirstSuperAdmin` also sets `creatorNumber: 1`.
- Dev server: `screen -S cultremix-dev` running `.tmp/run-dev.sh` (`bun run dev`: Convex watcher plus Vite), log in `.tmp/dev.log`, served at https://mighteous.tailb6e2ea.ts.net:3000.
- Checks: `bun run typecheck` passed; `bun run test` 57/57; browser pass on the tailnet URL: `/studio` → `/login` → email code (console provider, read from test OTP storage) → `/onboarding` refused `studio`, accepted `builder_b1` → `/studio` showing "@builder_b1 · 24 credits"; `/settings` renders with the owner bootstrap button.
- 13:41 B1 pushed.
