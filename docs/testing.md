# Testing

## Default Local Suite

```bash
bun run test
```

The default suite needs no deployment and no outside credentials: no Resend, Telnyx, Cloudflare, Shopify, Printful, Circle, Monad, or production keys.

`bun run test` runs two suites: the unit tests in `tests/unit` (Node), then the in-memory Convex tests in `tests/convex-local` (`convex-test` in the edge runtime; `bun run test:convex:local` runs only these). The in-memory tests call real queries, mutations, and internal functions against the real schema with no deployment, so domain rules (credits, CR numbers, lineage, follows, orders) are tested there. Start a test with `newTest()` from `tests/convex-local/setup.ts` and use `t.withIdentity({ subject, issuer })` for signed-in calls. Node actions (`"use node"` files) don't run in this harness; keep their logic in pure helpers and test those in `tests/unit`.

Covered helpers:

- role and capability catalogs
- redirect sanitization
- phone normalization and temp email detection
- rate-limit config
- setup/env parsing
- generated-project file exclusions, including runtime environment files
- generated-project copy and default setup report acceptance
- email-only setup defaults and optional Telnyx SDK compatibility
- the Convex React Query SSR auth handoff used by the router
- the Better Auth client methods consumed by the Convex provider

The GitHub deploy workflow runs the unit suite and typecheck before deployment. Convex integration tests remain opt-in because they need a dedicated deployment admin key and test secret.

Check the resolved Bun dependency graph for security advisories with:

```bash
bun audit
```

## Contract And Local Chain

The registry contract has its own Foundry suite (Foundry 1.8.4; see `contracts/README.md`):

```bash
cd contracts && forge test
```

`bun run test:chain:anvil` starts a private anvil node posing as Monad testnet (chain 10143), deploys the real registry bytecode, and runs the Convex chain writer against it end to end: registrations, remixes waiting for their parent, Backs with their onchain order, lineage amendments, and the economics config. It needs Foundry's `anvil` (`~/.foundry/bin/anvil` or `ANVIL_BIN`), so it stays out of `bun run test`, and it never reaches a public network.

## Image Pipeline

`bun run test:image` reruns every capability the image pipeline aims to support against the real models: GPT Image 2.5 with our prompts (words, styles and style mixes, people, remixes, the grid, the model photo) and the GPT-6 Luna steps around it (image notes, the request reader, and the remix comparison that decides when a remix may be a fork). Every prompt is built by production's own code, vision models check each design and read its words, and each run writes a report and a review board per case to `.tmp/image-e2e/runs/`. A full run takes about 9 minutes and costs about $2.85 of gateway credit, so it stays out of `bun run test`; `--recheck <run>` checks an earlier run's images again for about 25¢. Run it before changing a prompt or an image model, and add a case whenever something new is tested by hand. The cases are listed in `tests/image-e2e/CASES.md`; how to run, read, and extend the suite, and how to try a new model against the GPT Image 2.5 baseline, is in `tests/image-e2e/README.md`. `tests/unit/imageSuite.test.ts` keeps the catalog sound without calling any model.


## Convex Integration

```bash
bun run test:convex
```

These tests are skipped unless the following exist:

- `VITE_CONVEX_URL`
- `CONVEX_DEPLOY_KEY` for a dedicated test deployment
- `TEST_HELPER_SECRET`

The generated project can use an account-free local deployment for Convex code generation, backend typechecking, and integration tests when its local admin key is supplied. The integration suite uses `ConvexTestingHelper`, which requires a dedicated test deployment admin key. Neither the suite nor the local-only path needs Telnyx when phone auth uses the console provider.

The phone-attempt integration case follows `AUTH_PHONE_ENABLED`. Leave it `false` for the email-only default; set it to `true` with `AUTH_SMS_PROVIDER=console` to verify the optional phone attempt path without sending SMS or adding Telnyx credentials.

Set `TEST_HELPER_SECRET` both locally and on the Convex backend:

```bash
SECRET=$(openssl rand -base64 32)
bunx convex env set TEST_HELPER_SECRET "$SECRET"
```

The test helpers live in `convex/testHelpers.ts` and are protected by that secret.

## Browser Smoke

Start the app, then run:

```bash
BASE_URL=http://localhost:3000 bun run test:e2e
```

The smoke opens the public sign-in pages (login, email verification, phone verification, invite, and unauthorized), checks each page's heading text, and saves screenshots to `.tmp/screenshots/`. CultRemix's sign-in pages have one black-and-white look, so the smoke no longer looks for the starter's theme toggle.

It then checks the signed-out public pages: the home feed with its Latest and Trending tabs, the first work the feed links to (its CR number and SHA-256 fingerprint), that work's family tree, its creator's profile, `/economics/v1.json`, `/onchain`, the four `/policies` pages, `/sitemap.xml` (it must list works), and `/robots.txt`, failing on any broken image. Because it finds the work from the feed, the same command works as a read-only check of production after a deploy: `BASE_URL=https://cultremix.com bun run test:e2e`.

Against a local dev server, the smoke then runs the signed-in test (`bun run test:e2e:signed-in`, `tests/e2e/run-signed-in.sh`) when `.env.local` has `TEST_HELPER_SECRET` and the dev deployment has `TEST_HELPER_SECRET` and `ENABLE_TEST_OTP_STORAGE=true`. A new member `e2e+<number>@example.com` signs up with an email code read through the test helpers (`scripts/e2e-helper.ts`; nothing is emailed), picks a username, and opens the studio, a work page (its heart button, then **Remix this**, which must start a remix session), their profile with the Kept shelf, notifications, and settings. Then, made an owner, it opens Admin's Overview, Products, For sale, Orders, Payouts, Members, and Metrics. The member, its sessions, and its credits are removed at the end, pass or fail; Better Auth's own account record for the address stays. Failures save `.tmp/screenshots/signed-in-failure.png` and print the page's text. It takes two to three minutes, mostly while a fresh browser waits for dev-mode pages to become interactive.

## Fresh Project Acceptance Test

Use this checklist when validating the starter as a brand-new app.

### 1. Create A Clean Copy

Move or copy the starter so it is the root of a new repo. The `.github/workflows/` directory must be at the repo root for GitHub Actions to run.

```bash
bun run new-project ../my-starter-test
cd my-starter-test
git init
```

### 2. Local Setup

```bash
bun install
bun run setup --local-only
bun run doctor
bun run typecheck
bun run test
bun run build
```

Then start the app:

```bash
bun run dev
```

In another terminal:

```bash
bun run test:e2e
```

Expected result: local doctor, typecheck, unit tests, build, and E2E smoke pass. Convex typecheck skips while `CONVEX_DEPLOYMENT` is unset or still a setup placeholder.

Setup should also create `.starter/setup-state.json`. Confirm it records non-secret project choices and says whether `AUTH_SECRET` and `TEST_HELPER_SECRET` were generated, reused, or rotated.

### 3. Convex Integration Setup

Set `TEST_HELPER_SECRET` locally and in Convex:

```bash
SECRET=$(openssl rand -base64 32)
echo "TEST_HELPER_SECRET=$SECRET" >> .env.local
bunx convex env set TEST_HELPER_SECRET "$SECRET"
```

Set the other Convex auth env vars printed by `bun run setup`, then run:

```bash
bun run doctor:external
bun run test:convex
```

Expected result: Convex env checks pass and integration tests run instead of skipping.

### 4. Deployment Setup

Always use separate test resources, even if you use the same accounts as another project:

- a separate Convex project or deployment
- a separate Cloudflare Worker name
- a separate test hostname, such as `starter-test.example.com`
- a separate GitHub test repo or branch
- a safe Resend sender on a verified domain

Run:

```bash
bun run setup
bun run doctor:deployment
```

The wizard prints the needed `convex env set`, `gh variable set`, and `gh secret set` commands. GitHub Actions needs:

- `CLOUDFLARE_API_TOKEN`
- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`

Convex deploy keys are created in the Convex dashboard and read by the Convex CLI through the `CONVEX_DEPLOY_KEY` environment variable in CI.

Production Convex env should not include `TEST_HELPER_SECRET` or `ENABLE_TEST_OTP_STORAGE`; `bun run doctor:deployment` fails if those are present.

### 5. GitHub Actions Verification

Push to `dev` first:

```bash
git add .
git commit -m "Test starter setup"
git branch -M dev
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin dev
```

Expected result:

- GitHub Actions installs with Bun.
- Unit tests pass.
- The app builds.
- Convex deploy runs with the dev deploy key.
- Cloudflare Worker deploys to the development URL.

Then test `main` only after `dev` is green.

### 6. Production Smoke

After deployment:

```bash
BASE_URL=https://your-test-domain.example.com bun run test:e2e
```

Expected result: public auth pages render, theme toggle works, and screenshots are captured. Full login tests require valid email/SMS provider configuration or test OTP storage.
