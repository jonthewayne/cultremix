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

## Second round: everything left unbuilt (same day)

Built, then reviewed cross-model the same way (Codex builds, Claude Fable 5.2 reviews read-only), scope `5dcc097..69ea9a4`:

- Costs-first sharing as economics v6 (production went from v4 straight to v6), with saved Printful costs, a below-cost hold on printing, price checks in Admin, Products, and refunds that come out of what was left after costs.
- Artist claims: a 14-day review with an admin undo, notifications for each decision, and sales following confirmed lineage corrections.
- Artist credits recorded on Monad through the registry's lineage call with the lineage unchanged, artists named by a keyed hash (`ARTIST_HASH_SECRET`).
- Kept words read against the original, rerun when the kept words change, and read exactly when anything was typed; the prompt-leak check reads other languages, unscreened requests, and spaced, gapless, or mirrored lettering.
- The phrase decision audited: a parent is set only by an explicit remix or a staff correction.

| Pass | Result | Fixed in |
| --- | --- | --- |
| 1 | 6 P2, 8 P3 | `dd35251` |
| 2 | 1 P2 (a regression in the leak check), 5 P3 | `9477fe3` |
| 3 | clean at P0-P2, 4 P3 | `4fd3b51` |
| Adversarial | 2 P2 (a kept word swapped by one letter; shipping discounts), 6 P3 | `897ca09` |
| Confirming | 1 P2 (the same swap through a character box), 3 P3 | `69ea9a4` (not re-reviewed: five-pass limit) |

Verification: typecheck, 733 unit and 435 backend tests, build, e2e smoke and signed-in, and the screen viewer (46 screens, none failed). Deployed as `69ea9a4` after a backup (`~/cultremix-backups/prod-before-69ea9a4-2026-11-16.zip`); all 12 data steps clean, including the new costs and credits steps; production smoke passed; work pages report rules v6 with costs first, and the live Bella+Canvas 3001 prices cover their costs in every size and placement on sale.
