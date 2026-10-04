# QA and design pass — report

Branch `codex/qa`, from `dev`. Builder: Claude (Opus 5.5) working in its own worktree (`CultRemix-wt/qa`).
Every page in the brief was checked at 390 px and 1440 px, signed out and signed in as
@samdraws (sam@example.com, the owner). Testing ran on a separate dev server at :3107, using the
same dev deployment as :3000. No Generate, Publish, Reshoot, Upscale, Prepare for print, checkout,
waitlist or admin switch was ever pressed.

## Summary

- **Fixed (13 issues):**
  - Feed and profile images stayed invisible until JavaScript loaded.
  - Unknown CR numbers, members and families returned 200 with a bare message; they now return a real 404 with a helpful page.
  - CR numbers broke in the middle.
  - Phone tap targets were under 40 px.
  - Overlays didn't return focus when closed.
  - Escape didn't close the account menu.
  - Several pages had no title or share card.
  - The signed-in header was crowded on phones.
  - Copy fixes: "variation" vs "fork", "AI" in the site description, the print-permission message, and an unlabeled heart.
- **No horizontal overflow** on any page at 390 or 1440, signed in or out.
- **No console errors or hydration warnings** on home, `/cr`, `/studio`, `/print`, `/family`, `/u`, `/notifications` or `/me/earnings`.
- **No Convex changes.**
- **Checks:**
  - typecheck, `tsc -p convex` and build are clean;
  - unit tests: 432 of 432 pass;
  - the second suite: 229 of 229 pass.

## Issues found

Severity scale: **High** = broken for everyone, or wrong HTTP behavior. **Medium** = clearly wrong, but the page still works. **Low** = polish.

| # | Where | Issue | Severity | Status | Files |
|---|---|---|---|---|---|
| 1 | Feed, profile grid, family, `/cr` (any SSR'd art) | Images that finished loading before hydration never fired `onLoad`, so they stayed at opacity 0 (blank squares) until something re-rendered. | High | Fixed: on mount, `Art` checks `img.complete && naturalWidth > 0` and marks the image loaded. | `src/components/cr/Art.tsx` |
| 2 | `/cr/<unknown>`, `/u/<unknown>`, `/family/<unknown>`, `/family/abc`, any unknown path | No real 404: the routes returned HTTP 200, with a bare line of text (CR), an empty profile shell (member) or a blank tree (family). Unknown paths fell back to TanStack's default text. | High | Fixed. Loaders throw `notFound()` when the server says the row doesn't exist, so the response is now a real HTTP 404 (verified on :3107). One shared `NotFoundPage` shows what was asked for, big and faded (`CR 999-999`, `@nobody`, `Family 999`, `404`), plus a plain message and a "Back to the feed" button. The router also gets a default not-found page and an `ErrorPage` ("Something slipped." with Try again and Back to the feed). | `src/components/app/not-found.tsx` (new), `src/router.tsx`, `src/routes/cr.$cr.tsx`, `src/routes/u.$username.tsx`, `src/routes/family.$family.tsx` |
| 3 | `/cr/<cr>` lockup, work cards, family tree | At 390 px the CR number wrapped mid-number ("CR 101-" / "001"), and the TESTNET tag pushed it apart. The `/cr` lockup at 20vw was wider than the column. | Medium | Fixed. `CrMark` keeps "CR 101-001" on one line and lets only the TESTNET tag wrap. The `/cr` lockup is now `13vw` / `md:6.5vw`, and the family tree scroller no longer wraps. | `src/components/cr/CrMark.tsx`, `src/components/cr/WorkCard.tsx`, `src/components/cr/FamilyTree.tsx`, `src/routes/cr.$cr.tsx` (one class) |
| 4 | `/family/<n>` | No share card: a shared family link fell back to the generic site card. | Medium | Fixed. New `familyShareCard`: the title is "Family 101", the text is "2 designs, started by @samdraws. See every variation and fork on CultRemix." and the image is the root work's art (it falls back to the site image if the root was withdrawn). | `src/lib/share.ts`, `src/routes/family.$family.tsx`, `tests/unit/share.test.ts` |
| 5 | Login, studio, settings, admin, dashboard, onboarding, team, unauthorized, verify-email, verify-phone, followers, following | Every one of these pages had the same browser tab title. The followers and following pages had no share URL. | Medium | Fixed. Each page now has its own title ("Studio · CultRemix", "@samdraws follows · CultRemix", …). Followers and following use the new `pageMeta(title, path)` helper, which sets the title plus `og:url`, `og:title` and `twitter:title`. | route files listed; `src/lib/share.ts` |
| 6 | Feed and profile buttons (heart, follow, share), the bell, header links and the menu button | Tap targets on phones were 32–36 px. | Medium | Fixed. The `sm` size is now 40 px; the bell is `size-10`; Feed, Studio, Sign in and the account button are 40 px tall. | `HeartButton.tsx`, `FollowButton.tsx`, `ShareButton.tsx`, `NotificationBell.tsx`, `SiteHeader.tsx` |
| 7 | Signed-in header at 390 px | Wordmark, TESTNET, Feed, Studio, the bell and @samdraws were crowded edge to edge. | Medium | Fixed. Signed in, Feed is hidden below `sm` (the wordmark already links to the feed). Signed out is unchanged. | `SiteHeader.tsx` |
| 8 | Account menu | Escape didn't close it, and focus didn't return to the button. | Medium | Fixed. Escape now closes the menu and focuses the toggle; the button also gets `aria-haspopup`. | `SiteHeader.tsx` |
| 9 | Studio viewer, Compare, the cart drawer, studio "All ideas" sheet | When closed with Escape or ×, focus fell to `<body>`, so keyboard users went back to the top of the page. | Medium | Fixed. A new `useReturnFocus(active)` hook returns focus to the opener when the overlay unmounts. | `src/hooks/use-return-focus.ts` (new), `Viewer.tsx`, `Compare.tsx`, `CartDrawer.tsx`, `src/routes/studio.tsx` |
| 10 | Feed line and profile shelf | Every child said "Remix of CR …", whether it was a variation (same family) or a fork (new family). | Low | Fixed. New tested helper `remixOfLabel(cr, parentCr)` gives "Variation of" for the same family and "Forked from" otherwise. The parent CR is set in `font-cr`. | `src/lib/familyTree.ts`, `src/routes/index.tsx`, `src/components/social/WorkGrid.tsx`, `tests/unit/familyTree.test.ts` |
| 11 | Site and share descriptions | Product copy said "AI-made" and "Creators use AI". | Low | Fixed: rewritten without "AI" in the same voice (see Decisions). | `src/lib/site.ts` |
| 12 | `/print/<cr>` for someone who isn't the creator | The message was vague. | Low | Fixed. It now reads "Only the creator of a published work can prepare it for print." | `src/routes/print.$cr.tsx` (one string) |
| 13 | Compare | The favorite heart was a bare glyph with no label. | Low | Fixed: `role="img" aria-label="Favorite"`. | `Compare.tsx` |

### Seen but left (for others, or out of scope)

| Where | What | Severity | Why left / owner |
|---|---|---|---|
| Admin, settings, dashboard | They use the dark sidebar `AppShell`, while `/admin/orders`, `/me/earnings` and every public page use the white `SiteHeader`. Going from Admin to Orders switches themes, and the SiteHeader pages have no dark mode. | Medium | It's a design decision about which shell admin lives in. Too big for a QA pass. |
| Admin tab row at 390 px | It scrolls sideways (6 tabs). It works, but the last tabs are hidden until you scroll. | Low | Acceptable for an admin-only page. |
| `StudioInputs.tsx` | The × buttons on the image chips are `h-6`/`h-7` (under 40 px), and the Style Mixer library sheet doesn't return focus on close (`useReturnFocus` would fix it in one line). | Medium | The publish builder owns this file. |
| Cart drawer ± buttons, print colour swatches (~36 px), studio idea chips, shadcn `ui/button` default (`h-9`) | Under 40 px on phones. | Low | Changing the shared button default affects every admin and settings form. Better handled as a deliberate pass. |
| Studio session names | "Remix of CR 101-001" comes from `convex/lib/sessions.ts` (with tests), not the new variation/fork wording. | Low | Convex and tests. It's a session name, not a public label. |
| `src/lib/share.ts` work description | It says "A remix of CR …" on remixed works. | Low | The chain builder is working in `/cr` share/provenance; flagged for them. |
| All pages before hydration | Art is SSR'd at opacity 0 and fades in after JS, which delays LCP (and leaves it blank without JS). | Low | Fix 1 handles the stuck case. Server-rendering it visible is a design call about the fade. |
| Unknown-path 404 | The tab title stays the root title "CultRemix — Remix culture, get paid." | Low | TanStack's not-found head; the HTTP 404 and the page are correct. |
| Header "Sign in" | It always redirects to `/studio` after sign-in, not back to the page you were on. | Low | Behaviour change in auth flow. |
| Login | The button text changes after hydration ("Email me a code" → "Get a code"). | Low | The login form's owner; cosmetic. |
| Loading states | `/cr`, `/u` and `/family` show only the header while the client loads (rare, because SSR prefetches). | Low | No skeleton design exists yet. |
| `/me/earnings` | Labels capitalise "Available" mid-sentence. | Low | Earnings is the chain/economics area. |
| `/family/<n>` h1 | The number isn't set in the CR face. | Low | Judgement call: "Family 101" is not a CR number. |
| Home at 1440 | The single-column feed has very large squares. | Low | An existing design choice. |
| Studio copy "Shittles" | Kept as is. | — | `docs/hackathon/log.md` records it as Jon's request; I changed it and then reverted. |
| ESLint | It already fails on `dev` (import/order and others, in `cr.$cr.tsx`, `print.$cr.tsx`, …). | — | Not part of the required checks. I added no new lint errors in the lines I touched. |

## What I built and how it maps to the brief

- **One product at 390 and 1440:**
  - Fixes 1, 3, 6 and 7, checked by screenshots of every page at both widths, signed in and out.
  - Horizontal overflow was checked programmatically on every page (`scrollWidth <= innerWidth`).
- **States, especially not found:** fix 2 covers unknown CR, member, family, a malformed family number and unknown paths. There is also a shared error page.
- **Keyboard:**
  - Fixes 8, 9 and 13.
  - Tab order and visible focus were checked on the header, feed, `/cr` and studio. The browser focus ring is visible on everything I tabbed through.
- **Copy and names:** fixes 10, 11 and 12, plus the not-found messages ("This design isn't published.", "No one here by that name.", "There's no family with this number yet.").
- **A title and share metadata on every public page:**
  - `/cr`, `/u` and home already had cards.
  - Fixes 4 and 5 add the family card and titles everywhere else.
- **Images, layout shift, console, speed:**
  - Fix 1.
  - No console errors on any page.
  - The `/cr` lockup no longer reflows at hydration (fix 3).

## Evidence

- **Public**, in `docs/hackathon/qa/`:
  - `before-*` / `after-*` pairs: unknown CR, family, member and path; CR-number wrap; feed images invisible; header signed in at 390.
  - `signed-in-*` covers cr, family, feed Following tab, followers, following, home, notifications, print, profile, studio and studio viewer at 390 and/or 1440.
  - The `signed-in-*` shots were taken just before the final header fix (Feed hidden on phones). `after-header-signed-in-390.png` shows the final header.
- **Private**, in `docs/hackathon/qa/_private/` (gitignored, local only): admin and each admin tab, admin orders, earnings, settings and dashboard, since they show the email address, money or admin controls.

## Tests and results

- `bun run typecheck`: clean.
- `bunx tsc --noEmit -p convex`: clean.
- `bun run test`: 50 files / **432 tests passed**, and 21 files / **229 tests passed**.
- New tests:
  - `share.test.ts`: the family card (count, plural, starter, image fallback) and `pageMeta`.
  - `familyTree.test.ts`: `remixOfLabel` variation vs fork.
- `bun run build`: succeeds. `src/routeTree.gen.ts` is unchanged (no routes added).
- Live checks on :3107:
  - 404 status for the unknown CR, member, family and path, and for `/family/abc`;
  - 200 for real pages;
  - the Escape and focus-return behaviours;
  - 40 px targets measured with `getBoundingClientRect`.

## Decisions

- **Hide Feed in the signed-in phone header** rather than shrink type or drop the bell. The wordmark already goes to the feed, and the signed-out header is unchanged.
- **Removed "AI" from `SITE_DESCRIPTION` and `SHARE_DESCRIPTION`** to follow the copy rule. The original wording may have been written at Jon's request, so if he wants it back it's a two-line revert in `src/lib/site.ts`.
- **Kept "Shittles"**, because the log says Jon asked for it.
- **Not-found pages show the thing asked for** (faded, large) rather than a generic "404". This makes clear what was missing, and keeps the type style of the CR lockup.
- **The 404 is thrown from the loader only when the server answered `null`.** That way a page whose prefetch was skipped still renders client-side instead of 404ing.
- **No Convex changes**, so there's nothing to deploy.

## Stubbed

Nothing. Every change is live code.

## Other builders' files touched (all small and presentational)

- **Chain builder:**
  - `src/routes/cr.$cr.tsx`:
    - adds the `notFound` import and the `NotFoundPage` import;
    - the loader throws `notFound()` on `null`;
    - `notFoundComponent: WorkNotFound`;
    - the inline not-found block is replaced with `<WorkNotFound />`;
    - the CR lockup class changes from `text-[20vw] md:text-[10vw]` to `text-[13vw] md:text-[6.5vw]`.
  - The economics panel, provenance and Backs were not touched.
- **Publish builder:** nothing in the publish dialog, reveal, `StudioInputs.tsx` or the remix-field files.
- **`src/routes/studio.tsx`** (no listed owner): a `head` title and one `useReturnFocus()` line in `IdeasSheet`.

## For the Builder when merging

1. Merge `codex/qa` into `dev`. Expect possible conflicts in:
   - `src/routes/cr.$cr.tsx`: the loader / `notFoundComponent` lines and the CrMark lockup class, against the chain builder.
   - `src/routes/studio.tsx`: the import list and `IdeasSheet`, against anyone editing studio.
   - Keep both sides. My hunks are each only a few lines.
2. `.gitignore` gains `docs/hackathon/qa/_private/`. Keep it.
3. No Convex deploy, no env vars, no new dependencies. `routeTree.gen.ts` is unchanged.
4. After merging, run `bun run typecheck && bunx tsc --noEmit -p convex && bun run test && bun run build`.
5. Smoke test:
   - `/cr/999-999`, `/u/nobody-here` and `/family/999` should each show the faded mark with "Back to the feed" and return HTTP 404.
   - At 390 px signed in, the header should fit without crowding.
6. Optional: if Jon wants "AI" back in the share description, revert the two strings in `src/lib/site.ts`.
