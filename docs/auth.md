# Auth

## Files

- `convex/auth.ts`: Better Auth setup, Convex adapter, plugins, triggers, feature flags.
- `convex/authVerification.ts`: email OTP and magic-link attempt tracking.
- `convex/phoneVerification.ts`: phone attempt tracking, unique tap codes, cross-device handoff.
- `convex/email.ts`: Resend and console email provider seam.
- `convex/sms.ts`: Telnyx and console SMS provider seam.
- `src/lib/auth-client.ts`: Better Auth browser client.
- `src/lib/auth-server.ts`: TanStack Start server helper.
- `src/lib/convex-preauth.ts`: standalone pre-auth Convex client.

## Sessions

A sign-in lasts 400 days, the longest Chrome keeps a cookie. A visit more than a day after the last renewal pushes the expiry out another 400 days, in the database and in the browser, so people who come back stay signed in. The page's sign-in check (`getTokenAndRenewSession` in `src/lib/auth-server.ts`, called from the root route) passes Better Auth's renewed cookie back to the browser; the library's `getToken` drops it, which left the browser's cookie running out 400 days after sign-in. The session cookie is `__Secure-better-auth.session_token` on HTTPS (HttpOnly, SameSite=Lax). Convex calls use a separate access token that lasts an hour and renews itself from the session (`convex({ jwt: { expirationSeconds } })` in `convex/auth.ts`).

Cookies belong to one address and one browser. Signing in on `cultremix-prod.jonthewayne.workers.dev` doesn't sign you in on `cultremix.com`, and a sign-in in Chrome doesn't carry over to Safari or to the in-app browser another app opens links in.

## Email OTP

The login page first creates an `authVerificationAttempts` row through the pre-auth Convex client. Then it asks Better Auth to create a magic link and an email OTP. The email delivery callback reads the stored magic link URL and sends one combined email.

Creating an attempt and sending an email use separate rate-limit buckets:

- `auth:create_email_attempt`
- `auth:send_email_otp`
- `auth:send_magic_link`

This avoids double-counting a single login attempt.

## Local Console Email

You can sign in locally without Resend. During `bun run setup`, choose email delivery mode `console`. The wizard applies these values to an account-free local deployment and prints the matching Convex env commands:

```bash
bunx convex env set AUTH_EMAIL_PROVIDER console
bunx convex env set ENABLE_TEST_OTP_STORAGE true
```

With `AUTH_EMAIL_PROVIDER=console`, `convex/email.ts` writes the auth email payload to the Convex/dev logs instead of calling Resend. The payload includes the one-time code and, when enabled, the magic link. With `ENABLE_TEST_OTP_STORAGE=true`, the latest OTP is also stored on the auth attempt so tests can retrieve it through `convex/testHelpers.ts`.

`TEST_HELPER_SECRET` only enables test helpers; it does not override the selected email or SMS provider. Choose the console provider when a test must not make an outbound delivery.

Use this for local development and test deployments only. For production or any environment where real users should receive email, choose `resend` during setup or set the Resend env vars manually.

## Resend Setup

Set these Convex backend env vars for production:

```bash
bunx convex env set AUTH_EMAIL_PROVIDER resend
bunx convex env set AUTH_EMAIL_FROM "Your App <auth@your-domain.com>"
bunx convex env set RESEND_API_KEY re_...
```

Use a verified Resend sender/domain. For local development, use:

```bash
bunx convex env set AUTH_EMAIL_PROVIDER console
```

## Magic Links

Set `AUTH_MAGIC_LINK_ENABLED=true` to include magic links in consumer auth emails. Invite and merge flows can still store magic links even when consumer magic links are disabled, because those flows need links to complete.

Magic links use sanitized relative callbacks. Expired or reused links route through `/auth/complete` and show a recovery path.

## Phone Auth

Phone auth is optional. Enable it with:

```bash
bunx convex env set AUTH_PHONE_ENABLED true
```

Local/test SMS uses the console provider. Production SMS uses Telnyx:

```bash
bunx convex env set AUTH_SMS_PROVIDER telnyx
bunx convex env set TELNYX_API_KEY KEY...
bunx convex env set TELNYX_PHONE_NUMBER +15555551234
```

Phone numbers are normalized to E.164 in `convex/lib/phone.ts`. Better Auth creates phone-first users with synthetic temp emails under `PHONE_TEMP_EMAIL_DOMAIN`. The same helper detects those temp emails everywhere so the domain is not hardcoded in UI.

The tap-code route `/$code` signs the tapped device in and stores a magic link on the phone attempt so another device watching `/verify-phone` can finish automatically.

The starter sends SMS outbound and does not expose a custom inbound Telnyx webhook. If an app adds STOP/START or delivery callbacks, verify the provider signature and timestamp before changing account or phone state.

## Phone-First Accounts And Email Merge

Phone-first signups use synthetic temp emails under `PHONE_TEMP_EMAIL_DOMAIN`. The starter centralizes detection in `convex/lib/phone.ts` so UI and backend code do not drift.

The starter does not automatically merge two existing production accounts without an explicit product decision, because that can move sessions, memberships, billing ownership, and audit history. The safe extension point is:

1. Detect `isPhoneTempEmail(user.email)` for a signed-in phone user.
2. Ask for a real email.
3. Send an email OTP or magic link to re-authenticate that email.
4. In a Convex mutation, transfer scoped memberships only after both identities are verified.
5. Mark the source account merged and force sign-out/sign-in.

This keeps account linking explicit while leaving the base starter conservative.
