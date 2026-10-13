# Project Instructions

CultRemix, built from starter `4b5d609`. Today's plan: `docs/plans/2026-09-29-sprint-4pm.md`.

## Git

There is one copy of the code: this folder (`~/Projects/CultRemix`), with no clones or worktrees (Jon, October 12). The CultRemix Builder thread builds, commits to `dev`, pushes, and deploys production, all from this folder, in the order in `docs/deployment-cloudflare.md`. Production's settings (`wrangler.jsonc`'s `env.production` block and `.env.production`, non-secret values) are committed here like everything else. Pull with `--rebase` before pushing. Secrets live only in `~/.config/cultremix/*.env` and deployment env; never commit or print them.

## Plans And Docs

- Save implementation plans in `docs/plans/`.
- Record starter-template changes and lessons in `docs/starter-improvements.md`.
- Keep README and relevant docs updated when setup, env vars, deployment, auth, or testing behavior changes.
- Treat `docs/usage-flow.md`, `docs/setup.md`, `docs/environment-variables.md`, `docs/testing.md`, and `docs/deployment-cloudflare.md` as user-facing setup contracts.

## Convex

For Convex schema, queries, mutations, actions, auth, and tests, follow `docs/convex_rules.mdc`.

Important local pattern:

- The shared `ConvexQueryClient` (`src/router.tsx`) waits for the member's token only on pages the server rendered for a signed-in member (the `cr-session` meta, `src/lib/sessionMeta.ts`); public pages load signed out (KTD-1a).
- Pre-auth screens must use `src/lib/convex-preauth.ts`, not authenticated Convex hooks.
- Keep roles DB-authoritative in Convex tables. Do not put authorization roles in JWT claims.

## Setup And Testing

Agents running `bun run setup` must not let Convex silently choose a team from local CLI state. When the wizard reaches the Convex team choice, ask the human which existing team slug to use. Only use `interactive` when the human explicitly asks to take over Convex CLI prompts. If the human needs a new Convex team, pause and have them create it in the Convex dashboard first.

When starting a new app from this starter, prefer `bun run new-project ../name` instead of ad hoc copy commands. After setup, check `.starter/setup-state.json` for non-secret setup context before changing env or deployment values. Do not rotate `AUTH_SECRET` or `TEST_HELPER_SECRET` unless the user explicitly asks; setup preserves them by default, and `--rotate-secrets` is intentional.

Default verification:

```bash
bun run typecheck
bun run test
bun run build
```

For user-facing changes, also run:

```bash
bun run test:e2e
```

The default local test suite should not require real Resend, Telnyx, Cloudflare, or production credentials.

## UI

The UI uses the shadcn/ui CSS variable contract in `src/styles/app.css`. Keep components on semantic tokens such as `bg-background`, `bg-card`, `bg-sidebar`, `text-foreground`, `border-border`, and related tokens so generated shadcn themes can be dropped into the `:root` and `.dark` blocks.
