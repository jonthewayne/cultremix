# Chain report: provenance on Monad

Branch `codex/chain` (worktree `CultRemix-wt/chain`), on top of `042efbd` (Economics). Scope: V1 unit U7, the onchain half of Backs (R28/R29), and economic config registration. Written 2026-10-04.

## Where it stands

- Steps 1–6 are built and tested. Step 7's entry point (`internal.amendments.queueLineageAmendment`) exists.
- Tests: forge 55/55, unit 29 files/182 tests, convex-local 6 files/47 tests, and the anvil end-to-end run 6/6. That run drives the real contract through the real Convex and viem code path.
- **The testnet deploy hasn't happened.** The dev relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921` held 0 MON on chain 10143 when I checked on 2026-10-04 (a read-only `eth_getBalance`). The deploy script is written and rehearsed on anvil. Once the relayer is funded, deploying is one command (see "What the Builder does").
- Nothing touched a deployment. Nothing was pushed. No secret was read: the testnet key file was never opened, because the relayer had no balance.

## Commits

| Commit | Step |
| --- | --- |
| `b3aa072` | 1. CultRemixRegistry contract, forge suite, Foundry deploy script |
| `653083a` | 2. viem registry library and the deployment matrix (`shared/config/chains.ts`) |
| `661131d` | 3. Member wallets via Circle, the dev signer, the reconciliation cron |
| `9f5c7bd`, `0fe7c82` | 4. Relayer write engine and its tests |
| `fbbd8e4` | 5. Publish hook, work page provenance, `/admin/chain` |
| `74a5c16` | 6. Backs with onchain ordinals, earliest backers on the work page |
| `525b575` | 7. Internal entry point for lineage amendments |
| `493f529` | Anvil end-to-end run and testnet deploy script |
| (this commit) | Env var docs and this report |

## Files built

**Contract** (`contracts/`, Foundry 1.8.4, no dependencies)
- `src/CultRemixRegistry.sol`:
  - Non-upgradeable. Roles are one admin (two-step transfer) and a set of relayers.
  - EIP-712 `registerWork` and `back`, each signed by the creator or backer.
  - `amendLineage` (admin; sequence; kind changes only original ↔ fork; checks cycles up to 64 hops) and `registerEconomicConfig` (admin; append-only versions).
  - Views and events for everything (R39).
- `test/CultRemixRegistry.t.sol`: 55 tests covering the plan's U7 contract scenarios. `test/fixtures/eip712-vectors.json` is shared with the TS signer, so the two can't drift apart.
- `script/Deploy.s.sol` and `README.md`: what the registry proves (and what it doesn't), the rules, build, deploy, and this machine's libusb patch for Foundry.

**Chain library** (`convex/lib/chain/`, runs in Convex's default runtime with no `"use node"`)
- `abi.ts`: the committed ABI, from `scripts/chain/export-abi.ts`.
- `ids.ts`: work IDs, kind codes, uri/reason/config hashes, and the registerWork message.
- `eip712.ts`: the domain, typed data, and signature deadlines.
- `calldata.ts`: encoders, revert decoding, and how each revert is handled.
- `rpc.ts`: the viem RPC behind a replaceable interface; `deps.ts` injects it in tests.
- `writes.ts`: payloads, finality, fee bumps, reconciliation from contract state, and the registry week.
- `queue.ts`: one write per subject, the wallet and parent gates, the `chain.writes` flag, and the enqueue helpers.
- `custody.ts`: Circle in staging and prod; the dev-only HMAC-derived local signer anywhere else is refused.
- `convex/lib/circle.ts`: a Circle client for wallet creation and typed-data signing, with a replaceable fetch and the entity-secret ciphertext.

**Config**
- `shared/config/chains.ts`:
  - Monad testnet and mainnet, plus `CHAIN_ENVIRONMENTS` for dev, staging, and prod (registry, relayer, Circle key environment, wallet set).
  - `assertDeploymentConsistency`, `assertRelayerAddress`, `assertRpcChainId`, and explorer URLs.
- `tsconfig.json` now includes `shared/`.

**Convex**
- `convex/schema/chain.ts`: new tables `chainWrites`, `relayerState`, and `backs`.
- `convex/wallets.ts`: provision (claim lease, Circle idempotency key stored before the first call), record, back off on failure, the reconciliation cron, and the `mine` query.
- `convex/chain.ts`, the relayer engine:
  - Lease with generation fencing.
  - Each raw transaction, hash, and nonce persisted before broadcast.
  - Finalized, canonical receipts only (INV-30).
  - Re-sign on an expired signature; +20% fee replacements ×3, then stall; "Clear stuck nonce".
  - Recovery when a nonce was consumed elsewhere.
  - Deferral while gas can't be paid.
  - `kick`, `relayerStatus`, and `clearStuckNonce`.
- `convex/chainAdmin.ts`: the overview, the writes on/off switch, register economic config v1, retry a failed write, and queue earlier works.
- `convex/provenance.ts`: a work's registration status and its explorer link.
- `convex/backs.ts`: `back` (admission and reservation) and `forWork` (count, earliest 10, the viewer's own position).
- `convex/amendments.ts`: `queueLineageAmendment` (internal).
- Changes to existing files:
  - `convex/auth.ts`: new users start `walletStatus: "pending"`, and provisioning is scheduled.
  - `convex/publish.ts`: `markPublished` enqueues the registration.
  - `convex/bootstrap.ts`: seeds `chain.writes` (on in dev only); `devReset` also clears the chain tables.
  - `convex/crons.ts`: "chain write tick" every minute, "wallet reconciliation" every 5 minutes.
  - `convex/schema.ts` and `convex/schema/cultremix.ts`: optional wallet fields on `users` and provenance fields on `works`.
  - `convex/_generated/api.d.ts`: hand-edited.

**UI**
- `src/routes/admin_.chain.tsx` (`/admin/chain`): the queue by status, recent writes with explorer links, the relayer's address and balance, and owner controls.
- `src/components/cr/ChainStatus.tsx`: replaces "Verified on Monad — coming soon" on `cr.$cr.tsx`.
- `src/components/social/BackButton.tsx` and `src/components/work/Backers.tsx`: on the work page.
- `src/routeTree.gen.ts`: regenerated.

**Scripts and tests**
- `scripts/chain/`:
  - `deployRegistry.ts`, a viem deploy and config-registration helper;
  - `deploy-testnet.ts` (`bun run chain:deploy:testnet`);
  - `registryArtifact.ts`, `export-abi.ts`, and `eip712-vectors.ts`.
- Unit tests: `chainCalldata`, `chainConfig`, `circle`, `custody`, `eip712`.
- Convex-local tests: `chainWrites`, `chainAdmin`, `backs`, `chainAmendments`, `walletProvisioning`, plus the `fakeChain.ts` and `chainFixtures.ts` helpers.
- `tests/chain-e2e/` and `vitest.chain-e2e.config.ts` (`bun run test:chain:anvil`).

Where the plan named other paths:
- `convex/lib/eip712.ts` → `convex/lib/chain/eip712.ts`.
- `convex/lib/relayer.ts` → folded into `convex/chain.ts`.
- `src/components/chain/ChainStatus.tsx` → `src/components/cr/ChainStatus.tsx`, next to the other work page parts.
- `src/routes/admin.chain.tsx` → `admin_.chain.tsx`, so `/admin/chain` doesn't nest inside the `/admin` page.

## Plan requirements

| Requirement | Where |
| --- | --- |
| R15: publishing registers provenance | `markPublished` → `enqueueRegisterWork`; the creator's wallet signs `RegisterWork`, the relayer sends it, and the work page shows queued, sent, or registered with an explorer link |
| R19 (registry half): append-only amendments | `queueLineageAmendment`, plus the contract's `amendLineage`. The UI, the table, and effective lineage are U11 |
| R28: ≤3 Backs a week, ≤1 per work, never your own, verified email | `backs.ts` admission, enforced again by the registry. Copy says nothing about money (KD8) |
| R29: each Back onchain with its ordinal; earliest backers and the viewer's position | the ordinal comes from the finalized `Backed` event; `Backers.tsx` shows them |
| R36: every user gets a wallet, retried until ready | `wallets.ts`: provisioning on signup, the 5-minute reconciliation cron, backoff from 1 minute up to an hour |
| R37: no MON, seed phrase, or wallet connection | the relayer pays gas; members never see a key |
| R38 / INV-13 / KTD-14: environments never mix | `assertDeploymentConsistency` before every external effect; `chainConfig.test.ts` |
| R39: readable from the contract and events; explorer links | contract views and events; links on the work page and `/admin/chain` (hidden for a localhost dev RPC) |
| R40: asynchronous, with states and safe retry | the `chainWrites` states; publish never waits; admins can retry |
| KTD-7: relayer plus signatures, raw tx persisted first, nonce lease | `convex/chain.ts` |
| INV-7, INV-8 | forge suite; Backs admission tests |
| INV-19 | `walletProvisioning.test.ts` (backfill, backoff, the idempotent Circle key) |
| INV-22 | crash-after-broadcast replay rebroadcasts the persisted transaction; duplicates reconcile from contract state |
| INV-30 | provisional receipts are ignored until finalized; reorged receipts are ignored; reconciliation reads use `finalized` |
| "Chain write outcomes" table | one `chainWrites.test.ts` case per row |

## Tests and results (2026-10-04)

| Command | Result |
| --- | --- |
| `cd contracts && forge test` | 55 passed |
| `bun run test` (unit) | 29 files, 182 tests passed. Chain files: chainCalldata 11, chainConfig 12, circle 7, custody 7, eip712 9 |
| `bun run test` (convex-local) | 6 files, 47 tests passed: chainWrites 21, chainAdmin 10, walletProvisioning 7, backs 4, chainAmendments 4, harness 1 |
| `bun run test:chain:anvil` | 1 file, 6 tests passed in about 7 s; no anvil left running |
| `bun run typecheck` | passes (the Convex typecheck is skipped because the worktree has no deployment) |
| `bun run build` | passes |
| `bun run chain:deploy:testnet --local … --broadcast` | rehearsed on anvil: deployed, then registered config v1 |

The anvil run starts a private anvil node as chain 10143 and deploys the real bytecode with `deployRegistry.ts`. It then runs the Convex functions in convex-test against it with the real `viemRpc`. Only the timer functions are faked, so the scheduler doesn't fire on its own. It covers:
1. Two originals and a remix. The remix is queued first and waits for its parent. All three confirm, and `getWork` matches.
2. Two Backs that confirm with ordinals 1 and 2, matching `backOrdinal` and `backerCount`.
3. Two amendments (original → fork → original).
4. A variation → fork change that the registry rejects as `KindChangeNotAllowed`.
5. Config v1 registered by the script first, then confirmed by the Convex write without sending, followed by config v2 sent by the engine.
6. At the end: the relayer isn't stalled and its nonce matches the chain.

It needs Foundry (`~/.foundry/bin/anvil` or `ANVIL_BIN`), so it's kept out of `bun run test`. No test reaches a public network.

Lint: the new files are clean. Repo-wide `eslint` reports 227 problems that predate this branch. `vitest.*.config.ts` files hit a parserOptions.project error, as `vitest.convex-local.config.ts` already did.

## Decisions

- **The flag fails closed.** With no `chain.writes` row, nothing is sent. `ensureDefaults` seeds it on in dev and off elsewhere. With the flag off, writes already sent are still followed to finality, and new Backs are refused ("Backing is paused right now").
- **Binding.** A write binds to its chain ID and registry when it's first signed. A pending write bound to another chain or registry fails closed. An admin retry unbinds it.
- **Admin writes.** The relayer signs every write, including amendments and configs, so each environment's registry admin is its relayer until a separate admin key exists. If the relayer isn't the admin, an admin write fails with `NotAdmin`, shown in `/admin/chain`.
- **Remixes.**
  - A remix waits for its parent's registration.
  - A withdrawn parent can still anchor a remix (provenance continues for withdrawn works, INV-27).
  - A child of a failed parent waits until an admin retries the parent.
- **Retries.** Only failed non-Back writes can be retried by an admin. A failed Back goes again when the member Backs again, so their weekly limit is checked again.
- **Permissions.** Super admins can view `/admin/chain`; acting takes `chain:manage`, which only the owner has today. I didn't edit `authz.ts`.
- **Backs.**
  - A username is required as well as a verified email.
  - There's one `backs` row per (work, backer), reused after a failure.
  - The count is the highest confirmed ordinal.
  - Admission counts the week at request time; a confirmed Back takes the chain's week from its event.
- **Amendments.**
  - Allowed only when the work's registration and every earlier amendment are confirmed and none is in flight.
  - A rejected or failed amendment reuses its sequence and write.
  - `newParentWorkId` is stored on the write so effective lineage can be walked offchain.
- **Provenance query.** Kept separate from `feed.byCr`, which the feed uses.
- **Deploy script.**
  - It's a dry run unless `--broadcast` is given.
  - It refuses a key that isn't the dev relayer, a chain other than 10143, a balance under twice the estimated deploy cost, or a dev registry that's already recorded.
  - It registers config v1 directly as admin; Convex's config write then finds it onchain and confirms without sending.
  - `--local` reads no secret.
- **Nonces.** The engine takes the larger of its own next nonce and the chain's count, so the script's use of the relayer key is absorbed. Still, run the script while the relayer is idle.
- **Deferral.** When gas estimation reverts, the engine acts only if a `finalized` read gives the same reason; otherwise it waits and checks again with backoff (INV-30). That's why the e2e mines a few blocks after the script registers config v1.

## Stubbed or waiting on keys

- **Testnet registry.** It isn't deployed because the relayer has 0 MON. `registryAddress` is `null` for dev, staging, and prod. The plan's U7 check ("testnet registry address in `shared/config/chains.ts`; explorer shows a test record") waits on funding.
- **Circle.** The client is complete and unit-tested with a replaced fetch, but it has never been called live. The U0(c) dev gate needs the test keys. Until then dev uses the local signer (`DEV_WALLET_SECRET`), which is refused outside dev. `circleWalletSetId` is `null` everywhere.
- **Staging and prod.** No relayer EOA, registry, or Circle wallet set is recorded yet, so Convex refuses chain writes there until they are (INV-13).
- **Economic config JSON route.** `/economics/v1.json` (U10) isn't built. The registered hash is the SHA-256 of `canonicalConfigJson(ECONOMIC_CONFIG_V1)` from `convex/lib/economics.ts`, so that route must serve exactly those bytes.
- **Amendments UI and effective lineage.** These are U11 (see below).

## What the Builder does

1. **Merge `codex/chain` into `dev`.**
   - `convex/_generated/api.d.ts` was hand-edited (new modules: amendments, backs, chain, chainAdmin, provenance, wallets); regenerate it if it conflicts.
   - Rerun `bun run build` for `src/routeTree.gen.ts`.
   - If `dev` already has a `backs` table or `convex/backs.ts` from U12 work, merge them by hand.
2. **Fund the dev relayer** `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921` from the Monad testnet faucet.
   - `bun run chain:deploy:testnet` (read-only) prints the balance and the exact amount needed: deploy (about 1.9M gas) plus the config transaction, with 2× headroom.
3. **Deploy:** `bun run chain:deploy:testnet --broadcast`.
   - It reads `MONAD_RELAYER_PRIVATE_KEY_DEV` from `~/.config/cultremix/chain.env` without printing it.
   - It deploys with the dev relayer as admin and relayer, registers economic config v1, and prints both explorer links.
   - If it stops after the deploy, rerun it with `--registry 0x…`.
4. **Record the address** as `CHAIN_ENVIRONMENTS.dev.registryAddress` in `shared/config/chains.ts` and commit.
5. **Set Convex dev env:**
   - `DEPLOYMENT_ENV=dev`;
   - `MONAD_RELAYER_PRIVATE_KEY` (the same dev relayer key);
   - either `DEV_WALLET_SECRET` (any long random string; changing it later stops existing dev wallets from signing) or all three of `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` (then also record the wallet set in `chains.ts`).
   - `MONAD_RPC_URL` is optional (it defaults to the public testnet RPC). Leave `CHAIN_REGISTRY_ADDRESS` unset when using the committed registry.
   - `SITE_URL` should be the canonical dev URL: the work page URL is hashed into each record and never changes.
6. **Deploy Convex dev.**
   - Schema: new tables `chainWrites`, `relayerState`, `backs`; optional fields on `users` and `works`; a new users index. No backfill is needed.
   - Run `bootstrap:ensureDefaults` to seed `chain.writes` (on in dev).
   - The crons come with the deploy: chain write tick every minute (the tick also reschedules itself while work is in flight) and wallet reconciliation every 5 minutes, which gives existing users wallets.
7. **In `/admin/chain`, as the owner:**
   - Check that the deployment line shows Monad testnet and the registry, and that the relayer has a balance.
   - Press **Register economic config v1**. It finds the script's registration and confirms without sending.
   - Press **Queue earlier works** to register works published before this, 100 at a time.
8. **Check it:**
   - Publish a work. Its page goes from queued to registered with an explorer link a few blocks after inclusion.
   - Back it from a second account with a verified email; the backer's place appears under Backers.
9. **Optional:** grant `chain:manage` to an ops role in `convex/lib/authz.ts` so someone besides the owner can retry writes and clear a stuck nonce.
10. **U11 glue for amendments:**
    - When an admin appends a correction, call `internal.amendments.queueLineageAmendment` with `{ workId, newParentWorkId | null, newKind, reasonHash: reasonHashFor(reason), sequence }`.
    - Store the returned `chainWriteId` on the `lineageAmendments` row.
    - Apply the correction to `works.effectiveParentWorkId` only once that write is `confirmed`. A natural hook is `reflect` in `convex/chain.ts`, which already updates works and Backs when a write settles.
    - Refusals come back as `ConvexError` codes (`BAD_SEQUENCE`, `KIND_CHANGE_NOT_ALLOWED`, `FAMILY_MISMATCH`, `LINEAGE_CYCLE`, …), worded for an admin screen.
11. **After a `devReset`:** CR numbers restart at 101, which the old dev registry already holds, so registrations fail (`FamilyTaken`). Either deploy a fresh dev registry and point `CHAIN_REGISTRY_ADDRESS` at it, or clear `registryAddress` in `chains.ts` and rerun the deploy script (it refuses while an address is recorded).
12. **Staging and prod (U15):**
    - Create one relayer EOA per environment and record its `relayerAddress`.
    - Deploy each registry (mainnet from the bytecode verified on staging).
    - Use Circle LIVE keys for prod and record each wallet set.
    - Turn `chain.writes` on in `/admin/chain` when ready; it's seeded off there.

## Follow-ups

- Build the `/economics/v1.json` route (U10), serving `canonicalConfigJson(ECONOMIC_CONFIG_V1)` byte for byte.
- When the Circle test keys arrive, run the U0(c) dev gate: create a wallet, retry with the same key, and recover a typed-data signature.
- `fakeChain.ts` walks cycles slightly differently from the contract; the anvil run covers the real contract.
- Repo-wide lint isn't clean, and that predates this branch.

## Merging dev

`codex/chain` is up to date with `dev` as of 2026-10-04: `5b548a8` merges `dev`, and `9d3402c` connects lineage corrections to the chain engine. Nothing was pushed, and nothing touched a deployment.

### What was combined

- **`convex/publish.ts`.** `markPublished` keeps all of dev's steps, in dev's order:
  - the activity record and `analyzeWork`;
  - the daily photo-shoot limit;
  - `shopify.onPublished`;
  - budget `reservePhoto` / `failShootPhoto`.

  `enqueueRegisterWork` goes after `analyzeWork` and before the photo shoot. `markPublished` is still the only publish path, so every published work queues one registration.
- **`src/routes/cr.$cr.tsx`.** All of dev's components stay:
  - `ColorSwatches`, `BuyBox`, `EconomicsPanel`, `LineageNote` / `LineageSection`, `DirectRemixes`, `FamilyView`, `PhotoRetry`, `PrintEntry`, and the share preview.

  The Fingerprint block shows `ChainStatus` (provenance state and explorer link) in place of "Verified on Monad — coming soon". `Backers` (the Back button and earliest backers) comes after it and before `PrintEntry`. My old color-name markup went, because dev's swatches replace it.
- **Economics panel.** `workEconomics.panel` now reads `works.provenanceStatus`: `provenance` is `"confirmed"` once the registration is confirmed, and `"pending"` before that. `EconomicsPanel.tsx` already switches between "These shares will be recorded on Monad" and "These shares are recorded on Monad", so the UI didn't change.
- **Schema.**
  - `convex/schema.ts` has every table from both sides.
  - `users` has the wallet fields and dev's `bio`.
  - `works` (`convex/schema/cultremix.ts`) has the provenance fields and dev's `printKey` / `printSha256`.
  - `chainWrites` gains an optional `amendmentId` (below).
- **`convex/crons.ts`.** Both sides' crons are kept:
  - mine: wallet reconciliation (5 min) and the chain write tick (1 min);
  - dev's: metrics rollup, the shop crons (orders, product retry, Printful, earnings maturity, webhook purge), and the budget sweep.
- **`convex/auth.ts`.** Dev's user insert, plus `walletStatus: "pending"` and the scheduled wallet provisioning.
- **`package.json`.** Dev's scripts plus `test:chain:anvil` and `chain:deploy:testnet`.
- **`docs/environment-variables.md`.** Every row appears once:
  - dev's `VITE_*` rows, which include `.env.staging`;
  - dev's `SITE_URL` row, noting that the work page URL is hashed into each record;
  - a single `DEPLOYMENT_ENV` row that names both Printful auto-confirm and the chain network/registry;
  - the chain rows after the Printful rows: `MONAD_RPC_URL`, `CHAIN_REGISTRY_ADDRESS`, `MONAD_RELAYER_PRIVATE_KEY`, the three `CIRCLE_*`, `DEV_WALLET_SECRET`, `MONAD_RELAYER_PRIVATE_KEY_DEV`, and `ANVIL_BIN`;
  - a "Chain (Monad)" section after Shop.
- **`convex/_generated/api.d.ts`.** Dev's file, plus my 18 modules added by hand in sorted order: `amendments`, `backs`, `chain`, `chainAdmin`, `provenance`, `wallets`, `schema/chain`, `lib/circle`, and the ten `lib/chain/*` files.
- **Fixes the merge needed:**
  - `src/routeTree.gen.ts`: dev's copy had no `/admin_/chain` route, so it was regenerated by `bun run build`.
  - `tsconfig.json`: both sides had added `shared`, so it's now listed once.
  - `convex/amendments.ts`: `writes.at(-1)` became an index read, because the Convex tsconfig's `ES2021` lib has no `Array.prototype.at`.

### Lineage corrections, connected

`convex/lineage.ts` wasn't edited. The connection lives in `convex/amendments.ts`, `convex/chain.ts`, and `convex/chainAdmin.ts`.

- **Sending.** Every chain kick (every minute) first runs `sendRequestedCorrections`. While `chain.writes` is on, it reads up to 100 requested rows from `lineage.requestedForChain`, oldest first. It sends each one through `queueLineageAmendment` as a sub-transaction, with:
  - the row's `chainSequence`, `newKind`, and `newParentId`;
  - `reasonHashFor(reason)`.

  The write stores `amendmentId`, and `lineage.markSubmitted` records the write's ID on the row.
- **Waiting and refusals.**
  - These refusals can clear on their own, so the row stays `requested` and is tried on the next kick:
    - `NOT_REGISTERED` and `PARENT_NOT_REGISTERED` (the work or the new parent isn't confirmed on Monad yet);
    - `IN_FLIGHT` (the work's previous amendment is still being recorded).
  - Any other refusal calls `lineage.markRejected`, with the refusal's admin-facing message as the reason.
- **Outcomes.** `reflect` in `convex/chain.ts` follows the write.
  - A confirmed write calls `lineage.markConfirmed` with the confirmation time. That applies `effectiveKind`, `effectiveParentWorkId`, and `lineageAmendedAt` to the work, so a correction confirmed onchain is confirmed offchain.
  - A rejected or failed write calls `lineage.markRejected` with the engine's error.
- **Retrying.**
  - `/admin/chain` no longer offers Retry for a write linked to a correction. `retryWrite` refuses it with code `CORRECTION`, and the overview row's new `retryable` flag hides the button.
  - Requesting the correction again on `/admin/lineage` reuses the same write for the same sequence and links it to the new row.
- **Tests.** Five cases in `tests/convex-local/chainAmendments.test.ts`:
  - request → submitted → confirmed, with the work's effective lineage updated;
  - waiting while chain writes are off and while the work is still registering, then confirming;
  - a permanent refusal rejecting the row;
  - a registry rejection (`FamilyMismatch`) rejecting the row, Retry refused, and a re-request reusing the write until it confirms;
  - the Economics panel switching to confirmed.

### Verification (after the merge and the connection)

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | no changes |
| `bun run typecheck` | passes (the Convex typecheck is skipped because the worktree has no deployment) |
| `bunx tsc --noEmit -p convex` | passes |
| `bun run test` | unit 54 files, 456 tests; convex-local 23 files, 262 tests; all pass |
| `cd contracts && forge test` | 55 passed |
| `bun run test:chain:anvil` | 6 passed |
| `bun run build` | passes; `routeTree.gen.ts` unchanged by the final build |

### What the Builder must still do

1. **Regenerate `convex/_generated/api.d.ts`** after merging. The committed copy is dev's file with the chain modules added by hand.
2. **Deploy the schema.** The only new piece since the merge is an optional field, `chainWrites.amendmentId`. No backfill is needed. The rest of the chain schema is in step 6 of "What the Builder does" above.
3. **Expect corrections for unregistered works to wait.** A correction for a work that isn't confirmed on Monad stays `requested`. Press **Queue earlier works** on `/admin/chain`, and the next kick after the registration confirms sends the correction. Otherwise, cancel it on `/admin/lineage`.

   Each kick reads only the oldest 100 requested rows. If more than 100 of them are waiting on registrations, newer corrections wait behind them, so queue the earlier works first.
4. **Know that corrections confirmed offchain only stay that way.** Corrections confirmed while chain writes were off are never sent to Monad later; `lineage.ts` leaves them out of `chainSequence`. For those works, the registry keeps the earlier lineage. A later correction that the registry's lineage can't take is rejected with the reason shown on `/admin/lineage`.
5. **Optional:** `bootstrap:devReset` clears works but not `lineageAmendments`. After a reset, a correction still requested points at a deleted work and is rejected on the next kick ("That work doesn't exist."). Add `lineageAmendments` to devReset's tables if that's unwanted.
6. **The rest of "What the Builder does" still applies:** fund the relayer, deploy the registry, set the env vars, then use `/admin/chain`. Its step 1 merge notes are handled here, and step 10, the U11 connection, is done.
