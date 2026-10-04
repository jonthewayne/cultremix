# Publish builder report

Branch `codex/publish`, from `08b5d1b` (dev after the launch, social and lineage merges).

Commits:
- `4458aea`: backend for offered colors, description, the publishing flag and the early-access list;
- `063b9ea`: the publish dialog;
- `5af27fd`: the shop page;
- `94319c1`: client-boundary test follow-up;
- `0220f70`: the admin Waitlist tab;
- `b824600`: contrast rule and layout fixes;
- `155d4ec`: phone fix on the admin list;
- this report.

Nothing was deployed, run against a deployment, or pushed.

## What was built

| Requirement | Files |
| --- | --- |
| **1. Publish flow** | `src/components/publish/PublishDialog.tsx` (new; the dialog moved out of `studio.tsx`), `src/lib/designPixels.ts`, `convex/lib/garments.ts`, `convex/publish.ts` (`quick`, `preview`) |
| **2. Shop page** | `src/components/cr/ColorSwatches.tsx`, `src/routes/cr.$cr.tsx` (color and description areas only), `convex/feed.ts` (`byCr` returns `description` and `colors`) |
| **3. Early-access list (A6)** | `convex/schema/publish.ts`, `convex/waitlist.ts`, `convex/lib/earlyAccess.ts`, two limits in `convex/lib/authRateLimit.ts`, `src/components/cr/EarlyAccess.tsx`, `src/routes/admin.waitlist.tsx`, one tab in `src/routes/admin.tsx` |
| **4. Publishing flag** | `convex/lib/flagState.ts`, `convex/publish.ts` (`availability` and the refusal in `quick`), `src/routes/studio.tsx` (entry points) |
| **5. Tests** | `tests/convex-local/publish.test.ts`, `tests/convex-local/waitlist.test.ts`, `tests/unit/garments.test.ts` |

Other edits:
- `convex/schema.ts` spreads `...publishTables`.
- `convex/schema/cultremix.ts` adds two optional `works` fields.
- `convex/_generated/api.d.ts` was edited by hand: `waitlist`, `lib/garments`, `lib/earlyAccess`, `lib/flagState`, `schema/publish`.
- `src/routeTree.gen.ts` was regenerated.
- `tests/unit/clientBoundary.test.ts` allows `convex/lib/garments.ts` and `convex/lib/earlyAccess.ts` in the browser. Both are pure, with no server imports.

### 1. Publish dialog

One dialog: a full-screen sheet on phones, a two-pane card on desktop. Nothing is required except the Publish button.

- **Large preview.** The design on the focused color, with the color name. Tapping a swatch focuses it.
- **CR number preview.** From `publish.preview`:
  - a variation remix shows the family's next number: "The next number in family 101.";
  - an original or a fork shows the next family: "A new family starts here.";
  - both add "The number is set when you publish.", since another publish can take it first.
  - Switching between variation and fork updates the number live.
- **Lineage line** for remixes, e.g. "A remix of CR 101-001 “Tide” by @alice."
- **Title**, optional, up to 80 characters.
- **"A few words"**, optional, up to 280 characters with a counter. It is shown on the shop page.
- **Swatch board.** All 12 shirt colors (`GARMENT_COLORS` in `convex/lib/garments.ts`), each a mini preview of the design on that color.
  - Four are picked by default: the closest shade to the design's background, then the defaults, skipping any the contrast check says the design disappears on.
  - The first pick is the **lead**, with a "Lead" badge and "Lead with X" to change it. The copy explains: "the shop page opens on it and the model photo is shot on it." The lead is saved as `works.backgroundColor`, so the feed, model photo and remixes keep working unchanged.
  - At least one color is required ("Pick at least one color.").
- **Advisory contrast check.** In the browser, `useDesignPixels` downsamples the design to 64×64, and `blendShare` measures how much of the visible ink blends into each shirt color.
  - A pixel blends if its Lab ΔE is under 14, or under 30 with a WCAG contrast below 1.5. The second rule catches dark ink on navy.
  - A blend share of 0.6 or more gives a red "!" and "The design gets lost on True navy. You can still offer it."
  - A share of 0.3 or more gives an amber "!" and "It looks faint on …".
  - Nothing is blocked.
- **Variation or fork.** The existing `RemixKindChoice`, unchanged, shown for remixes.
- **Reveal screen** after publishing: black, "Published", the CR number, title, and the design on the lead color, with "View shop page" and "Keep creating".

`publish.quick` takes `description` and `offeredColors` as optional args.
- It validates colors against the shirt's list, dedupes them and keeps the lead first.
- An empty list or an unknown key is refused with `INVALID_COLORS`.
- With no colors sent, it uses the design's own shade plus the defaults, as older clients do.

### 2. Shop page

- `feed.byCr` now also returns `description` and `colors` (`{key, name, hex}`, lead first). Works published before this branch get one color: their background, named.
- **Swatches.** Round swatches (a radiogroup, 44 px touch targets) replace the old single color line. The art square's background switches to the picked color with a short transition.
- **Description and title.** The description shows under the title, keeping its line breaks. The title was already there.
- **Edits stay local:** the color block, the description paragraph, and one `<EarlyAccess>` line right after the disabled "Buying opens soon" button. I didn't otherwise touch the buy area.

### 3. Early-access list

- **Tables** in `convex/schema/publish.ts`:
  - `waitlist`: `emailLower`, `kind` (`"buy"`; `"creator"` reserved for a site-wide list), `workId`, optional `userId`, `createdAt`;
  - `waitlistTotals`: a running count per work, so admin never scans the list.
- **`waitlist.join({workId, email?})`.**
  - **Validation.** The email is trimmed, lowercased, checked for shape and capped at 254 characters. The work must be published. Joining is refused once `commerce.checkout` is on.
  - **Dedupe.** One row per (email, kind, work). A repeat join returns `{ok: true}` and adds nothing.
  - **Rate limits.**
    - `waitlist:join`: 8 tries per 15 minutes per email, and the same per signed-in member.
    - `waitlist:visitor_work`: 60 signed-out joins per 15 minutes per work.
  - **One tap for members.** With no email sent, it uses the account's email.
- **`waitlist.status({workId})`** (public, works signed out) returns only `open`, `signedIn`, `hasEmail` and `joined`. It never returns an email.
- **Shop UI** (`EarlyAccess`), shown only while checkout is off:
  - members with an email get one button: "Tell me when it’s ready";
  - everyone else gets an email field and "Join";
  - under both: "One note when buying opens. Nothing else.";
  - after joining: "You’re on the list. We’ll let you know when this one can be bought."
- **Admin `/admin/waitlist`** (a "Waitlist" tab in `admin.tsx`):
  - "Early access" shows total sign-ups and says "No one has been emailed yet.";
  - "By design" lists CR links with counts, most wanted first, top 100;
  - **Export emails** downloads a CSV (`email, cr, title, member, joined_at`), paged 500 at a time through `waitlist.adminExportPage`;
  - cells are quoted, and a leading `= + - @` is defused so spreadsheets don't run it as a formula.
- **No emails are sent anywhere.**

### 4. Publishing flag

- `convex/lib/flagState.ts` `isFlagOn` reads the `featureFlags` row, or the flag's default from `convex/lib/flags.ts` when there's no row. `publishing` defaults on and `commerce.checkout` defaults off. Both are already toggleable in admin.
- **When it's off:**
  - `publish.availability` returns `{publishing: false}`;
  - the studio hides Publish on tiles and in the viewer;
  - an open dialog shows "Publishing is paused for now. Your designs are safe here; try again soon." and disables the button;
  - `publish.quick` refuses with that message (`PUBLISHING_OFF`).
- **In-flight publishes finish.** The flag check comes after the `requestId` lookup, so a retry of a publish that already landed still returns its CR. Art and model-photo work scheduled by an earlier publish isn't gated.

## Tests

All results are from the final tree:

| Command | Result |
| --- | --- |
| `bun run typecheck` | passes |
| `bunx tsc --noEmit -p convex` | passes |
| `bun run test`, unit | 31 files, 214 tests passed |
| `bun run test`, convex-local | 9 files, 77 tests passed |
| `bun run build` | passes |

New tests:

- **`tests/convex-local/publish.test.ts`, 9 tests:**
  - saves the chosen colors (lead first), the description, and the lead as the background;
  - refuses colors the shirt doesn't come in, and an empty list;
  - defaults when no colors are sent;
  - caps descriptions;
  - the publishing flag refuses new publishes while off but still answers a publish already made;
  - the flag is on when unset;
  - the preview shows the family and variation numbers and the lineage line;
  - signed out, `feed.byCr` returns exactly the public keys, with description and colors;
  - older works show one color.
- **`tests/convex-local/waitlist.test.ts`, 7 tests:**
  - dedupe, ignoring case and spaces;
  - email and work validation;
  - the per-email rate limit;
  - a member's one-tap join with the account email;
  - `status` works signed out and never returns an email;
  - joining closes once checkout is on;
  - admin counts are visible to support, while export is limited to ops and the owner (support is refused).
- **`tests/unit/garments.test.ts`, 5 tests:**
  - offered-color validation;
  - unique keys and valid hex;
  - the default picks;
  - the contrast check (black ink disappears on black and on navy, and is clear on light colors; red is clear on mint);
  - email normalization.

**Visual check.** I mounted the real `PublishDialog`, the `cr.$cr.tsx` page and `admin.waitlist.tsx` in a throwaway Vite page with mocked Convex data. I drove them with agent-browser at 1280 px and 390 px. The page has been deleted and isn't committed.
- **Checked:** default picks skip black and navy, warnings appear, the lead changes, fork changes the number, the mutation args are right, the reveal screen, the paused state, swatches switch the art color on the shop page, visitor and member joins send the right args, the list hides when checkout is open, and the CSV export downloads and defuses formulas.
- **Fixed on the way:** the dialog layout on desktop, the reveal CR number wrapping on phones, and long titles on the admin list.
- **Not changed:** the shop page's existing big CR heading (`text-[20vw]`) still wraps at 390 px ("CR 101–" / "002"). The lineage report noted the same; it's outside my area.
- **Limit:** nothing was tried against live Convex, because these functions aren't deployed anywhere and I don't run `convex dev`.

## Decisions

- **Lead color = `backgroundColor`.** It keeps the feed, model photo, remixes and older code correct without new reads.
- **Own flag reader.** `studio.ts`'s `flagEnabled` treats a missing row as on, which would open checkout by default. `isFlagOn` honors each flag's default. **The buy-box builder should use `isFlagOn(ctx, "commerce.checkout")`** so both sides agree on when the list closes.
- **The contrast check is advisory and runs in the browser.** It needs the design's pixels, which the browser already has. The server only validates the color keys.
- **CR preview is a preview.** The number is assigned in `quick` at publish, as before. The copy says so.
- **Visitor limit per work, not per IP.** Convex mutations don't see the caller's IP. The cost is that a flood on one design can briefly block honest visitors there. Members are limited per account instead.
- **Admin totals show the top 100.** The total card sums those rows and says so once there are 100 or more designs.
- **Export is manage-level.** Support sees counts only.
- **Colors live in `convex/lib/garments.ts`**, separate from `colors.ts`, so the shirt's list has one home. The shop page no longer imports `colors.ts`, so the boundary test's "follows imports" check now uses `garments.ts`.

## Stubbed or waiting

- **No emails are sent.** Opening checkout should email the list (KTD-O). That's for whoever turns on commerce, using `waitlist` rows by work.
- **The site-wide (`"creator"`) list.** The kind is in the schema with no UI.
- **Offered colors aren't sent to a print provider.** Shopify and Printful variants are the commerce builder's job and should read `works.offeredColors`. Older works have none and offer `backgroundColor`, as `feed.shopColors` does.
- **No keys or env vars needed.**

## What the Builder must do when merging

1. **Schema (additive only).**
   - New tables `waitlist` and `waitlistTotals` from `convex/schema/publish.ts`, spread in `convex/schema.ts`.
   - New optional `works` fields `description` and `offeredColors`.
   - Existing rows stay valid, and no backfill is needed.
   - Needs a Convex deploy and a Worker deploy.
2. **`convex/_generated/api.d.ts`** was edited by hand. On conflict, keep both sides' entries.
3. **`src/routeTree.gen.ts`.** Rerun `bun run build` after merging and commit it, so `/admin/waitlist` sits alongside other branches' routes.
4. **`src/routes/studio.tsx`.**
   - The publish dialog moved to `src/components/publish/PublishDialog.tsx`, which keeps the lineage builder's `RemixKindChoice` and `remixKind` argument.
   - Studio keeps one `canPublish` query and passes `onPublish` only when it's true.
   - If another branch changed the old inline dialog, carry that change into `PublishDialog.tsx`.
5. **`src/routes/cr.$cr.tsx` and the buy box.**
   - My edits are the `picked` state, the art square's background, the description paragraph, the color block, and `<EarlyAccess workId={item.workId} />` right after the "Buying opens soon" button.
   - `EarlyAccess` hides itself once `commerce.checkout` is on, so the buy box can replace the disabled button in place.
   - The buy box should read the picked color, `color.key`, for the variant. It's in page state now; lift it into the buy box's props if needed.
6. **`convex/lib/authRateLimit.ts`** has two new entries (`waitlist:join`, `waitlist:visitor_work`). On conflict, keep both sides' entries.
7. **Flags.** `publishing` and `commerce.checkout` were already in `FEATURE_FLAGS`; no rows need to be created.
8. **Environment variables.** None added.
9. **Follow-ups.**
   - The commerce builder: email the list when checkout opens, and map offered colors to product variants.
   - Fix the shop page's big CR heading wrapping on phones (`whitespace-nowrap` with a smaller vw size).
