# Experiments behind the style notes

These are the scripts behind the numbers in [Styles and mixing](../style-mixing.md), copied as they ran. They're a record, not tools. Their paths point at the folders they ran from on mighteous, and nothing in the app imports them. Typecheck skips `docs/`, and lint is told to skip it too. The image test suite's cases are the rerunnable versions of what we support.

To run one again:

1. Copy it into `.tmp/` at the repo root. The October scripts import `../convex/lib/…` and `../tests/image-e2e/…` from there.
2. Load the gateway key: `set -a && . ~/.config/cultremix/gateway.env && set +a`.
3. Run it with `bun`.

Scripts that read saved notes expect a suite run's `notes/` folder; `bun run test:image --dry-run` writes fresh notes for a few cents. A grid costs about 11¢ at high quality and 4¢ at medium, plus a fraction of a cent for each design checked. Contact sheets for all of these stay on mighteous under `.tmp/` (`flow/boards/`, `limits/`, `blend/`, `santa/`, `models/`); a few are in [evidence/](../evidence/).

## September 30 to October 2

These ran in `~/cultremix-imagecheck`, a scratch Bun project with its own `package.json`, before the studio's prompt code was shared with tests. Several start with a run line such as `GRID_JOB=<name> bun --env-file=… <script>`.

| Script | What it tested |
|---|---|
| `mix.ts` | Slider-driven mixes (80/20 and three styles): the largest share leads, and every other style must be clearly visible |
| `blend.ts` | How strongly a preset style shows at 80, 50, and 20 |
| `likeness.ts`, `inputs.ts` | A photo of a made-up woman drawn in a 70s poster style, with the app's prompt |
| `notes-test.ts` | Whether the photo's own notes help "Reimagine image 1 in the style of image 2": all of them, only scene and words, or none |
| `lion.ts` | Made the lion design used for "Change the words to NIGHT SHIFT" |
| `style.ts`, `news.ts` | Which model writes the best notes (GPT-6 Luna, GPT-6 Sol, GPT-5.6 Terra), on stylized lettering and a newspaper page |
| `likeness2.ts`, `judge.ts` | Four wordings of the keep step, scored by a GPT-6 Luna judge for likeness and style |
| `roles.ts` | GPT-6 Luna reading which images a request uses for their look, at each reasoning effort |
| `imgcount.ts` | 4 to 16 images in one call, and whether each comes through |

## October 4 to 6

These ran from `.tmp/` in this repo and build prompts with production's own code.

| Script | What it tested |
|---|---|
| `roles-test.ts` | The request reader with the mixer, hair, borrowed colors, and style names; several reads per request |
| `hair-cal.ts` | Whether the notes' "Hair:" line describes the hair shown, over many reads |
| `traits-cal.ts` | Signature traits as the notes prompt writes them, several reads per style image |
| `accent-cal.ts`, `accent-cal2.ts` | Calibrating the suite's 80/20 question: does the 20% style show, and does its subject's hair stay out? |
| `hairfix.ts` | Her hair turned pink by the pop-art style, with and without "each person keeps their own hair color" |
| `stylecopy-cal.ts` | Calibrating the suite's question about a style copied from the lion design |
| `limits-exp.ts` with `spec-*.json` | October 5's known limits, run as prompt variants from saved suite prompts. Specs: three-style parts (`spec-mix.json`, `spec-zones-high.json`), the 80/20 accent (`spec-accent.json`), the lion's mane (`spec-mane.json` to `spec-mane3.json`), and the lettering leak (`spec-words.json`, `spec-leak-high.json`) |
| `judge-cal2.ts` | Calibrating variation or fork: a design is its look and layout |
| `wolf-test.ts` | The pencil-sketch lion remixed with "Change the lion to a wolf," end to end |
| `mix3-q.ts`, `mix3-q-med.ts`, `mix3-strict.ts` | Like for like: the same questions for every saved three-style design. The strict answers are in `mix-three-strict.txt` |
| `blend-exp.ts`, `blend-score.ts` | Four ways to blend three styles (size order, Luna's parts, one blended description, a range) on two mixes. Scores are in `blend-scores.txt` |
| `fig-exp.ts` | The leading style's person leaking through its figure notes |
| `lettering-exp.ts` | Describing a louder smaller style by its lettering alone |
| `blend-dominance2.ts` | Which style each mix B design is mostly in |
| `family-photos.ts` | Made the made-up family photos for the Santa test |
| `santa-exp.ts`, `santa-exp6.ts` | Santa, Mrs. Claus, and the elves from family photos; then six elves with Mrs. Claus left out |
