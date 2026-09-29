# Architecture

## Runtime

The frontend is a TanStack Start app built by Vite and deployed to Cloudflare Workers. TanStack Start server-renders the first request. After hydration, TanStack Router performs internal navigation without full page reloads.

## Data And Auth

Convex is the app database and function runtime. Better Auth stores its auth tables in the Convex Better Auth component. App authorization remains in first-party Convex tables:

- `users` maps Better Auth users to app profiles and platform roles.
- `memberships` stores scoped roles for organizations and resources.
- `invites` stores pending grants.
- `authVerificationAttempts` and `phoneVerificationAttempts` track pre-session auth flows.
- `authRateLimits` centralizes rate limits.

Authenticated app code uses `ConvexQueryClient` with `expectAuth: true` in `src/router.tsx`. Login and verification screens use `src/lib/convex-preauth.ts`, a standalone Convex client that can call pre-auth mutations before a Better Auth session exists.

## SSR Auth Handoff

`src/routes/__root.tsx` calls `getToken()` on the server, sets `convexQueryClient.serverHttpClient` auth before loaders run, and passes the token into `ConvexBetterAuthProvider`. This is the critical handoff that keeps SSR Convex queries authenticated and avoids a second unauthenticated client fetch on hydration.

## Auth Proxy

`src/routes/api/auth/$.tsx` proxies same-origin `/api/auth/*` requests to the Convex Better Auth React Start handler. The browser talks to the app origin, while Better Auth uses the Convex site URL behind the scenes.

## External Providers

Email and SMS are provider seams:

- Local/test: console providers and stored OTPs when `ENABLE_TEST_OTP_STORAGE=true`.
- Production email: Resend.
- Production SMS: Telnyx.

The default tests do not require Resend, Telnyx, Cloudflare, or production credentials.
