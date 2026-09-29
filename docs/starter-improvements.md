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
- Start the web server through Convex's `--start` option so account-free local development completes its initial push and watcher setup in one process.
- Reject invite replays from any account other than the original recipient, including another account with the same email.
- Prevent scoped admins from granting owner roles through invites, matching direct membership edits.
- Apply backend env values during account-free local setup and pass all applied values as CLI arguments, keeping shell syntax in entered values inert.
- Hide phone sign-in while the backend phone flag is disabled, and show a retry path when invite acceptance fails.
- Check both the requested and current platform roles when editing users, so operations admins cannot demote owners.
- Recheck inviter authority and the recipient's current role when an invite is accepted, closing owner-downgrade paths after creation.

## Still Worth Improving

- Consider a `--show-secrets=false` setup mode for teams that prefer external commands to be written to a secure local file instead of printed in the terminal.
- Add provider-specific doctors for Resend domain verification, Cloudflare DNS routes, and GitHub repository variable values.
