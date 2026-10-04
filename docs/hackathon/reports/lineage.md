# Lineage builder report

Branch `codex/lineage`. Commits: `54eb3b7` (lineage core, publishing, amendments, config route), `e068202` (Convex tests), `cf5f297` (work page, publish choice, admin page), `226eb9d` (phone fix), and this report. Nothing was deployed, run against a deployment, or pushed.

Scope: V1 unit U11 (variations, forks, amendments), the Economics panel and `/economics/v1.json` from U10, and the "economic stake" item in the judging evidence plan.

## What was built

| Plan item | Files |
| --- | --- |
| **1. Variation or fork at publish** | `convex/publish.ts` (`quick` takes an optional `remixKind`), `src/components/cr/RemixKindChoice.tsx`, `src/routes/studio.tsx` (dialog only: one state, one argument, one component) |
| **2. Pure lineage library** | `convex/lib/lineage.ts` |
| **3. Work page lineage** | `src/components/cr/LineageTrail.tsx` (`LineageNote`, `LineageSection`), `DirectRemixes.tsx`, `FamilyView.tsx`, `WorkCard.tsx`, queries in `convex/lineage.ts`, page wiring in `src/routes/cr.$cr.tsx` |
| **4. Economics panel and config route** | `src/components/cr/EconomicsPanel.tsx`, `convex/workEconomics.ts`, `convex/lib/economicsConfigs.ts`, `src/lib/economicsRoute.ts`, `src/routes/economics.$file.tsx` |
| **5. Amendments (offchain half)** | `convex/schema/lineage.ts` (`lineageAmendments`), new optional fields on `works` in `convex/schema/cultremix.ts`, mutations and queries in `convex/lineage.ts`, `src/routes/admin_.lineage.tsx` (served at `/admin/lineage`), a link on `src/routes/admin.tsx` |
| **6. Tests** | `tests/unit/lineage.test.ts`, `tests/unit/economicsRoute.test.ts`, `tests/convex-local/lineage.test.ts` |

Housekeeping:
- `convex/schema.ts` spreads `...lineageTables` after `...cultremixTables`.
- `convex/_generated/api.d.ts` was edited by hand. It now lists `lineage`, `workEconomics`, `lib/lineage`, `lib/economicsConfigs`, `schema/lineage`, and `lib/economics`, which had been missing.
- `src/routeTree.gen.ts` was regenerated.
- `tests/unit/clientBoundary.test.ts` now allows `convex/lib/economics.ts` and `convex/lib/economicsConfigs.ts` in the browser. They're the public config and its share math.

### 1. Publishing a remix as a variation or a fork

- **The choice.** For a member's own remix tile, the publish dialog shows two cards under "How it relates":
  - "A variation of CR 102-001: It joins family 102 as its next number." This is the default.
  - "This changed the design itself: start a new family: It gets a new family number, and its page says Forked from CR 102-001."
- **Where it shows.** `lineage.publishOptions` returns the choice only to the generation's owner, and only for a remix session. A design that isn't a remix shows nothing.
- **Numbering.** A variation takes the next expression in the parent's family. A fork gets the next family number with expression 1, a new `crFamilies` row, `familyRootId` set to itself, and `parentWorkId` set to the parent.
- **Its page.** A fork's page reads "Forked from CR 101-002 · started family 102".
- **Parent check.** `quick` now refuses with "The design you remixed isn't published anymore." (`PARENT_UNAVAILABLE`) when the parent is missing, or is neither published nor withdrawn. Before, an unpublished parent silently produced a new family.

### 2. `convex/lib/lineage.ts` (pure; no Convex imports)

- **Effective lineage.** `effectiveOf(work)` returns `effectiveKind ?? kind` and `effectiveParentWorkId ?? parentWorkId`.
- **Ancestor walk.** `effectiveAncestors(work, load, max)` walks effective parents, nearest first, to the family root and across forks to the origin. Each step records how it was reached (`variation` or `fork`).
  - It stops at `max`, which is 64 for the trail, and reports `truncated`.
  - A loop or a missing ancestor throws `LineageError("cycle" | "missing")`.
- **EconomicLineage.** `economicLineage(work, load, loadFamilyRoot)` builds the work's EconomicLineage for `recipientShares` in `convex/lib/economics.ts`:
  - original: creator only;
  - variation: family root plus creator;
  - fork: upstream (its parent) plus creator;
  - variation in a fork family: upstream (the family root's parent) plus family root plus creator.
  - Upstream credit travels one fork generation (KD9).
- **Placement.** `publishPlacement(parent, mode)` decides kind and family at publish.
- **Amendment validation.** `validateAmendment(work, {newKind, newParentId}, load)` mirrors the registry's rules and refuses with these codes:
  - `not_registered`: the work isn't published or withdrawn;
  - `no_change`;
  - `kind_change`: variation ↔ original/fork; only original ↔ fork may change kind;
  - `original_with_parent`;
  - `missing_parent`;
  - `parent_not_registered`;
  - `self_parent`;
  - `fork_same_family`;
  - `variation_other_family`;
  - `cycle`;
  - `too_deep`: walking up from the new parent takes more than `MAX_AMENDMENT_HOPS = 64` hops. The new parent counts as hop 1.
- **Messages.** `refusalMessage(code)` gives the plain message shown to admins.

### 3. Work page

Sections, in order, each its own component:

- **Under the title, `LineageNote`.**
  - Shows "A variation of CR X", "Forked from CR X · started family N", or "An original. It started family N."
  - Shows a "Correction pending" badge (amber) or a "Lineage amended" badge.
- **Right column, `EconomicsPanel`.** It sits above the Fingerprint block (details under item 4).
- **`LineageSection`, "Lineage".**
  - The trail runs from the origin to "this one", grouped into family boxes with a "forked" marker between families.
  - Each ancestor is a CR lockup linking to its page, with an @username link.
  - It's a column on phones and a row on desktop.
  - It notes a cut-off trail ("Earlier works are further back than this shows.") and damaged stored lineage ("Part of this lineage can’t be shown right now.").
  - If the work was amended, a history box follows:
    - date, from → to, and the public reason;
    - "Not yet recorded on Monad." for offchain-only rows;
    - "The original record stays as published. Sales before a change keep their split."
  - Pending corrections are listed as "Pending". Rejected and cancelled ones never appear publicly.
- **`DirectRemixes`, "Remixes of this".** Published works whose effective parent is this work, oldest first, 8 at a time with "Show more". It uses `usePaginatedQuery` on the new index `works.by_effectiveParent_status`.
- **`FamilyView`, "Family N · X designs".** A small grid of up to 48 works in the family, with this one ringed. It's hidden when the family has only one work. It's cheap: one indexed read on `by_family_expression`.

All queries are public: they work signed out and return only CR, title, username, family, kind, color, and art URL. An unpublished or unknown CR returns null.

### 4. Economics panel and `/economics/v1.json`

- **The panel, "Who shares in a sale".** It reads `workEconomics.panel` and shows:
  - an explanation: "15% of every sale, before tax and shipping, goes to the people behind the design.", plus one sentence for the kind;
  - one row per person: @username link, role in words ("made this", "started the family", "made the design it forked from"), and percentage;
  - one row, with roles joined, when a person holds two roles;
  - "Rules version 1 · economics/v1.json" as a link, and the config's full SHA-256;
  - "These shares will be recorded on Monad." The query already returns `provenance: "pending" | "confirmed"`, and "confirmed" switches the text to "These shares are recorded on Monad."
- **The route.** `GET /economics/v1.json` serves exactly the bytes of `canonicalConfigJson(V1)`.
  - Headers: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`.
  - Any other file (`v2.json`, `v01.json`, `constructor.json`, `../v1.json`) is a 404.
  - The panel's hash is computed from the same function, so anyone can fetch the file, hash it, and recompute the split (INV-29).

### 5. Amendments

- **Table `lineageAmendments`.**
  - Fields: `workId`, `sequence` (per work), `chainSequence` (the next onchain amendment number), `fromKind`/`fromParentId`, `newKind`/`newParentId`, `reason` (public, ≤280 characters), `adminId`, `status`, `requestedAt`, `submittedAt`, `decidedAt`, `effectiveFrom`, `rejectReason`, `offchainOnly`, `chainWriteId`.
  - Status moves through `requested → submitted → confirmed | rejected`.
  - Indexes: `by_work_sequence` and `by_status`.
  - Rows are append-only. The work's original `kind` and `parentWorkId` never change.
- **New optional fields on `works`:** `effectiveParentWorkId`, `effectiveKind`, `lineageAmendedAt`, and index `by_effectiveParent_status`.
- **Admin mutations** (owner or ops admins only):
  - `requestAmendment`:
    - validates against the work's current effective lineage;
    - refuses a second open correction on the same work;
    - takes the new parent as a CR number.
  - `confirmOffchain`:
    - only works while the `chain.writes` flag is off;
    - refuses if the work's lineage changed since the request (`STALE`);
    - re-validates before applying;
    - marks the row `offchainOnly`. The UI labels it "Confirm offchain only (not recorded on Monad)".
  - `cancelAmendment`: moves a requested row to rejected with reason "cancelled".
- **Admin queries:** `adminWork` (original and effective lineage, which kinds are allowed, whether a correction is open) and `adminHistory` (latest 50, plus whether chain writes are on).
- **Internal mutations for the chain builder:**
  - `requestedForChain({limit})`: rows waiting to be sent;
  - `markSubmitted({amendmentId, chainWriteId})`: idempotent;
  - `markConfirmed({amendmentId, confirmedAt?})`: requires `submitted`; sets `effectiveParentWorkId`/`effectiveKind`/`lineageAmendedAt`;
  - `markRejected({amendmentId, reason})`;
  - `backfillEffectiveParents({cursor?})`.
- **Confirming.** Descendants are never reparented, and their own effective lineage is unchanged. Direct-remix lists and walks follow the new effective parent from then on.
- **Admin page `/admin/lineage`.**
  - Look up by CR, see the published and current lineage, and request a correction: kind from the allowed list, new parent CR, reason "shown on the work page".
  - History rows show status and Confirm/Cancel buttons.
  - Built with shadcn tokens through AppShell and Card.
  - The route file is `admin_.lineage.tsx`, so it isn't nested under `admin.tsx`, which has no `<Outlet/>`. The URL is still `/admin/lineage`.

## Tests

All results below are from the final tree.

| Command | Result |
| --- | --- |
| `bun run typecheck` | passes; Convex typecheck skipped because `CONVEX_DEPLOYMENT` is unset, as usual in worktrees |
| `bun run test`, unit | 26 files, 187 tests passed |
| `bun run test`, convex-local | 2 files, 15 tests passed |
| `bun run build` | passes |

New tests:

- **`tests/unit/lineage.test.ts`, 39 tests:**
  - walks to the root and across forks;
  - an amended parent is followed, and a work amended to original stops there;
  - cycle and missing ancestor throw;
  - the 64-step bound: a chain of 70 gives 64 steps, truncated; a chain of 65 isn't truncated;
  - placement for original, variation, and fork;
  - every validation refusal code, a cycle refusal, and an unregistered parent;
  - the hop bound: 64 hops accepted, 65 refused as `too_deep`;
  - EconomicLineage for original, variation, fork, variation in a fork family, and a fork of a variation (the variation is the parent and its creator is upstream);
  - shares sum to 10,000 bps (100%) for every kind;
  - one person in two roles.
- **`tests/unit/economicsRoute.test.ts`, 12 tests:**
  - exact bytes;
  - the three headers;
  - the panel hash matches `node:crypto`'s SHA-256 of the served bytes;
  - 404s for unknown, malformed, prototype, and traversal names.
- **`tests/convex-local/lineage.test.ts`, 14 tests.** It runs on the in-memory Convex harness:
  - publish numbering: 101-001 → variation 101-002 → fork 102-001 → 101-003 → 102-002;
  - a parent that's gone is refused;
  - `publishOptions` answers only the owner's remix tile;
  - trail across a fork, direct remixes, family, and panel shares (50/30/20 for a variation in a fork family);
  - null for unpublished works;
  - amendments:
    - non-admins refused, and validation messages;
    - requested → confirmed offchain; the effective parent changes and descendants stay put; direct remixes follow;
    - fork → original;
    - with chain writes on, offchain confirmation is refused and requested → submitted (idempotent) → confirmed works;
    - `chainSequence` counts only onchain rows; a rejected row stays off the public page and doesn't use a sequence number;
    - a stale confirmation is refused, and cancel works;
    - `adminWork` returns the expected fields;
  - the backfill fills old remixes once.
- **`tests/unit/clientBoundary.test.ts`:** still passes with the two new browser-safe files.

**Visual check.** I server-rendered the real `cr.$cr.tsx` page and the publish choice with fixture data and the built CSS, then took screenshots with agent-browser at 1280 px and 390 px. A temporary render script was used and deleted; it isn't committed. Both widths read well.
- The phone check caught small family cards wrapping their CR numbers. Fixed in `226eb9d`: three columns on phones, and the number stays on one line.
- The page's existing large CR heading wraps at 390 px ("CR 102–" / "002"). That's existing styling (`text-[20vw]`), unchanged here.
- Limit: the work page wasn't tried against live Convex data, because the new functions aren't deployed anywhere and I don't run `convex dev`. The admin page was type-checked and built but not rendered.

## Decisions

- **Effective parent on every new work.** `effectiveParentWorkId` is set at publish for every remix, so the direct-remix index has one field to read. Older works need the backfill (see merge steps). Until it runs, old remixes are missing from "Remixes of this", but trails, panels, and validation are already correct because they fall back to `parentWorkId`.
- **One open correction per work.** This keeps sequences and staleness simple.
- **`chainSequence` counts only confirmed onchain amendments.** Offchain-only confirmations aren't on Monad, so they don't use a number. When chain writes turn on, the chain builder has to decide how to replay or re-request offchain-only corrections (follow-up).
- **Chain results apply as they come.** `markConfirmed` applies what the chain returned without re-validating. `confirmOffchain` re-validates and checks staleness, because nothing else checked it.
- **Withdrawn works count as registered.** They can be parents and can be amended, matching "registered" in the contract.
- **Panel query file.** It lives in `convex/workEconomics.ts`, not `convex/economics.ts`, because U10 owns that file.
- **Provenance is always "pending".** No works field records onchain confirmation yet.
- **Lineage admin is checked directly.** The check is against `platformRole` (`super_admin_owner` or `super_admin_ops`), because `convex/lib/authz.ts` has no lineage capability. Support admins see the general admin page but not lineage corrections.
- **Light palette on the work page.** The work page hard-codes `bg-white text-black` even in dark mode, so its new sections use the same white, black, and neutral classes. The admin page uses shadcn tokens.
- **Username links are plain `/u/<username>` anchors.** The social builder owns that route; until it lands they 404.
- **`convex/lib/economics.ts` was not changed.** I found nothing in it that looks wrong.

## Stubbed or left for others

- **Onchain amendments.** Sending `requested` rows to the registry and calling `markSubmitted`, `markConfirmed`, and `markRejected` is for the chain builder. The internal mutations and `requestedForChain` are ready.
- **Provenance "confirmed".** The panel switches its text when `provenance` is `"confirmed"`. The chain builder needs a works field (or a lookup) and one line in `convex/workEconomics.ts`.
- **Onchain config hash.** `EconomicConfigRegistered` should register the SHA-256 the panel shows, the hash of `canonicalConfigJson(V1)`.
- **Order lineage snapshots.** "Orders before and after an amendment keep their own lineage snapshot" belongs to U10. It should snapshot `economicLineage(...)` at order time. Amendments record `effectiveFrom` for that.
- **Not in this branch.** The remix route `cr.$crNumber.remix.tsx`, the remix edit prompt, and remix admission by provider policy (U11's other half). They were outside this assignment.

## What the Builder must do when merging

1. **Schema (additive only).**
   - New table `lineageAmendments` from `convex/schema/lineage.ts`.
   - New optional `works` fields `effectiveParentWorkId`, `effectiveKind`, `lineageAmendedAt`, and index `by_effectiveParent_status`.
   - Existing rows stay valid.
   - Needs a Convex deploy (schema plus functions) and a Worker deploy.
2. **Backfill after the deploy.** Run `lineage:backfillEffectiveParents` repeatedly, passing back the returned `cursor` until it's `null`. Each run handles 200 works. A second full pass updates nothing.
3. **`convex/_generated/api.d.ts`** was edited by hand. If the merge conflicts, keep both sides' entries. Regenerating on the next `convex dev` or `convex deploy` gives the same result.
4. **`src/routeTree.gen.ts`.** Rerun `bun run build` after merging, so routes from other branches are included with `/economics/$file` and `/admin_/lineage`, and commit the result.
5. **`src/routes/studio.tsx`.** My change is limited to `PublishDialog`: one import pair, one `useState`, `remixKind` in the `publish(...)` call, and `<RemixKindChoice …/>` under the shirt sentence. Resolve any conflict by keeping those four lines.
6. **`src/routes/cr.$cr.tsx`.**
   - The old "Remix of" line and the "Remixes" grid were replaced by the new components.
   - `feed.byCr` still returns `remixes`, an unbounded `.collect()` the page no longer uses. Remove it from `convex/feed.ts` when convenient. I didn't touch `feed.ts`.
7. **Environment variables.** None added.
8. **Feature flag.** `chain.writes` is read from `featureFlags`. With no row, or `enabled: false`, admins confirm offchain only.
9. **Follow-ups.**
   - Chain builder: wire the amendment queue, provenance "confirmed", and the config hash.
   - Check that `MAX_AMENDMENT_HOPS` counting (the new parent is hop 1; more than 64 refused) matches the contract.
   - Decide what happens to offchain-only corrections once chain writes turn on.
   - Social builder: `/u/$username`.

## Round 2: the family tree

Every family can now be seen as a tree. The original sits at the top, and each variation sits under the work it came from. Forks branch off to their own families, and the family a fork came from is drawn above its first work.

### What was built

**`/family/<n>`** (`src/routes/family.$family.tsx`)
- The whole tree for one family, with a two-line key: a solid line is a variation and a dashed line is a fork.
- The header shows how many designs there are, who started the family, and the CR number it was forked from, if any.
- `?cr=<CR>` highlights a work and opens its branch.
- "Show more of this family" loads 60 more works at a time, up to 240. Past that, a note says only the first 240 are drawn.
- Signed-out visitors can see it. The server loader fetches the first page ahead.

**Compact tree on the work page**
- It replaces the grid in `FamilyView`, the family section the page already had. `cr.$cr.tsx` is unchanged.
- It is hidden for a lone original with no remixes.
- "See the whole tree →" opens `/family/<n>?cr=<this work>`. The work page and that page ask for the same data (same query and arguments), so it is already loaded when you get there.

**What each node shows**
- The design's thumbnail, its CR number in `font-cr`, and `@creator`.
- Two small counts of how far it spread: **remixes** (published direct remixes, in any family) and **hearts**.
- Hearts come from the social builder's `workSocialStats`, through `workHeartCount` in `convex/lib/social.ts`. It is one indexed read that the social code keeps up to date when hearts change, so there was no need for a TODO.
- The current work gets the same black ring as elsewhere.
- Fork nodes say "New family N →" and link to that family's tree.
- The node above a forked family says "From family M" and links back to that family.
- A withdrawn work stays in place as a dashed "Withdrawn" box with its CR number only, so its remixes don't lose their place.

**Big families on a phone**
- Wide or deep branches fold into a dashed **"+N"** node that also shows how many designs it holds.
  - "+N" counts the hidden remixes; the number below it counts everything beneath them too.
  - Tapping "+N" opens that branch in place.
- Limits:
  - Compact tree: children of works two levels below the original start folded, and each work shows 3 children before the rest fold.
  - Full page: six levels deep, 8 children per work.
- It never folds down to a "+1", because that box takes the same room as the design it hides.
- The branch leading to the current work is always open. If the current work's place falls past a row's limit, it stays visible and the "+N" covers its siblings.
- The tree scrolls sideways (native touch panning) and starts centred on the current work. Elbow links keep lines out of the counts.

### Pieces

**`src/lib/familyTree.ts`** — pure and browser-safe, with no Convex imports.
- `buildFamilyTree(data, options)`:
  - Roots are works whose parent isn't loaded in this family.
  - Children are listed in CR order, family works first, then forks out.
  - The family a fork came from is drawn as a parent above its root.
  - Folding follows `maxDepth`, `maxChildren`, the `expanded` set and the current work's branch.
  - Damaged data with a loop still shows every work once.
- `layoutTree(roots, size)`:
  - Each leaf takes the next column, and each parent is centred over its children.
  - It returns node positions, links (dashed for forks), and the overall width and height.
  - It is about 40 lines, with no graph library.

**`src/components/cr/FamilyTree.tsx`** — plain SVG links under absolutely positioned HTML nodes. Only the existing `lucide-react` icons are used (`GitBranch`, `Heart`).

**`lineage.familyTree({ family, limit? })`** in `convex/lineage.ts` — a public query that returns only public fields.
- **Family works:** one `by_family_expression` read of at most `2 × limit`. `limit` defaults to 60 and is clamped to 1–240. Published and withdrawn works are kept; works still being prepared are skipped. `more` is set when the family has more.
- **Per work:**
  - One `by_effectiveParent_status` read of at most 51 published children. `remixes` is capped at 50, with `remixesMore` set past that. This read also finds the forks out.
  - One `workSocialStats` read for hearts.
  - The parent is read only when it isn't already loaded.
- **Forks out:** capped at 60 in total. Hitting the cap sets `more` too.
- **Fork origins:** the parents in other families.
- **Corrected lineage:** it follows effective lineage, so corrected parents are drawn where they now belong.
- **Missing families:** it returns `null` when nothing in the family is published.

### Tests

- **`tests/unit/familyTree.test.ts`** — 18 tests:
  - reading the family number from a CR number;
  - ordering, including corrected parents;
  - a root whose parent wasn't loaded, and a lineage loop;
  - forks out after family children, sorted across families;
  - the family a fork came from drawn above, with a dashed link;
  - folding wide rows (with the count of everything underneath), with no fold at or one past the limit;
  - folding deep branches;
  - keeping the current work's branch open;
  - `expanded`;
  - a "+N" made only of forks;
  - layout coordinates and link endpoints;
  - several roots and the empty case.
- **`tests/convex-local/familyTree.test.ts`** — 6 tests:
  - the full shape, signed out: parents, remix and heart counts, forks out, the family a fork came from, and public fields only;
  - effective lineage;
  - withdrawn works as bare CR numbers, and works still being prepared left out;
  - `null` for empty or unknown families;
  - the `limit` cap with `more`, clamping, and a root still counting remixes past the cap;
  - the remix-count cap.
- **Totals:** `bun run typecheck` and `bun run test` pass, with 408 unit and 201 local Convex tests. ESLint is clean on every new or changed file.
- **Visual check:** I rendered static versions of the full tree (desktop, 1280 px) and the compact tree (phone, 390 px) and screenshotted them with agent-browser, using a family with 17 works, a withdrawn work, three forks out, a fork origin, and a deep current work. The screenshots led to the elbow links and the no-"+1" rule. The temporary render files are deleted.

### Notes for merging

- **Files touched:**
  - New: `src/lib/familyTree.ts`, `src/components/cr/FamilyTree.tsx`, `src/routes/family.$family.tsx` and both test files.
  - Changed: `src/components/cr/FamilyView.tsx`, `src/routeTree.gen.ts` (rebuilt) and `convex/lineage.ts` (the new query only).
- **No changes needed** to the schema, environment variables, `api.d.ts` (`lineage` is already listed) or `cr.$cr.tsx`.
- **`lineage.family`** (the old grid query) is no longer used by the page. It is kept because its tests still use it, and it can be removed later.
- **Remix counts** are read live and capped at 50 per work. If CultRemix ever wants exact counts for very popular works, a `remixes` counter next to `hearts` in `workSocialStats`, updated at publish and when lineage is corrected, would make it one read.

## Round 3: the graph's onchain half

Branch `codex/lineage`. Commits: `a8cf17b` (chain marks, onchain corrections, `/onchain`), `79c4790` (tests), `ca76865` (phone fix), a merge of `dev`, and this report. Nothing was deployed, run against a deployment, or pushed. The testnet registry isn't deployed, so everything here was built and checked against tests and fixtures.

### What's built

- **Marks on the family tree** (full page and compact):
  - A design registered on Monad gets a small black check badge in the top-right corner of its thumbnail.
  - One that's pending or submitted gets a quieter dashed hourglass ("being recorded").
  - Designs that aren't queued, failed registrations, and withdrawn designs get nothing.
  - On the full page, the badge links to the registration transaction on the explorer. It uses `explorerTxLink`, the same helper behind ChainStatus's "View transaction". The compact tree shows the badge without a link, because the card itself is already a link.
  - Every badge has a tooltip and screen-reader text, such as "CR 101-002 is recorded on Monad".
  - Forks out and the design a fork came from carry marks too.
- **The family page header:** once any design in the family is recorded, it shows "N of M designs recorded on Monad", linking to the original's (`-001`) registration. A legend item ("recorded on Monad") appears alongside it. Nothing shows while none are recorded.
- **The lineage trail:**
  - Each correction in the work page's Lineage section says "Recorded on Monad." or "Recording on Monad…".
  - A "View transaction" link appears when the correction's chain write has a hash.
  - The "Lineage amended" pill under the title adds "· recorded on Monad" when the latest confirmed correction is.
  - Corrections confirmed while chain writes were off keep the existing "Not yet recorded on Monad."
- **`/onchain`:** a short public page, rendered on the server and readable signed out. It covers:
  - what CultRemix records: each design's ID, CR number, parent, kind, fingerprint and creator wallet; lineage corrections; Backs in order; and the economics rules' fingerprint, linking to `/economics/v1.json`;
  - what it doesn't: no money, no personal details, and not the art itself;
  - this environment's network, registry address and explorer, or "Not deployed yet. New designs wait in line and are recorded once it is.";
  - four steps to check a design yourself: Fingerprint → Read Contract → `workIdAt(family, expression)` → `getWork`, comparing `contentHash`, `creator` and `parentId`.
- **The work page's link to `/onchain`:** ChainStatus, under the fingerprint, now ends with "What's on Monad, and how to check it →". `cr.$cr.tsx` is untouched.
- **New public query `provenance.registry`:**
  - It returns `{ networkName, testnet, address, addressUrl, explorerUrl }` for this deployment, from `shared/config/chains.ts`.
  - It honors `CHAIN_REGISTRY_ADDRESS` only on dev, as the chain writer does. Staging and prod always show the committed address, which is currently none.

### Decisions

- **Bounded reads.** Tree marks come only from `works.provenanceStatus` and `works.chainTxHash`, which the query already loads. `lineage.familyTree` reads no `chainWrites`. The trail reads one chain write per correction, and corrections per work are few.
- **Failed shows nothing**, the same as not queued. A failed write is an operator problem; "recording" would promise something that isn't happening. The work page's ChainStatus still shows the detail.
- **One explorer helper.** `explorerTxLink(chainId, txHash)` in `convex/provenance.ts` is shared by `forWork`, the tree and the trail. A dev deployment on a local RPC gets marks but no links, because there's no explorer to send anyone to.
- **The header counts what the page loaded.** It counts live designs only (not withdrawn designs, forks out, or the origin). For families bigger than one page it reads "N of M+", matching the design count above it.
- **The `/onchain` link always shows** in ChainStatus, even before a work is registered, because the page also explains what will happen.

### Tests

- **`tests/unit/familyTree.test.ts`**, 4 new tests (22 in the file):
  - chain state survives the tree build, including forks and origins;
  - `chainSummary` is null when nothing is recorded;
  - it counts live family designs only and links to the original;
  - there's no link when the original has no transaction URL.
- **`tests/convex-local/familyTree.test.ts`**, 5 new tests (11 in the file), all signed out:
  - Tree nodes for unqueued, pending, submitted, confirmed, failed and withdrawn-but-confirmed designs, plus a fork out and an origin, carry the right `chain` and `chainTxUrl`.
  - Exact key lists confirm only public fields come back: no hashes, write IDs or raw statuses.
  - The header counts come from `chainSummary` on the query's real output.
  - Nothing is recorded while a work is only pending. A local RPC gives a mark but no link.
  - Trail history: confirmed with a hash gives "recorded" and a link; submitted without a hash gives "recording" and no link; a correction confirmed off the chain gives nothing. Exact public keys are checked here too.
  - `provenance.registry`:
    - dev default: testnet, "not deployed", explorer link;
    - dev override: address and address link;
    - prod ignores the override: mainnet, no address;
    - a local RPC gives no explorer.
- **Totals:** `bun run typecheck`, `bun run build` and `bun run test` pass, with 478 unit and 286 local Convex tests. ESLint is clean on every changed file. While the shared box was heavily loaded (load average around 50 to 100), a few unrelated local Convex tests (notifications, trending, and others) hit the 5-second timeout. They pass on rerun and with a longer timeout.
- **Visual check:** I statically rendered the family page (1280 px and 390 px), the compact tree (390 px), `/onchain` (both widths), and the trail with ChainStatus (390 px), using fixture data and the built CSS, and screenshotted them with agent-browser. The check caught the registry line on `/onchain` breaking mid-word on phones (fixed in `ca76865`). The temporary files are deleted.

### Notes for merging

- **New:** `src/routes/onchain.tsx`. `src/routeTree.gen.ts` was rebuilt and committed.
- **Changed:**
  - `convex/provenance.ts`: `registry`, `explorerTxLink`, and an exported `deploymentChainId`. `forWork` behaves as before.
  - `convex/lineage.ts`: optional `chain` and `chainTxUrl` on tree and history rows.
  - `src/lib/familyTree.ts`, `FamilyTree.tsx`, `family.$family.tsx` and `LineageTrail.tsx`.
  - `ChainStatus.tsx`: the old body is renamed `RegistrationStatus`, and the link is added under it.
- **Lint fixes:** two fixes in existing lines, both behavior-neutral: import order in `provenance.ts`, and `.at()` in `LineageTrail.tsx`.
- **No changes** to the schema, environment variables, `api.d.ts` (`provenance` and `lineage` are already listed), `cr.$cr.tsx`, `convex/chain.ts` or `convex/publish.ts`.
- **Merged** the three newest `dev` commits cleanly. The new e2e smoke check of the public pages still matches ("Family N").

### Follow-ups

- **After the testnet registry is deployed:** set its address in `shared/config/chains.ts`. `/onchain` then shows the address and explorer link with no code change, and the tree and trail marks appear as writes confirm.
- **`/onchain` in the e2e smoke check:** worth adding to `tests/e2e/run-e2e.sh` (a one-line `assert_text "On Monad"`). I left that file to its owner.
- **A per-work explorer link:** an "open this design's record" link would need the workId-to-explorer route the chain builder may add. Today the link goes to the registration transaction, which shows the same fields.
