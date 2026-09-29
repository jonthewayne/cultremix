# Payments

Use this recipe when adding Stripe, Polar, Lemon Squeezy, or another billing provider.

## Recommended Pattern

- Keep app roles and permissions in Convex, not in billing metadata or JWT claims.
- Store subscription/customer IDs in Convex tables.
- Verify webhook signatures in the runtime that receives webhooks.
- Make webhook handlers idempotent by storing provider event IDs.
- Derive feature access from Convex records so support/admin tools can explain why a user has access.

## Setup Checklist

1. Add provider env vars to setup, doctor, and environment docs.
2. Add webhook route and signature verification.
3. Add Convex mutations for idempotent event application.
4. Add a billing status query consumed by settings/admin UI.
5. Add tests for duplicate webhook events and permission changes.
