# Print report (V1 U6, adapted by A2)

Branch `codex/print`. Five commits on top of `042efbd`, not pushed:
- `d820d04`: shared helpers;
- `53b5279`: Convex;
- `bd0b28d` and `95e3e50`: the UI;
- `75301ba`: the live check script and env docs;
- the commit that adds this report.

All six parts work, with typecheck, tests and build passing. One limit: the live page was never driven end to end against a Convex backend, because running one is off limits here. The comparison components were rendered in a browser with real sharp output, at desktop and phone widths.

## What was built, by plan item

### 1. Print Studio at `/print/<cr>` (creator and owner only)
- **Page:** `src/routes/print.$cr.tsx`.
- **Access:** signed-in only, via `requireAuthenticatedRoute`. `api.print.studio` returns null for anyone but the work's creator and `super_admin_owner`, and the page then says so.
- **Version 1:** the published art. `print.open` creates it idempotently and measures it on the server.
- **Versions:** each one is kept and shown in a rail as v1, v2 and so on, with its operation, size and state.
- **Trim:** `print.trim` → `printTools.makeVersion`, which uses sharp to crop to the visible box.
- **Knockout:**
  - `src/components/print/KnockoutTool.tsx` previews in the browser with the same `applyKnockout` code the server runs.
  - Controls: tap-to-pick color, tolerance, edges-only, and a "Clears N%" readout.
  - Applied on the server with sharp through `print.knockout` → `printTools.makeVersion`.
- **Upscale for print:**
  - Runs on fal Topaz Transparent 4× (`fal-ai/topaz/upscale/image/transparent`).
  - **One submission per attempt:**
    - `claimSubmission` moves `queued → submitting` exactly once.
    - The client's POST is never retried.
    - The request ID is recorded before any poll is scheduled.
    - Polls only read status and never resubmit.
    - If recording fails after fal accepted the job, the attempt fails and is refunded; it is not posted again.
  - **Key:** `FAL_KEY` is read from Convex env.
  - **Cost:** 2 credits, taken as a ledger `settle` row of −2. The owner is exempt. A failed attempt is refunded once, with `refund_credit`.
  - **Transparency:** an output without alpha is refused, and so is any input without alpha ("Knock out the background first").
  - **Size limits:** the input is limited to 1536 px on the long side, and a version can be upscaled only once.
  - Files: `convex/lib/fal.ts`, `convex/lib/upscaleFlow.ts` and `convex/upscale.ts`.

### 2. Placement
- **Shirt drawing:** `src/components/print/ShirtStage.tsx` draws the tee as an SVG with the front print area on it. It shows dashed print-area guides, a dotted safe area, and center and top lines that turn green when aligned.
- **Controls:** dragging snaps to center and top. There are 12 Comfort Colors swatches, a size slider, and buttons for Center, Top and "Biggest that prints great" (200 DPI).
- **Saving:** the placement is saved per work, about 0.7 s after changes stop (`print.savePlacement`, table `printPlacements`).
- **Config:** `shared/config/print-products.ts` defines the CC1717 print area of 15 × 17 in at 300 DPI, a 0.5 in safe inset, and the colors.

### 3. Print check (KTD-9)
- **Code:** `src/lib/print/check.ts` (with `dpi.ts`, `alpha.ts` and `placement.ts`).
- **DPI:** under 150 is refused, 150–199 is good, and 200 or more is great.
- **Other checks:** alpha must be present, coverage must be 2–98%, haze warns at 5–10% and is refused above 10%, and the design must sit inside the safe area.
- **Where it runs:** live in the page, and again on the server before and after rendering.

### 4. Server render
- **Render:** `convex/lib/printImage.ts` `renderPrintFile` resamples with sharp Lanczos3 plus a light unsharp mask (σ 0.6). Alpha of 240 or more is rounded to solid. The result goes on a transparent 4500 × 5100 print-area canvas.
- **PNG tags:** `convex/lib/printPng.ts` writes `pHYs` (300 DPI) and `sRGB` chunks.
- **Hash and storage:** the file gets a SHA-256 and is stored at `works/<f>/<eee>/print-<code>/print.png`, where `<code>` is 26 base32 characters from 128 random bits (`convex/lib/printKeys.ts`).
- **Set once:** `printTools.render` → `print.recordRender` sets `works.printKey` and `works.printSha256` once. After that, every tool and the placement are locked.

### 5. "See what goes to the printer"
- **Slider:** `src/components/print/CompareSlider.tsx` has a before/after view with a draggable vertical divider. The handle also works with arrow keys.
  - Both images are placed by their region on the print canvas, so the same pixel lines up on both sides. I verified this in a browser.
  - "Before" is the art as it was before any upscale, stretched to the print size. "After" is the print file. Until the file exists, the page shows a labelled preview of the chosen version.
- **100% crop:** one print pixel per screen pixel, with the art blown up pixelated to match (labelled "Art at 6.4×"), next to the smooth print file. A minimap picks the area.
- **How clear is the difference:** in the browser check, a 512 px design at 11 in showed obvious stair-stepping on the left against clean edges on the right.

### 6. Entry points
- `src/components/print/PrintEntry.tsx` sits on `/cr/<cr>`, below the fingerprint.
- It shows the status line ("Print file ready, 212 DPI at 11.2 in" or "No print file yet.").
- The creator and the owner also get a "Prepare for print" / "See the print file" link.
- It uses the public query `print.entry`, which works signed out and returns only `canPrepare` and `{dpi, widthIn}`.

## Tests

`bun run test`: all pass.
- Unit: 28 files, 196 tests. Convex-local: 2 files, 13 tests.

The print-specific tests:

| File | Tests | Covers |
| --- | --- | --- |
| `tests/unit/printHelpers.test.ts` | 33 | DPI math and grades, alpha/haze/solid measurement, coverage, knockout (tolerance, edges-only, border color), trim box, placement clamp/center/top/safe area/pixel rect, print-check items, the key format (26-char base32, paths, `isPrintFileKey`) |
| `tests/unit/printRender.test.ts` | 10 | real sharp: PNG CRC, pHYs/sRGB tags, render size and position, solid rounding, same input → same bytes and SHA-256, trim, knockout, alpha detection, preview |
| `tests/unit/fal.test.ts` | 8 | one POST, no POST retry, GET retries on 5xx, key only sent to `queue.fal.run`, status/result parsing |
| `tests/unit/upscaleFlow.test.ts` | 9 | one submission per attempt; record failure never re-posts; poll backoff, timeout, no-alpha refusal, errors keep polling |
| `tests/convex-local/print.test.ts` | 12 | access for creator, owner, other member and signed out; versions; upscale charge, refund once, owner free, refusals; placement clamp and color; render refusals and busy; set-once print file and lock; public entry |

- `bun run typecheck`: passes. The Convex typecheck is skipped because `CONVEX_DEPLOYMENT` is unset in this worktree.
- `bun run build`: passes; `src/routeTree.gen.ts` is committed.

## Live check: fal Topaz Transparent (2 calls, the maximum)

The check ran from `scripts/spikes/fal-topaz.ts --calls 2` on 2026-10-03.
- It uses the app's own `falClient` and `pollDelay`.
- The key is read inside the script from `~/.config/cultremix/fal.env` and never printed.
- The inputs were sharp-made transparent PNGs with lettering, sent as data URIs.

| Input | Output | Latency | Size | Price | Alpha |
| --- | --- | --- | --- | --- | --- |
| 600 × 600 | 2400 × 2400 PNG | 93.7 s (7 polls) | 3.74 MB | $0.08 (5.8 MP) | kept: RGBA PNG; visible share 55.7% → 55.6%; haze 0.07% of visible |
| 1024 × 1536 | 4096 × 6144 PNG | 93.3 s (7 polls) | 7.27 MB | $0.16 (25.2 MP, just over one 24 MP block) | kept; visible 74.2% → 74.1%; haze 0.02% |

These results agree with the earlier U0(k) numbers in `docs/image-generation/README.md`: 8¢ and 77–109 s.

## Decisions
- **Print versions** get their own table (`printVersions`) instead of new fields on `works`. Each one records its parent, its operation and parameters, metrics, and upscale state.
- **Upscale charging** is a `settle` row of −2 written when the attempt is created. A failure refunds it with `refund_credit`, only on the pending → failed transition, so it is refunded once.
- **When fal accepts but recording fails,** the attempt fails and is refunded. fal may still bill that one job, and we never resubmit. This follows the one-submission rule.
- **Remix source:** upscaled versions record `remixSourceId` (their parent). The work's remix source stays the published art, so upscaled images never go back to the image models (KD10).
- **The 1536 px upscale limit** applies to the long side of the input, per KTD-20. Topaz output above that is large and costs 16¢ or more.
- **Coverage and haze** in the live check use the source metrics. The server measures again after the render, where haze is measured after rounding near-solid alpha to solid.
- **The print file is made once.** A new placement after the file is made is refused (LOCKED). Changing it would need an owner reset, which isn't built.
- **Default shirt color** is the product color nearest the work's background color.
- **The comparison's "before"** walks up past upscales to the pre-upscale version. If a trim happened after an upscale, the version stands for itself, because its frame differs.
- **Browser copy of the 1536 limit:** `UPSCALE_MAX_SIDE` is mirrored in the page because `src/` can't import `convex/print.ts`.

## Stubbed or waiting on keys
- **`FAL_KEY` must be set in each Convex environment.** Without it, an upscale fails cleanly and refunds. The other tools and rendering need no keys beyond R2 (or Convex storage).
- **Printful CC1717 print area (15 × 17 in) is unverified** against Printful's current product spec. It is one config value in `shared/config/print-products.ts`.
- **fal spend limits** per environment are set in fal's dashboard; they are not set here.
- **Not built:** sending the print file to Printful, and an owner reset of a locked print file.

## Merge instructions for the Builder
1. **Merge.** Merge `codex/print` into dev; it touches no file outside its lane except the following:
   - `convex/schema.ts`: `...printTables` after `...cultremixTables`.
   - `convex/schema/cultremix.ts`: `works.printKey` and `works.printSha256`, both `v.optional`.
   - `convex/_generated/api.d.ts`: hand-edited entries for `print`, `printTools`, `upscale`, `lib/fal`, `lib/printImage`, `lib/printKeys`, `lib/printPng`, `lib/upscaleFlow` and `schema/print`. The next `convex dev` regenerates it.
   - `src/routes/cr.$cr.tsx`: one import and `<PrintEntry cr={item.cr} />`.
   - `src/routeTree.gen.ts`: regenerated. If it conflicts, take either side and run `bun run build`.
   - `docs/environment-variables.md`: the `FAL_KEY` row.
2. **Schema.** There are three new tables, `printVersions`, `printPlacements` and `printFiles`, with no backfill needed.
3. **Env.** Set `FAL_KEY` in Convex env for dev, staging and production, each key with a fal spend limit.
4. **Flag.** Upscaling honors the existing `gen.upscale` flag through `flagEnabled`, which defaults to on.
5. **Runtime.** `convex/printTools.ts` and `convex/upscale.ts` are `"use node"` and use `sharp`, which is already a dependency. Watch the Node action memory: a 4096 × 6144 upscale is decoded once (about 100 MB raw), and its alpha plane is read separately.
6. **Storage.** Print files use the existing public bucket, under the 128-bit code path. R2 CORS already allows GET from the app origins, which the in-browser knockout preview needs to read pixels.
7. **Follow-ups:**
   - Verify the CC1717 print area.
   - Hand the print file to Printful (U9/U10).
   - Add an owner "unlock print file" action.
   - Optionally show the fal queue position while an upscale is waiting.
