# Mega review: prompt protection and artist credits (November 16, 2026)

Scope: `b869ce2..67cc7d7` (prompt protection `41af662`, artist credits `67cc7d7`), reviewed cross-model: Codex (gpt-6) built and fixed, Claude Fable 5.2 (high) reviewed read-only.

| Pass | Result | Fixed in |
| --- | --- | --- |
| 1 | 1 P1, 6 P2, 6 P3 | `c11e42e` |
| 2 | 3 P2 (regressions in the fixes), 6 P3 | `44f1619` |
| 3 | clean at P0-P2, 7 P3 | `c5ee2c9` |
| Adversarial | 3 P2, 6 P3; no money theft or ledger break found | `ee7c0b4` |
| Confirming | 2 P2, 5 P3 | `982012c` (not re-reviewed: five-pass limit) |

The main fixes: a claimed artist's held share folds into a claimant already paid on the same line; claims move money in scheduled batches; an artist is identified by their link; kept-word reading covers near misses, grown words, and boxes-only remixes; the prompt-lettering check covers single-design calls and what the member typed in boxes; brand rates left the public economics response; production stays on economics v4 (and hides artist credits) until `ECONOMICS_VERSION=5` is set there. Details and what's still open are in [decisions](../decisions.md) ("Review fixes") and [prompt protection](../image-generation/prompt-protection.md).

Verification: `bun run typecheck`, `bun run test` (724 unit, 426 backend), `bun run build`, `bun run test:e2e` (smoke and signed-in), and `bun run screens` (46 screens; Print Studio timed out waiting for "Prepare for print", untouched by this work). The image suite wasn't rerun (about $2.40 of gateway credit left).

Deployed to production as `982012c` on November 16 after a backup (`~/cultremix-backups/prod-before-982012c-2026-11-16.zip`); data steps clean; smoke passed; work pages report rules v4.
