# Image test suite

A rerunnable record of everything CultRemix's image pipeline aims to do, run against the real models: GPT Image 2.5 makes the images, and GPT-6 Luna writes each image's notes, reads what a request wants from each image, compares a remix with its original, and checks the results. When a prompt changes or a new image model comes along, a run says which capabilities still work.

Every case runs through production's own code. Prompts come from `convex/lib/batchPrompt.ts` (the request reader plus `studioPrompt`), remix word boxes from `convex/lib/remixFields.ts`, notes from `convex/lib/notesWriter.ts`, the remix comparison from `convex/lib/remixCompare.ts`, and the image call from `convex/lib/imageCalls.ts`, the same function production calls. The suite cuts each grid with the production cutter, then a checker (GPT-6 Luna) looks at each design and answers the case's questions.

[CASES.md](CASES.md) lists every case: what it supports, its inputs, how it's checked, and when we first tested it. It covers words, styles and style mixes, people, remixes, the grid and layout, the model photo, image notes, the request reader, and the remix comparison.

## Running it

```bash
bun run test:image                      # every case: about 7 minutes and $2.70
bun run test:image --group remix,words  # some groups
bun run test:image --case remix-words   # some cases
bun run test:image --dry-run            # notes and prompts only, no images (a few cents)
bun run test:image --list               # the cases, without running anything
```

It uses the gateway key from `AI_GATEWAY_API_KEY` or `~/.config/cultremix/gateway.env`, and costs real money, so it stays out of `bun run test`. Each run writes `.tmp/image-e2e/runs/<time>-<name>/`:

- `report.md`: every case with its checks, and what's newly failing or passing against the baseline.
- `<case>/board.png` for each image case: the inputs and request on top, then the four designs, each marked PASS or MISS with the checks it missed. Look at these before trusting a failure.
- `<case>/grid.png`, `design-1.png` to `design-4.png`, and `prompt.txt` (the exact prompt sent).
- `notes/<fixture>.txt`: the notes each image got.

The run exits with 1 when a supported case fails or a case couldn't run. Known limits (cases marked so in CASES.md) are reported but don't fail it.

## Credit

The suite and production draw on the same CultRemix Gateway credit. A run checks the balance first and won't start unless it covers the run's estimate (`--force` overrides). If the credit runs out mid-run anyway, the run stops: the remaining cases are skipped, and a case that couldn't run or be checked is reported as "couldn't run," never as a failure, and is left out of the baseline. On 2026-10-05 four full runs used up the balance mid-run, before this check existed.

## How a case passes

- **Image cases:** four designs cut from one grid, a transparent background (at least 15% of the grid fully clear), the case's words read on each design (every word it needs, none it mustn't have), and each question answered as expected by at least the case's minimum of the four designs (all four unless the case says otherwise).
- **Model photo:** the same checks on the one photo.
- **Notes:** what the notes say about the image, such as quoting its words or describing a style's hair.
- **Request reader and remix comparison:** two tries each (`--trials` changes it), both answering as expected unless the case allows one miss.

The checker is a vision model and can misread a design, so look at a failing case's board first. Questions that name a reference ("the original," "the style image") are asked with the references in view; every other question, and reading the words, is asked about the design alone, because with a reference in view the checker answered about the reference (it read SLOW on designs that said LOUD). A design whose words read wrong gets one closer reading before it counts as a miss. If the designs are right and the checker is wrong, reword the case's question, never the production prompt, and note why in the case.

## Where GPT Image 2.5 stands

From the full runs on 2026-10-05 (boards in each run folder):

- **Reliable:** the request reader (23 of 23 cases), the remix comparison (15 of 15), the notes, words from a request, a style named in words or on a single image, two-style mixes, a photo restyled as pop art or a 70s poster with her likeness kept, a whole-body cartoon style with her own hair or with the style's hair on request, word remixes that keep the look, a remix restyled by the mixer, solid color panels, four images in one call, and the model photo.
- **Known limits:** three-style mixes (the third style lands in one design instead of all four), a style image's own lettering leaking into new words (GRASH for TRASH in some designs), and a lion style giving a wolf a lion's mane in about half the designs.
- **Fixed by the suite:** a grid with a style dropped the request's words from three of four designs until the prompt said every design shows them, and the notes' hair description flipped between runs until it simply describes the hair shown (both 2026-10-05).
- **Checker caveat:** "Apart from its words, does it keep the original's design" answered no for two of four word-remix designs that look right on the board (remix-words, remix-longer-and-removed). Look at those boards before treating a failure as real; the question may need gentler wording.

## Pinned to GPT Image 2.5

[pin.ts](pin.ts) reads production's models from `convex/lib/models.ts`: `openai/gpt-image-2.5-sunburst` for calls with images, `openai/gpt-image-2.5-flare` for words alone, grids at 1920x1920 and high quality, and `openai/gpt-6-luna` for notes, the reader, the comparison, and the checker. So by default the suite tests exactly what ships. [baselines/gpt-image-2.5.json](baselines/gpt-image-2.5.json) holds each case's result from the last full run (2026-10-05, 61 of 70; a few cases' checks changed after it), and every run reports what changed against it. Refresh it with a full `--update-baseline` run.

## Trying a new model

1. Run every case with the candidate, prompts unchanged:
   `bun run test:image --image-model openai/<model> --name <model>`
2. Read its report and boards. The report lists the cases that pass or fail differently from the GPT Image 2.5 baseline.
3. To switch production, change `convex/lib/models.ts` and `PIN.name` in `pin.ts`, then run `bun run test:image --update-baseline` and commit the code and the new baseline together.

`--quality medium` runs the grids at another quality the same way.

## Changing a prompt

Run the groups the change touches before and after (`--group`). A case that newly fails means something we support broke: fix the prompt, or record in the case why the behavior changed. After an intended change, `--update-baseline` records the new results (a partial run updates only its own cases).

## Adding a case

When something new gets tested by hand, add it to [cases.ts](cases.ts) so it's rerun from then on: its inputs, what it supports, the date, and its checks. Then run `bun run test:image --catalog` to refresh CASES.md (a unit test fails when it's stale), and run the case once with `--update-baseline`.

Fixtures live in [fixtures/](fixtures/) as WebP images at most 1024 px on a side, listed in [fixtures.ts](fixtures.ts). Every one was made by CultRemix's own image calls (made-up people and our own designs), so they're safe in this public repository. Keep it that way: no real people and no outside artwork.

## Costs

Measured on 2026-10-05: a full run cost $2.63 to $2.65 and took about 7 minutes.

| Kind | Each | In a full run |
|---|---|---|
| Image case (one 1920x1920 high grid, cut into four) | about 10-12¢, plus about 1¢ per extra input image | 24 cases |
| Model photo (1024x1024 medium) | about 3¢ | 1 |
| Checker, per design | a fraction of a cent | about 100 calls |
| Notes, reader, comparison | a fraction of a cent per call | about 90 calls |
