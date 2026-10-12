# Starter Improvements

Living log of starter-template improvements discovered while creating real apps from
this starter. Update this file whenever setup, docs, auth, deployment, testing, or
agent workflow changes make the starter easier to use.

## How To Use This Log

- Add one dated entry per improvement pass.
- Include what changed and why it helps future projects.
- Keep unresolved ideas in "Still Worth Improving" until they are implemented.

## Log

### 2026-09-29

- Keep Bun as the sole lockfile/package-install workflow and add dependency checks before deployment.
- Pin Better Auth to the latest 1.6 release accepted by `@convex-dev/better-auth` 0.12.5; keep the adapter pair within its declared peer range.
- Override patched transitive dependency releases in Bun and verify `bun audit` reports no advisories; retain Vite 7 and TypeScript 5.9 for stack compatibility.
- Exclude runtime `.env*` files and Cloudflare local vars from generated projects while retaining committed `.example` templates.
- Keep a Convex TypeScript project config so local deployments can regenerate bindings and run the full backend typecheck.
- Let the setup wizard provision account-free local Convex without reusing a stale placeholder deployment.
- Start the browser smoke on an app origin before writing theme values to `localStorage`.
- Carry reusable phone, rate-limit, and role edge cases into the primary test suite; keep merge and webhook behavior outside the default starter.
- Keep email delivery on the console provider by default. Phone authentication stays disabled by default, and Telnyx credentials are only needed when phone auth and the Telnyx SMS provider are both selected.
- Add local contract tests for the Convex React Query SSR auth handoff and Telnyx SDK surface without requiring a live backend or SMS credentials.
- Add a generated-project acceptance test for copy exclusions, non-interactive setup, and the non-secret setup report.
- Give that acceptance test two minutes: it copies the project and runs setup in child processes, about 20 s on an idle machine, and it timed out at 30 s on a shared dev machine whose disk was busy with other projects' builds and Spotlight.
- Start the web server through Convex's `--start` option so account-free local development completes its initial push and watcher setup in one process.
- Reject invite replays from any account other than the original recipient, including another account with the same email.
- Prevent scoped admins from granting owner roles through invites, matching direct membership edits.
- Apply backend env values during account-free local setup and pass all applied values as CLI arguments, keeping shell syntax in entered values inert.
- Hide phone sign-in while the backend phone flag is disabled, and show a retry path when invite acceptance fails.
- Check both the requested and current platform roles when editing users, so operations admins cannot demote owners.
- Recheck inviter authority and the recipient's current role when an invite is accepted, closing owner-downgrade paths after creation.
- Admin-made password accounts without public password sign-up: enable `emailAndPassword` with `disableSignUp`, add the sign-up and reset paths to `disabledPaths`, and create users through Better Auth's `internalAdapter` (`createUser`, `linkAccount`, `password.hash`) from an action. Email code sign-in is untouched (CultRemix `convex/judges.ts`, `convex/lib/passwordAuth.ts`).
- Launch scripts that call `bunx convex run` should target dev by default, staging through a per-command `CONVEX_DEPLOY_KEY`, and production only with `--prod` plus a typed confirmation; parse the JSON result after any `[CONVEX …]` log lines (`scripts/lib/convex-run.ts`).
- Expose the environment to the browser through a public Convex query instead of a build-time `VITE_` value, so one Worker build can't show the wrong environment's label.

### 2026-10-11

- With `expectAuth: false` (public pages that load signed out), a signed-in page's first live Convex results come from an anonymous socket and overwrite the server-rendered cache, so React logs "Hydration failed" and rebuilds the page in the browser. Mark server pages rendered with a session (a `<meta>` in the root document) and create the `ConvexQueryClient` with `expectAuth` only when that mark is present; add a fallback that sets an empty auth source after about 10 s so a failed token fetch can't leave the socket paused (CultRemix `src/lib/sessionMeta.ts`, `src/router.tsx`). Have the signed-in browser test fail on any `Hydration failed` error.
- In `convex-test`, a file's first HTTP route or scheduled-function call loads every Convex module and can pass vitest's 5 s default on a busy machine; set `testTimeout` once in the in-memory test config instead of per file.
- `new-project` didn't bring the starter's `.github/workflows/` into CultRemix, yet its deployment, testing, and env docs kept describing that workflow as if it ran. When a generated app has no workflow, its docs should say so and name who deploys by hand.
- When an app's server-rendered pages read Convex queries whose results change shape, the Worker and the Convex functions only work in matching pairs: CultRemix's old Worker crashed against the new functions and the reverse. Document a back-to-back order (back up with `convex export --include-file-storage`, build the Worker, then `convex deploy && wrangler deploy`) instead of separate steps with seeds in between, and check both mismatches in workerd before a big deploy.
- A big deploy can be rehearsed on real data without touching production: export it (`convex export --prod --include-file-storage`), import it into an anonymous local backend (`CONVEX_AGENT_MODE=anonymous convex dev < /dev/null`) at the old commit, then switch to the new commit and run every migration, with a local S3 server in place of R2. CultRemix's rehearsal found misread words that only production's older designs showed. The starter could ship this as a script.
- Better Auth's Convex component stores its JWT signing key encrypted with `AUTH_SECRET`, so a deployment restored or copied under a different secret fails every token request with "Failed to decrypt private key" until the `jwks` table is emptied. Rotating `AUTH_SECRET` has the same effect; the starter's rotation docs should say so.

### 2026-10-12

- `phoneVerification.lookupAttemptByOtp` was a public query: given a code, it returned a pending phone attempt's number and redirect, though only server code needs it. Make it an `internalQuery` so nobody can guess codes for numbers once phone sign-in is on.
- `authVerification.createEmailAuthAttempt` still accepted a `mergeTargetUserId` from the browser and stored it, though nothing read it after the merge flow left the starter. Drop the argument so later code can't trust a member ID the browser chose.
- typescript-eslint's `no-unnecessary-type-assertion` flags `as Hex` on template strings and `as never` on viem's generic calls, and its automatic fix breaks typecheck there (a template string widens to `string`). Run typecheck after `eslint --fix`, and keep those assertions.

## Still Worth Improving

- Consider a `--show-secrets=false` setup mode for teams that prefer external commands to be written to a secure local file instead of printed in the terminal.
- Add provider-specific doctors for Resend domain verification, Cloudflare DNS routes, and GitHub repository variable values.
