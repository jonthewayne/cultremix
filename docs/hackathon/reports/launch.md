# Launch builder report

Branch `codex/launch` (worktree `CultRemix-wt/launch`), five commits on top of `042efbd`. Not pushed.

## Stopping condition

- All six parts are built: judge access, admin, metrics, labels, docs, and the seed script.
- Email code sign-in is unchanged. The email and code steps in `src/routes/login.tsx` are untouched. The only change to the existing tabs is that switching between them clears the error. A test signs in a brand-new member with an email code while password auth is on.
- `bun run typecheck`, `bun run test`, and `bun run build` all pass on the final commit.
  - Unit tests: 26 files, 145 tests.
  - Convex tests on the in-memory backend: 2 files, 13 tests.
  - The Convex typecheck is skipped here because `CONVEX_DEPLOYMENT` is unset.

## What was built, by plan item

### 1. Judge access (KTD-15)

- **`convex/lib/passwordAuth.ts`**
  - Turns on `emailAndPassword` with `disableSignUp: true` and a 12-character minimum.
  - Lists `PASSWORD_DISABLED_PATHS`: password sign-up and every reset or change-password path, so each returns 404.
  - Provides `generateJudgePassword()`, which makes passwords like `xxxxx-xxxxx-xxxxx-xxxxx` from crypto-random bytes.
- **`convex/auth.ts`**: wires those options into Better Auth. This is a 7-line change.
- **`convex/judges.ts`**
  - `provision` is a public action for the owner only. The access check runs before any account is made.
  - `provisionFromCli` is an internal action for the script.
  - Accounts are created through Better Auth's `internalAdapter` (`createUser` with a verified email, `linkAccount` with the hashed password, `updatePassword` for resets).
  - `grantJudgeAccess` gives a username, creator access with the note `judge`, a creator number, and a one-time grant of 40 credits. It is idempotent.
  - It refuses an email that already belongs to a member who signs in with email codes.
- **`convex/lib/creators.ts`**: holds creator access (the `creatorAccess` table) and assigns creator numbers from 2 up. The owner is always a creator.
- **`scripts/provision-judges.ts`** and **`scripts/lib/judge-list.ts`**
  - Take `email username` pairs as arguments or from `--file`.
  - Options: `--reset`, `--dry-run`, and `--prod` (which asks for a typed confirmation).
  - Passwords go to `.judges.local.json` (mode 600, gitignored) and are never printed.
- **`src/routes/login.tsx`**
  - A quiet link, “Have a password? Sign in with it”, opens a password form styled like the email form; “Use an email code instead” goes back.
  - The email code flow is unchanged.
- **`src/routes/admin.judges.tsx`**
  - An owner-only form: email, username, and a “Give an existing judge a new password” option.
  - The password shows once, in the “Just made” list.

### 2. Admin

- **`convex/lib/adminAccess.ts`**
  - `requireAdmin(ctx, "view" | "manage" | "owner")`, using `users.platformRole`.
  - Support staff can view. Ops admins and the owner can manage. Only the owner can make judges.
- **`convex/admin.ts`**
  - `overview` returns the flags with descriptions, the settings, `canManage`, and `isOwner`.
  - `setFlag` and `updateSettings` validate their input: signup credits 0–1,000, daily cap $0–$10,000, photo shoots 0–100 a day.
  - `searchMembers` searches by username, email, or creator number, through indexes only, and returns at most 20 rows.
  - `grantCredits` and `setCreator` are the other two mutations.
- **`convex/lib/flags.ts`**: names and plain descriptions for `gen.vercel` (shown as “Studio”), `publishing`, `commerce.checkout`, `chain.writes`, `social.backs`, and `gen.upscale`.
- **UI**
  - `src/routes/admin.tsx` is now a layout with Overview, Members, Metrics, and Judges tabs and an `<Outlet/>`.
  - `admin.index.tsx` has the switches and the settings.
  - `admin.members.tsx` has search, credit grants, creator on or off, and the support role. The role controls use the existing `api.auth.updatePlatformRole` and capability checks.
  - `src/components/admin/AdminSection.tsx` holds the shared cards, inputs, buttons, and toggle.
  - `app-shell.tsx` now highlights the Admin nav item on its sub-pages too.

### 3. Metrics (U14)

- **`convex/schema/launch.ts`**
  - `metricsDays`: one row per UTC day with the nine counts, `runId`, and `complete`.
  - `metricsGenerators`: each member's first generation day, so the total counts each member once.
  - `creatorAccess`.
- **`convex/metrics.ts`**
  - Each day is counted in pages of 200 rows (`PAGE_SIZE`) from each table's `by_creation_time` index, one scheduled step per page, so no single function reads an unbounded set.
  - A newer count supersedes an older one through `runId`, so overlapping recounts never double.
  - `summary` reads only `metricsDays`: up to 90 days for the table and up to 1,000 stored days for the totals.
  - `recount` lets admins recount 1–90 days.
- **`convex/lib/metricsDays.ts`**: UTC day helpers.
- **`convex/crons.ts`** (new file): recounts yesterday and today every hour, at minute 7.
- **`src/routes/admin.metrics.tsx`**
  - All-time total cards and a by-day table (sticky day column, scrolls sideways on phones).
  - Ranges of 7, 14, 30, or 90 days, and a “Recount these N days” button.
- **Templates**: `docs/launch/metrics.md` and `docs/launch/cohort.md`.

### 4. Labels (A10)

- **`convex/deployment.ts`**: the public query `deployment.get` is safe signed out. It returns only the environment name and the label:
  - testnet for staging and dev;
  - early access for prod while `commerce.checkout` is off;
  - nothing for prod once checkout is on.
- **`src/components/cr/DeploymentLabel.tsx`**: `DeploymentPill` goes in the header (`SiteHeader.tsx`), and `TestnetTag` goes after every CR number (`CrMark.tsx`), but only on testnet.

### 5. Docs

- **`README.md`** was rewritten. It covers:
  - what CultRemix is;
  - how the pieces fit (always “CultRemix Gateway”);
  - running it, everyday commands, and the launch scripts;
  - admin;
  - a plain-words “What the registry proves” section taken from ADR 0001, which says the registry isn't in this repo yet.
- **`docs/judges.md`**: what judges get, how they sign in, making accounts from the admin page or the CLI, resets, and cleanup after judging.
- **`docs/launch-checklist.md`**: staging and production sections covering keys, Convex env, deploy and seed, judges, the smoke test on phone and desktop, and after launch.
- **`docs/hackathon/submission.md`** was rewritten. It has:
  - link placeholders for Jon;
  - the Monad track and why it fits;
  - “What works today” from the log, plus the launch pieces;
  - what the registry proves;
  - the new 90-second demo: images and the style mixer, Generate makes four at once, publish with the CR reveal, remix into the family, the Economics panel, and provenance on Monad;
  - recording notes;
  - an event requirements checklist from R44.
- **`docs/environment-variables.md`**: adds `DEPLOYMENT_ENV`.
- **`docs/starter-improvements.md`**: three lessons.
- The new docs don't mention Vercel, the motel sign, or the phrase it carried.

### 6. Seed

- **`convex/seed.ts`**: `seed:environment` (internal) adds only what's missing: app settings, a row for every flag at its default, and the CR family and creator number counters.
- **`scripts/seed-environment.ts`**
  - Targets dev by default, staging when `CONVEX_DEPLOY_KEY` is set for the command, and production with `--prod` after a typed confirmation.
  - It never copies data between environments.
- **`scripts/lib/convex-run.ts`**: the shared `bunx convex run` wrapper. It reads the JSON result even after `[CONVEX …]` log lines.
- **`package.json`**: adds the `seed:environment` and `judges:provision` scripts.

## Tests added

All pass.

### `tests/unit/passwordAuth.test.ts` (6 tests)

These run against a real Better Auth instance with an in-memory adapter and no network.

- Public password sign-up is refused at the endpoint.
- A provisioned account signs in with its password, and a wrong password is refused.
- An email-code member has no password to sign in with.
- Every password reset path is closed.
- Email code sign-in still works, including for new members.
- Generated passwords are long and distinct.

### `tests/convex-local/launch.test.ts` (12 tests)

**Admin access**
- Only ops and the owner can change flags, settings, credits, and creator access. Members, support, and signed-out callers are refused.
- Support can view the overview but not manage.
- Members and signed-out callers are kept out of admin reads and the metrics summary.
- Unknown flags and out-of-range values are refused.
- Member search finds people by username, email, and creator number.

**Judges**
- Only the owner may provision, and signed-out callers, members, and ops are refused before any account is made.
- A judge gets a username, creator access, a creator number, and 40 credits exactly once.
- Onboarding then skips the username step.
- A taken username is refused.

**Seed and labels**
- The seed is idempotent and never overwrites.
- `deployment.get` gives the right label for staging, prod, and prod with checkout on.

**Metrics**
- `summary` reads only the daily rows.
- 450 batches over 2 days are counted across paged steps, with the step count asserted, and the totals are correct.
- A recount gives the same totals, and overlapping counts don't double.
- Recounts by non-admins, and of more than 90 days, are refused.

### `tests/unit/launchScripts.test.ts` (3 tests)

- Judge list parsing.
- Refusing unreadable lines and repeated emails.
- Reading the `convex run` output after log lines.

## Decisions

- **Seeded flags:** Studio and Publishing are on; Checkout, Monad records, Backs, and Print-size art are off. The plan said “only studio on”. Publishing stays on because production already publishes.
- **Labels:** the browser learns the environment from the public `deployment.get` query, not a `VITE_` value. That keeps one Worker build from showing another environment's label. The existing `VITE_DEPLOYMENT_ENV` is left unused.
- **Unset environment:** an unset or unknown `DEPLOYMENT_ENV` counts as dev and shows **Testnet**. A misconfigured production shows Testnet rather than claiming mainnet.
- **Production's Early access label** depends only on the `commerce.checkout` switch.
- **Days are UTC.**
- **“Members who generated”:** each day counts members who pressed Generate for the first time (any outcome), and the total is distinct members.
- **What counts:**
  - “Designs” counts only successful non-shoot generations.
  - “Credits used” is charges minus refunds; admin grants are excluded.
- **Who can do what:**
  - Ops admins can manage flags, settings, credits, and creator access.
  - Support can only view.
  - Making judges is owner-only in the UI, and the CLI path needs deployment admin rights.
- **Judges:**
  - Judges are marked with a `creatorAccess` row whose note is `judge`.
  - Creator numbers start at 2 (the owner is № 1, and the owner is always a creator).
  - Passwords need at least 12 characters.
  - Re-provisioning never changes an existing password unless asked to reset.
- **Admin overview:** the starter's “Team” list on the overview was removed. It showed only the newest 100 users, so older admins could be missed. Roles are now changed from Members search.

## Stubbed, or waiting on keys and accounts

- **Not enforced yet** (they're stored and editable but nothing reads them):
  - the `publishing`, `commerce.checkout` (except for the label), `chain.writes`, `social.backs`, and `gen.upscale` switches; only `gen.vercel` is read today, in `convex/studio.ts`;
  - `dailyBudgetCents` and `shootsPerMemberPerDay`.
- **Creator access** isn't checked anywhere yet. It records who is a creator and gives them a number.
- **Not in this repo:** the Monad registry, the chain writer, and the Economics panel. The README and the demo script say so, and the recording notes give a fallback.
- **No browser check:** none of this has been checked visually in a browser. The dev deployment doesn't have the new functions, and deploying was out of scope. Layouts follow the existing pages and were written for phone widths, but they need a look on a phone after deploy.
- **Staging** doesn't exist yet: no Convex project, Worker, bucket, or keys.
- **Real email:** `AUTH_INSTANT_SIGNIN` and real email (draft PR #1) are separate and unchanged here.

## What the Builder must do when merging

### 1. Resolve conflicts

Likely spots:
- `convex/_generated/api.d.ts`, which was hand-edited: import lines and `fullApi` entries for `admin`, `deployment`, `judges`, `metrics`, `seed`, `crons`, and `lib/adminAccess`, `lib/creators`, `lib/flags`, `lib/metricsDays`, `lib/passwordAuth`, `schema/launch`. Regenerate with `bunx convex codegen` against dev after merging.
- `convex/schema.ts`, which adds `...launchTables` after `...cultremixTables`.
- `convex/crons.ts`, a new file. If another branch adds crons, keep both jobs in one file.
- `src/routes/admin.tsx`, now a layout. Any other admin UI should become a child route (`admin.<name>.tsx`) with a tab in the layout.
- `src/routeTree.gen.ts`: rerun `bun run build` and commit the result.
- `convex/lib/creators.ts` and the `creatorAccess` table, if another branch also models creator access.

### 2. Schema

- Three new tables: `creatorAccess`, `metricsDays`, `metricsGenerators`.
- No changes to existing tables.
- Nothing to backfill, though recounting history is worth doing (step 5).

### 3. Deploy order

Convex first (functions, schema, the hourly cron, and the Better Auth config change), then the Worker. Do it on dev, then staging, then production.

### 4. Env vars

Set `DEPLOYMENT_ENV` on each Convex deployment: `dev`, `staging`, or `prod`. **Production must be `prod`, or it shows Testnet.** Check production's current value before deploying.

### 5. After each deploy

1. `bun run seed:environment` (with `CONVEX_DEPLOY_KEY` for staging, or `-- --prod`).
2. Claim the owner account if the environment is new.
3. Check the switches at `/admin`.
4. Run `bun run judges:provision -- --file judges.txt` for the judges' environment.
5. On `/admin/metrics`, press “Recount these 90 days” once to fill in history.

### 6. Verify

- On a phone, sign in with an email code (unchanged) and with a judge password.
- Confirm a new email can't sign up with a password: `POST /api/auth/sign-up/email` returns 404.
- Check the Testnet badge on staging and Early access on production.

### 7. Follow-ups

- Enforce the switches and settings listed above.
- Gate creator-only features on `isCreator`.
- Add the Economics panel and the registry.
- After judging, turn off judges' creator access.
