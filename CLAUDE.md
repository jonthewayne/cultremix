# Claude Project Instructions

Follow `AGENTS.md` for the full project instructions.

When running `bun run setup`, do not let Convex infer or silently reuse a team from local CLI state. Ask the human which existing Convex team slug to use before continuing. If they need a new team, have them create it in the Convex dashboard first, then rerun setup with the team slug.

When starting a fresh app, use `bun run new-project ../name` from the starter instead of hand-copying files. Check `.starter/setup-state.json` after setup for non-secret context. Never rotate generated auth/test secrets unless the human explicitly asks for `--rotate-secrets`.

Record starter-template improvements and lessons in `docs/starter-improvements.md` whenever setup, auth, deployment, testing, or agent workflow changes make future project starts easier.
