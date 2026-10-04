# Report: viewer

Branch `codex/viewer`. Favorites tray, full-screen viewer, and dismiss for the studio (V1 unit U5;
R3–R5, the shortcut half of R6, KTD-16). Paging is local state first, with neighbors decoded ahead,
so the next design is already drawn when it arrives; hearts and dismissals show the moment they're
tapped and the server catches up.

## What was built

| File | Change |
| --- | --- |
| `convex/studio.ts` | Tiles carry `rejected`. New `sessionFavorites({ sessionId, paginationOpts })` (index `by_session_favorite`, ascending = favorited order, cap 100; skips unfinished and dismissed). New `designBatch({ sessionId, generationId })`: the one batch holding a design, for a link to a design whose batch hasn't paged in (null if it isn't yours). `toggleFavorite` takes an optional `favorite` (set rather than flip) and returns `{ favorite }`; re-hearting keeps the tray position; hearting brings a dismissed design back; unfinished designs refuse. New `setRejected({ generationId, rejected })`: sets `generations.rejected`, never deletes; dismissing also unhearts; queued/dispatched designs refuse. Session card thumbnails skip dismissed designs. Another member's design is "not found". |
| `src/lib/viewerNav.ts` (new) | KTD-16, pure: scopes and labels, `scopeIds` (favorites in favorited order without dismissed; batch/session with dismissed only when shown), `nextId`/`previousId` without wrap, `position` ("4 / 12"), `preloadIds` (±2, nearest first), `afterLeaving` (advance, else back, else close), `leavesScope`, `switchTarget`, `viewerShortcut` (keys → actions; inert in inputs, textareas, selects, contentEditable, and with ⌘/Ctrl/Alt). |
| `src/lib/imagePreload.ts` (new) | `preloadImage` decodes ahead (`Image.decode()`), keeps the 40 most recent; `isPreloaded`. |
| `src/components/cr/Art.tsx` | `instant` (no fade, synchronous decode) for the viewer; starts on the original when it's already decoded. |
| `src/components/studio/design.ts` (new) | `Tile` type (moved out of `studio.tsx`), `isFinished`/`isFailed`, `designItems` (the ⋯ menu, now with Dismiss / Bring back). |
| `src/components/studio/designActions.ts` (new) | `useDesignActions`: optimistic heart and dismiss across every loaded list (batches, favorites tray, linked batch); a new heart joins the end of the tray; "Dismissed" toast with Undo. |
| `src/components/studio/useViewerRoute.ts` (new) | Viewer state in the URL (`?s=…&view=<design>&scope=<favorites|batch|session>`). Opening pushes a history entry; paging updates local state and replaces the URL 250 ms later; Back/Forward move the viewer; Close steps back. |
| `src/components/studio/Viewer.tsx` (new) | Full-screen viewer over the design's background color. Position in the CR font, scope tabs (Favorites / This batch / Whole session), ♥, Dismiss/Bring back, Use as image, Publish (or the CR link), ⋯ (transparency, show/hide dismissed, download, full size, use as image/style), Close. Arrows, ← → keys, F X B P T Esc, horizontal swipe, swipe down to close. Slides in from the direction of travel. Preloads the current original, mediums ±2, originals ±1; pages in more of the scope near its end. Phones: controls in a bottom bar in thumb reach, safe-area padding. |
| `src/components/studio/FavoritesTray.tsx` (new) | Fixed bottom strip while a session is open: "♥ N" (opens the first favorite) and the favorites in favorited order, scrolling sideways, scrolling to a new heart, "More" to page. |
| `src/components/studio/LoadMore.tsx` | `PAGE.favorites = 48`. |
| `src/routes/studio.tsx` | Search params `view`, `scope`. Favorites query, tray, viewer, and dismiss wired in; tiles open the viewer on their batch; batch line has "N dismissed · Show/Hide"; dismissed tiles are dimmed when shown; tile corner button Dismiss / Bring back. The old in-file viewer was removed. **`PublishDialog` is byte-identical to before.** |
| `tests/unit/viewerNav.test.ts` (new) | 17 tests. |
| `tests/convex-local/viewer.test.ts` (new) | 13 tests. |

## Mapping to the plan

- **KTD-16 / pure navigation module:** `src/lib/viewerNav.ts`, unit-tested. Done.
- **R3 (favorite, unfavorite, reject, open full-size by pointer or keyboard):** tile buttons and menu, viewer buttons, F / X, Enter on a focused tile opens it. Done.
- **R4 (favorites tray, favorited order, opens viewer scoped to favorites):** Done; paginated on `by_session_favorite`.
- **R5 (paging within scope, arrows/keys/swipe, preload, shortcuts, URL state):** Done. "Prepare" is P = Publish today (the Print Studio route, U6, doesn't exist yet).
- **R6 (branch):** B / "Use as image" puts the design in the image tray and focuses the instruction, using the existing flow. "The batch shows its parent" is **not** built (follow-up).
- **Dismiss:** from the batch view and the viewer; hidden by default, "Show dismissed" in the batch line and the viewer menu; rows are never deleted.
- **Phones:** viewer is full screen with swipe and a bottom control bar; tray scrolls sideways.

## Tests and results

- `tests/unit/viewerNav.test.ts` (17): scope orders; dismissed handling per scope; duplicate/stale favorites; batches → session designs; URL scope parsing; next/previous without wrap; missing design; 1-based position; ±2 preload nearest-first; scope switching; unfavorite advance/back/close; dismissal leaving per scope; key map; inert while typing; browser shortcuts left alone.
- `tests/convex-local/viewer.test.ts` (13): favorites in favorited order across batches with their colors; re-heart keeps place, unheart then heart goes to the end; paging without repeats; unfinished design can't be hearted; dismiss keeps the row; dismiss leaves favorites; heart brings back; failed designs dismissable, queued ones not; session thumbnails skip dismissed; `designBatch` found / null; another member gets "not found" on heart and dismiss and empty results from the queries; signed-out callers.

Results on the final tree: `bun run typecheck` passes; `bunx tsc --noEmit -p convex` passes;
`bun run test` passes (unit 160/160 in 26 files, convex-local 28/28 in 4 files); `bun run build`
passes; `src/routeTree.gen.ts` unchanged. ESLint is clean on every file this branch adds; the
remaining lint errors in `convex/studio.ts` (import order, line 259), `src/routes/studio.tsx`
(the `studioRules` / `StudioInputs` import order), `StudioInputs.tsx`, and `StudioSessions.tsx` were
there before this branch.

Browser check: this worktree has no Convex deployment (no `.env.local`, and the new functions need a
push), so the real `/studio` couldn't run. Instead the real `Viewer` and `FavoritesTray` were mounted
in a throwaway harness with fake designs (since deleted) and driven with agent-browser at
1280×800 and iPhone 16 Pro (402×874): hearting with F, paging with keys, "4 / 4" with no wrap,
scope switching keeps the design, unhearting in Favorites advances / goes back / closes, dismissing
hides the design, swipe left/right pages and swipe down closes, the tray scrolls sideways to the
newest heart, and the phone bar is fully in reach. **Not yet checked against a live backend:** URL
restore after reload, Back/Forward, the linked-batch fetch, and optimistic updates with real latency.

## Decisions

- **URL writes trail paging by 250 ms.** The root route's `beforeLoad` asks the server for the
  sign-in on every navigation, including search-only ones, so paging through the router would wait
  on a network round trip per design. The viewer moves local state and replaces the URL afterwards;
  Back/Forward are adopted through `router.history.subscribe` (pushes and replaces are ignored).
- **One component file instead of the plan's `useViewerKeys` / `useSwipe` / `useImagePreload`.**
  Keys are pure in `viewerNav.viewerShortcut`; swipe is motion's drag with direction lock; preload is
  `src/lib/imagePreload.ts`. Fewer files, same tested behavior.
- **Dismissing a favorite unhearts it; hearting a dismissed design brings it back.** One state at a
  time, so the tray never shows a dismissed design. Undo after dismissing a favorite re-hearts it,
  which puts it at the end of the tray.
- **A dismissed design opened directly stays in view** in batch/session scope until you move on, so
  dismissing in the viewer with "Show dismissed" off still lands on a neighbor without the page jumping.
- **Medium for paging, original once decoded.** Mediums ±2 and originals ±1 are decoded ahead.
- **Scope default is `session`** when a URL names a design but no (or an unknown) scope.
- **Failed designs can be dismissed; queued/in-flight can't** (nothing to hide yet).
- **Tile and Viewer moved out of `studio.tsx`** to keep the route file readable and to let
  `PublishDialog` stay untouched (it now reads `Tile` from `design.ts`, an import-only change outside
  the component).

## Stubbed or waiting

- Nothing waits on keys or accounts. No env vars.
- Live check on a deployment (see Browser check above) and the plan's e2e F1/F1m
  (`tests/e2e/sections/studio.sh`) with the 24-image fixture session: not written; it needs a deployment.
- "Prepare" (U6 Print Studio) doesn't exist; P opens Publish.

## Merging (Builder)

1. **Schema:** no changes. `generations.rejected` and the `by_session_favorite` index already exist.
   No new Convex modules, so no `api.d.ts` edits.
2. **Convex API:** `toggleFavorite` gains an optional `favorite: boolean` and returns `{ favorite }`
   (existing calls without it still flip). New: `sessionFavorites`, `designBatch`, `setRejected`.
   `tileView` gains `rejected` (required boolean in the return validator). Push with `convex dev` /
   deploy as usual; nothing else to run.
3. **Env vars:** none.
4. **Conflicts to expect in `src/routes/studio.tsx`:** the in-file `Viewer`, `openViewer`,
   `tileById`, local `designItems`, and `Tile` type were removed (now in `src/components/studio/`).
   `PublishDialog` itself is unchanged, so the publish-dialog builder's edits should merge cleanly;
   if they reference `Tile`, it is imported from `~/components/studio/design`.
5. **URL:** `/studio` search gains `view` and `scope`. Any link builder that sets `search` wholesale
   should spread the previous search.
6. **Follow-ups:** skip the root `beforeLoad` server sign-in check for search-only navigations (then
   the 250 ms URL trail can go); show a branched batch's parent (R6); e2e F1/F1m once a deployment
   is available; tidy the pre-existing lint errors listed above.
