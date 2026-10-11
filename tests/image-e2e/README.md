# Image test suite

A rerunnable record of everything CultRemix's image pipeline aims to do, run against the real models: GPT Image 2.5 makes the images, and GPT-6 Luna writes each image's notes, reads what a request wants from each image, compares a remix with its original, and answers the checks' questions, while Gemini 3.1 Pro reads each design's words letter for letter. When a prompt changes or a new image model comes along, a run says which capabilities still work.

Every case runs through production's own code. Prompts come from `convex/lib/batchPrompt.ts` (the request reader plus `studioPrompt`), remix word boxes from `convex/lib/remixFields.ts`, notes from `convex/lib/notesWriter.ts`, the remix comparison from `convex/lib/remixCompare.ts`, the spelling check from `convex/lib/spelling.ts` and `convex/lib/wordReader.ts`, and the image call from `convex/lib/imageCalls.ts`, the same function production calls. The suite cuts each grid with the production cutter, then checks each design: a checker answers the case's questions, a word reader spells out its lettering, and for a remix that should keep its design, production's own remix comparison looks at it next to the original.

[CASES.md](CASES.md) lists every case: what it supports, its inputs, how it's checked, and when we first tested it. It covers words, styles and style mixes, people, remixes, the grid and layout, the model photo, image notes, the request reader, the remix comparison, and the studio's spelling check.

## Running it

```bash
bun run test:image                      # every case: about 7 minutes and $2.70
bun run test:image --group remix,words  # some groups
bun run test:image --case remix-words   # some cases
bun run test:image --dry-run            # notes and prompts only, no images (a few cents)
bun run test:image --recheck 20261005-1934-gpt-image-2.5   # check an earlier run's images again (cents)
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
- **Remixes that keep their design:** the app's remix comparison, the same call that decides variation or fork when someone publishes, must call each design the same design as the original, with its subject, layout, and style unchanged (a removed word may move the layout). It replaced a yes/no question that said no to two of four designs that were plainly right; on 66 word-remix designs from earlier runs, the comparison called every one the same design.
- **Model photo:** the same checks on the one photo.
- **Notes:** what the notes say about the image, such as quoting its words or describing a style's hair.
- **Request reader and remix comparison:** two tries each (`--trials` changes it), both answering as expected unless the case allows one miss.
- **Spelling check:** two readings of each finished design (`--trials` changes it), each flagging exactly the case's words, as the studio's Typo? chip would: TRASH for the designs drawn TrROH, TRROSH, and TRROW, and nothing for lettering spelled right. A reading that fails is tried once more, as in production (`convex/spellingCheck.ts`).

The checker is a vision model and can misread a design, so look at a failing case's board first. Each answer had to be calibrated, and these are the lessons:

- **Questions that name a reference** ("the original," "the style image") are asked with the references in view; every other question is asked about the design alone, because with a reference in view the checker answered about the reference.
- **The checker sees questions as q1, q2, never their case ids.** An id is a claim: asked "Does the design show a dark night sky or a moon?" under the id `no-night`, it answered yes for sunny beaches 11 times in 12; under `q2`, never.
- **Words are read by a different model.** GPT-6 Luna reads what a design probably meant: it read the misspelled TRRSH as TRASH and a clear LOUD as SLOW. Gemini 3.1 Pro, at low thinking, read all of them letter for letter (about 0.3¢ a read). No model reliably caught an E missing its bottom bar.
- **A second look before a miss.** A design that misses a question is asked that question again, and one whose words read wrong is read again. Either counts if it comes back right.
- **Calls wait their turn.** At most 10 checker, word, comparison, and reader calls run at once. With about 80 at once, calls queued at the gateway ran past their time limits and a whole run's comparisons failed.

If the designs are right and the checker is wrong, reword the case's question, never the production prompt, and note why in the case. To test a new wording for pennies, check an earlier run's images again with `--recheck <run folder>`; it makes no images.

## Where GPT Image 2.5 stands

From seven full runs on 2026-10-05 and targeted reruns after each fix (boards in each run folder). The last full run, `20261005-1934`, passed 70 of 71 supported cases; the one failure, her hair turned pink, is fixed below. The styles, people, remix comparison, and notes groups were rerun after the latest fixes (`20261006-0350`, `-0423`):

- **Reliable:** the request reader (25 of 25 cases), the remix comparison (18 of 18), the notes, words from a request, a style named in words or on a single image, two- and three-style mixes, a photo restyled as pop art or a 70s poster with her likeness kept, a whole-body cartoon style with her own hair or with the style's hair on request, word remixes that keep their design, a remix in words, a character swapped in a remix, a remix restyled by the mixer, solid color panels, four images in one call, and the model photo.
- **Known limits:** a style image's own lettering leaking into new words (GRASH, TRRSH, or TrROH for TRASH; all four designs in two runs of seven, one design in another; a retest of the same prompt spelled all 12 designs right, so it comes and goes; since 2026-10-11 the studio's spelling check catches it and offers Fix the spelling), and a lion style giving a wolf a lion-like mane in about half the designs at high quality (none in 12 at medium since the notes stopped listing the mane as a trait).
- **Fixed by the suite** (2026-10-05):
  - A grid with a style dropped the request's words from three of four designs until the prompt said every design shows them.
  - The notes' hair description flipped between runs until it simply describes the hair shown.
  - "Use the colors from the second image" read the second image as both subject and style, which would have drawn its woman into the design. The request reader now reads an image used only for its colors as a style.
  - At 80/20, the smaller pop-art style showed only as its woman's long pink hair on the raccoon, or not at all. Its notes' signature traits named things the image shows. They now describe ways of drawing (cyan shadows on lavender), and the raccoons came out lavender with cyan shading.
  - Three styles: the two smaller styles each got a design of their own, with the style image's woman or picnickers drawn in (7 of 16 designs over four runs). Each smaller style now gets a part of every design (the first colors the main subject, the next goes around it), and in 16 designs every raccoon took the pop-art coloring, 15 had the 70s landscape or sky, and none had a style image's people. The same made the 20% style in an 80/20 mix show in every design.
  - The remix comparison follows Jon's rule (2026-10-05): a design is its look and its layout. A swapped character (a pencil-sketch lion to a wolf), new words, or new colors stay a variation; a redraw in a different style or medium (pixel art), or a rebuilt layout, may be a fork.
  - The pop-art style turned the woman's copper hair pink in all four designs in 2 of 8 grids, because its notes say "hot pink hair." The prompt now says each person keeps their own hair color unless the request says otherwise: 6 of 6 grids kept her copper hair, and a new case, "with bright pink hair," made it pink in 4 of 4.
- **Added 2026-10-06** (history in [Styles and mixing](../../docs/image-generation/style-mixing.md)):
  - Santa, Mrs. Claus, and the elves (`remix-parts-family`, `remix-parts-group-size`). People and groups are named by role only, with their looks from the family photos. Both pass at high quality.
  - A lettering style in second place (`mix-lettering-second`). GPT-6 Luna now picks each smaller style's part, so GROW SLOW goes on the lettering: 4 of 4 at high quality, with no person. The figure notes no longer describe the style image's own person, which had drawn the pop-art woman into 5 to 6 of 12 designs.
  - A new known limit: a quieter style can't lead a louder one (`mix-quiet-lead`). With the pop-art portrait at 50% and GROW SLOW at 30%, no design was mostly pop-art.
- **Added 2026-10-11:**
  - The studio's spelling check (`--group spelling`, 16 cases, about 9¢). Two runs (`20261011-2117`, `-2119`) read each design four times with the same answer every time: the three designs whose TRASH leaked from the GROW SLOW style were flagged on every reading (read as TRROH, TRROSH, and TRROW; TRROW is three letters off, the most the check allows for a five-letter word with the same first letter), and none of the 13 spelled right was flagged, in arched, distressed, neon, wave, and hand lettering, digits, an ampersand, and lettering read in pieces.
  - Fix the spelling (`words-fix-spelling`, about 14¢): the studio's request on the TrROH raccoon spelled TRASH right in all 8 designs of two grids, and 6 of the 8 kept the design (run `20261011-1808-fix-spelling-4` was 4 of 4 on both). The wordings tried are in the [notebook](../../docs/image-generation/style-mixing.md).

## Pinned to GPT Image 2.5

[pin.ts](pin.ts) reads production's models from `convex/lib/models.ts`: `openai/gpt-image-2.5-sunburst` for calls with images, `openai/gpt-image-2.5-flare` for words alone, grids at 1920x1920 and high quality, and `openai/gpt-6-luna` for notes, the reader, the comparison, and the checker's questions. So by default the suite tests exactly what ships. The suite's own word reader, `google/gemini-3.1-pro-preview`, is pinned there too; it's a preview model, so if it's retired, change that line. [baselines/gpt-image-2.5.json](baselines/gpt-image-2.5.json) holds each case's result from the last full run, and every run reports what changed against it. Refresh it with a full `--update-baseline` run.

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

Measured on 2026-10-05: a full run cost $2.65 to $2.85 and took 7 to 9 minutes. The spelling group, added 2026-10-11, adds about 9¢ and runs alongside the image cases. A `--recheck` of a full run cost about 25¢.

| Kind | Each | In a full run |
|---|---|---|
| Image case (one 1920x1920 high grid, cut into four) | about 10-12¢, plus about 1¢ per extra input image | 24 cases |
| Model photo (1024x1024 medium) | about 3¢ | 1 |
| Checker and word reader, per design | under half a cent | about 200 calls |
| Notes, reader, comparison | a fraction of a cent per call | about 90 calls |
| Spelling check, per reading | about 0.3¢ | 32 readings, about 9¢ |
