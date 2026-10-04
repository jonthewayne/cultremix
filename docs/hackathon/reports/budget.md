# Budget builder report

Branch `codex/budget` (worktree `CultRemix-wt/budget`), on top of `08b5d1b`. Not pushed.

## Stopping condition

- All five parts are built: pricing, admission, settlement (with the sweeper), admin, and tests.
- `bun run typecheck`, `bunx tsc --noEmit -p convex`, `bun run test`, and `bun run build` all pass on the final commit.
  - Unit tests: 31 files, 219 tests (10 new in `tests/unit/pricing.test.ts`).
  - Convex tests on the in-memory backend: 8 files, 81 tests (20 new in `tests/convex-local/budget.test.ts`).
  - The Convex typecheck inside `bun run typecheck` is skipped because `CONVEX_DEPLOYMENT` is unset.
- **Real per-call costs reported by the gateway: none.**
  - No key was authorized for a live check, so no gateway call was made from this branch.
  - The `~/cultremix-imagecheck` logs cut the cost string short, so no `providerMetadata.gateway.cost` value has been captured yet.
  - The prices below are the README's billed amounts from the gateway's per-generation records (2026-09-29 to 2026-10-02), not values read from `providerMetadata`.
  - The first production calls will show whether `gateway.cost` arrives. The admin card counts calls settled at the reported cost and calls settled at the worst case.

## What was built, by requirement

### 1. Pricing in one place: `convex/lib/pricing.ts`

- `PRICING_VERSION = 1`. Each reservation records the version it was priced with.
- List prices: $30 per million output tokens, $8 per million image input tokens, $5 per million text input tokens.
- Output bounds per canvas:
  - grid: 819 tokens at medium, 3,276 at high
  - single design: 343 at medium; high is bounded at 3,276
- Other bounds:
  - 1,700 tokens per input image
  - 6,000 prompt tokens for the studio and 1,000 for a photo
  - 0.5¢ for the grid's roles read
  - ×1.25 headroom
  - Everything rounds up to whole cents.

Worst cases at today's bounds:

| Operation | Worst case | Billed in testing (README) |
|---|---|---|
| Grid, `GRID_QUALITY` high, words only | 17¢ | 9.9¢ (11.1¢ with one image) |
| Grid, high, 12 images | 38¢ | not measured |
| Grid, medium, words only | 8¢ | 2.5¢ (3.8¢ with one image) |
| Single design, medium, words / 1 image | 6¢ / 7¢ | 1.07¢ / 2.31¢ |
| Model photo, medium | 4¢ | not measured on its own; a one-image 1024×1536 edit billed 2.31¢ |
| Topaz upscale (fal) | 8¢ per started 24 MP of output: 8¢ for a grid design, 16¢ for 1024×1536 | price page |

- `qualityOf` reads `GRID_QUALITY`, `IMAGE_QUALITY`, and `PHOTO_QUALITY`. Any value other than low or medium, including `auto`, is priced as high.
- `gatewayCostCents(providerMetadata)` reads `gateway.cost`. That can be a dollar string such as `"0.0252"`, a number, or a JSON string of the whole gateway entry. It returns cents to a hundredth (2.52), or `undefined` when nothing usable came back.

### 2. Admission in `generate` (`convex/studio.ts`)

- **When:** after the credit check, in the same mutation.
- **The check:** the batch's whole worst case must fit in `appSettings.dailyBudgetCents − settled − open` for the gateway's UTC day (`hasRoom`).
  - A grid is one hold.
  - `STUDIO_LAYOUT=single` holds four designs, checked together.
  - If it doesn't fit, nothing is written and `{ refused: "BUDGET" }` comes back.
- **The studio's message:** "The studio is resting until tomorrow. Your credits are safe."
- **Totals row:** each provider and UTC day has a `budgetDays` row with running settled and open totals, so admission reads one row.
  - Convex mutations are serializable, so two batches racing for the last cents conflict on that row, and only one is admitted.
- **Credits:** unchanged. A grid costs 2 per batch; a single design costs 1.
  - The owner pays no credits, but their reservation is held as usual (`credits: 0`).
- **Model photos:**
  - `markPublished` reserves the first photo. If the budget is spent, the work still publishes; the photo is marked failed with the resting message, and the action skips the call.
  - `beginReshoot` checks the budget before it changes anything. If refused, it returns `null` and the shoot is untouched.
  - Photo calls are sent at once, so they're reserved as already dispatched.
- **ChatGPT path:** not billed per call, so it holds nothing (`imageProviderSetting()` mirrors `generate`'s provider choice).

### 3. Settlement (`convex/lib/budget.ts`, `convex/lib/paidAttempts.ts`, `convex/imageGen.ts`)

- `paidCall` wraps every gateway call: the grid, single designs, the first model photo, and reshoots.
  - **Success:** settles at `gatewayCostCents(providerMetadata)`. If that's missing, it settles at the worst case with reason `no cost reported`, recorded as `costSource: "worst_case"`.
  - **Failure:** `callFailure` sorts the error.
    - A 4xx status (on the error or its `cause`) or the content filter is a release.
    - An answer without an image settles, and the design fails.
    - A timeout, 5xx, or no answer settles at the worst case. The tiles become `unknown_outcome` and are refunded exactly as failures are.
  - Anything that fails after a successful call (cutting or storage) settles at that call's reported cost, and the designs fail.
  - Anything that fails before the call is released (`not sent`).
- **Never dispatched:**
  - `markBatchDispatched` and `markDispatched` release the hold when generation is paused.
  - Both refuse to send an attempt whose reservation is no longer open (`authorizeDispatch`), for example after the sweeper released it.
  - The dev stand-in paths release with reason `stand-in`.
- **Overage:**
  - Settling above the hold records `overageCents` on the reservation and the day.
  - It also turns the provider's flag off: `gen.vercel` for the gateway, `gen.upscale` for fal (INV-12).
  - The flag stays off until an admin turns it back on in Switches. A `console.warn` names the attempt.
- **Closing is idempotent:** a late finish from a dead action changes nothing.
- **The day a reservation counts against** is its admission day, even if it settles after midnight UTC.
- **Sweeper:** `budget.sweep` runs every 10 minutes (`convex/crons.ts`) and handles up to 100 stale holds per run, following "Paid attempt lifecycle":
  - Queued more than 10 minutes and never sent: released. Its tiles become `expired` ("Timed out before starting.").
  - Sent more than 15 minutes ago: settled at the worst case. Its tiles become `unknown_outcome` ("We lost track of this one.").
  - Missing designs get credits back by the usual rule (`creditsBack`, or 1 per single design).
  - A first model photo that was still pending is marked failed. A reshoot keeps the photo that's up.

### 4. Admin

- **`src/components/admin/BudgetCard.tsx`:** "Today's spend" on the admin overview, above Switches. It reads `api.budget.today` (admin `view`).
  - A bar, then four stats: Spent, Open holds (n), Left, Daily cap.
  - A line with how many calls settled at the reported cost and how many at the worst case.
  - An overage message, with a "Switched off" badge when the flag is off.
  - Upscales get their own block once they have activity.
  - It is phone-friendly: 2 columns on a phone, 4 on wider screens.
- **Members search:** each row gets `spentTodayCents` (open holds at worst case, settled at cost, from the `by_user_day` index, at most 500 rows). It shows "$0.17 of images today" under the credits.

### 5. Tests

`tests/convex-local/budget.test.ts` has 20 tests, all passing. Fake timers keep the scheduled Node actions from running.

**Admission**
- Two batches race for the last of the budget: one is admitted and the other gets `BUDGET`. There's one reservation, one batch, and the refused member's credits are untouched.
- The single layout's four holds are all-or-nothing.
- The owner counts toward the budget without paying credits.
- The ChatGPT path holds nothing.
- The UTC day boundary:
  - A batch admitted at 23:59:59Z is held on that day.
  - At 00:00:01Z there's a fresh budget.
  - Settling yesterday's batch after midnight books it to yesterday.

**Settlement**
- A reported cost settles and frees the rest of the hold.
- A release before dispatch puts the whole budget back, with no charge.
- A pause before dispatch releases the hold, and a released batch can't be sent.
- An unknown outcome settles at the worst case, the tiles become `unknown_outcome`, and both credits come back.
- Single designs settle on success, and on an unknown failure.
- An overage is recorded, `gen.vercel` goes off, `generate` answers `GENERATION_OFF`, and the card shows it. After an admin turns the flag back on, generation works again.
- A second close does nothing.

**Credits**
- A grid charges 2. Refunds are 0, 1, 2, and 2 for 0, 1, 3, and 4 missing designs.
- A single design charges 1 per design and refunds each failure.
- A credit refusal still comes before a budget refusal.

**Sweeper**
- The 9-minute, 11-minute, and 16-minute marks release, settle, and refund as described above, and a late finish is ignored.
- An abandoned single design is refunded, and a pending first photo is marked failed.

**Model photos**
- A photo is held at publish and settled when recorded.
- A publish over budget still publishes, without a photo.
- A refused reshoot leaves the shoot unchanged; admin reshoots have no member.

**Admin**
- The card's numbers, members can't read them, and members search shows `spentTodayCents`.

`tests/unit/pricing.test.ts` has 10 tests covering:
- the worst cases against the measured costs
- the Topaz price
- `qualityOf`
- `gatewayCostCents`: string, number, and JSON forms, plus junk
- `callFailure` classification
- `dayUtc`

**Fix found by the tests:** two photo calls for one shoot in the same millisecond got the same attempt id. Photo attempt ids now add a suffix when needed.

## Files

- **New:**
  - `convex/lib/pricing.ts`
  - `convex/lib/paidAttempts.ts`
  - `convex/lib/budget.ts`
  - `convex/budget.ts`
  - `convex/schema/budget.ts`
  - `src/components/admin/BudgetCard.tsx`
  - `tests/convex-local/budget.test.ts`
  - `tests/unit/pricing.test.ts`
- **Changed:**
  - `convex/schema.ts`: `...budgetTables,` after `...launchTables,`
  - `convex/studio.ts`
  - `convex/imageGen.ts`
  - `convex/publish.ts`
  - `convex/crons.ts`
  - `convex/admin.ts`
  - `convex/_generated/api.d.ts`: hand-edited for `budget`, `lib/budget`, `lib/paidAttempts`, `lib/pricing`, `schema/budget`
  - `src/routes/admin.index.tsx`
  - `src/routes/admin.members.tsx`
  - `src/routes/studio.tsx`
  - `docs/environment-variables.md`
- No route was added, so `src/routeTree.gen.ts` is unchanged after `bun run build`.

## Decisions

- **One hold per paid call:** one per grid batch, one per single design, one per photo.
- **The worst case grows with each attached image,** so a words-only batch doesn't hold room for 12 images.
- **The cap is read live** from `appSettings.dailyBudgetCents` at every admission. `budgetDays.capCents` only records the cap in force.
- **The gateway and fal are separate pools,** each up to the same `dailyBudgetCents`. Both are wired in (fal since the print builder's Round 2).
- **Actual cost is stored in fractions of a cent** (`9.9`). Holds are whole cents.
- **The grid's roles read** (GPT-6 Luna, 0.03–0.09¢) is inside the grid's hold. If the grid is then released before the call, that fraction of a cent isn't recorded.
- **Stuck designs now get their credits back.** Before, a batch whose action died stayed `dispatched` forever with nothing back. The sweeper now finishes it and refunds by the same `creditsBack` rule. No refund amount changed.
- **No tile status was added.** `unknown_outcome` and `expired` were already in `tileStatus`; they're now used for the first time. The studio already shows both as failed.
- **No new env vars.** `GRID_QUALITY`, `IMAGE_QUALITY`, `PHOTO_QUALITY`, and `IMAGE_PROVIDER` now also set reservations, and `docs/environment-variables.md` says so.

## Stubbed or waiting on keys and accounts

- **Reported costs:** whether `providerMetadata.gateway.cost` arrives on real calls is unverified. Until it does, every call settles at its worst case, which is safe but overstates spend 1.5–3×. Watch the card's "reported / worst case" line after the first real calls.
- **fal reports no cost.** An upscale settles at `topazCents(w, h)` of the image fal returned, which is what fal bills by, recorded as `reported`. If fal's bill ever differs, compare it with the card's fal day.
- **ChatGPT path:** unbudgeted by design (subscription, not per call).

## What the Builder must do when merging

1. **Schema:** two new tables, `reservations` and `budgetDays`, in `convex/schema/budget.ts`, with `...budgetTables,` after `...launchTables,`. No existing table changed. If another branch also adds a line after `...launchTables,`, keep both.
2. **`convex/_generated/api.d.ts`:** keep the five new module entries when resolving conflicts.
3. **`studio.generate`** can now return `{ refused: "BUDGET" }`. Any other client calling it should handle that; the studio already does.
4. **New optional arguments** (all `v.optional`, so callers on other branches still work):
   - `spend` on `finishBatch`, `markSucceeded`, `markFailed`, `recordPhoto`, and `recordPhotoFailed`
   - `unknown` on `finishBatch` and `markFailed`
   - `attemptId` on `recordPhoto` and `recordPhotoFailed`
   - Without `spend`, a reservation settles at its worst case. Branches that add new paid calls should pass `spend` (use `paidCall` in `imageGen.ts`).
5. **`publish.markPublished`** returns `attemptId?` and `resting?`, and `beginReshoot` returns `attemptId?`. Any other caller of these mutations should pass the `attemptId` back to `recordPhoto` or `recordPhotoFailed`.
6. **Exports other code may now import:** `settleBatch` and `failAndRefund` are exported from `convex/studio.ts`, and `failShootPhoto` from `convex/publish.ts` (used by the sweeper).
7. **Cron:** "sweep paid calls" every 10 minutes. It goes live with the next deploy. There's nothing to set.
8. **Print and upscale builder (done in Round 2, `codex/print`):**
   - `print.upscale` opens the hold itself (`openReservation`, same transaction as the 2-credit charge), so it doesn't go through `internal.budget.reserve`. It returns `{ refused: "BUDGET" }` when fal's day can't hold the worst case, before charging anything.
   - `print.claimSubmission` marks it sent (`authorizeDispatch`). A closed hold fails the version and refunds instead of posting.
   - `recordVersion` settles at the price of the returned size, so an output over 4× is an overage and turns `gen.upscale` off. `failVersion` takes an optional `spend`: release when nothing reached fal or fal answered 4xx, otherwise settle at the worst case.
   - The sweeper's `finishAbandoned` now fails and refunds abandoned upscales through `failPrintVersion` from `convex/print.ts`.
   - Details: `docs/hackathon/reports/print.md`, "Round 2".
9. **After the first production calls:**
   - Check the card's reported count. If calls settle at the worst case with reason `no cost reported`, look at the raw `providerMetadata.gateway` and adjust `gatewayCostCents`.
   - If reported costs show the bounds are far too loose, tighten the token bounds in `pricing.ts` and bump `PRICING_VERSION`.
10. **Follow-ups:**
    - A separate cap for fal (an optional `dailyUpscaleBudgetCents` setting).
    - A short "Turn back on" button on the card when an overage switched a provider off. Today that's done from Switches.
