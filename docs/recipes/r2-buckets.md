# Cloudflare R2 Buckets

Use this recipe when the app needs object storage for images, exports, uploads, or generated files.

## Recommended Pattern

- Store durable product metadata in Convex.
- Store large binary objects in R2.
- Keep upload authorization in Convex mutations or actions.
- Use short-lived signed upload/download URLs when the browser needs direct R2 access.

## Setup Checklist

1. Create separate R2 buckets for development and production.
2. Add R2 bindings to `wrangler.jsonc` under the appropriate environments.
3. Add non-secret bucket names to setup/docs.
4. Add Worker runtime code only for the narrow upload/download path that needs the R2 binding.
5. Add Convex records for object owner, content type, size, status, and storage key.

## Env Notes

R2 bucket bindings are Worker bindings, not Convex env vars. Provider credentials should not be committed. If Convex needs to initiate storage work directly, prefer a small Worker endpoint or a signed URL flow rather than copying broad Cloudflare credentials into Convex.
