# Background Workflows

Use this recipe for jobs such as imports, AI generations, digest emails, syncs, or cleanup tasks.

## Recommended Pattern

- Represent each job as a Convex table row with status, inputs, timestamps, and error fields.
- Use mutations for enqueue/cancel/retry decisions.
- Use actions for external API calls.
- Use scheduled functions or a workflow component when work spans multiple steps.
- Keep user-facing status queries reactive so the UI updates without polling glue.

## Status Fields

Common statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

Track `createdBy`, `startedAt`, `finishedAt`, `attempts`, and a sanitized `lastError` string. Avoid storing provider secrets or raw third-party payloads unless the product truly needs them.
