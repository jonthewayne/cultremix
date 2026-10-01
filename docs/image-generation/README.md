# Image generation

How CultRemix makes designs, what each call costs, and how the pieces fit: the studio's images and style mixer, the notes written for every image, the four-up grid, upscaling for print, and what the printers need. Measured on the gateway between 2026-09-29 and 2026-09-30; the scripts live in `~/cultremix-imagecheck/` on mighteous.

## Models

All image calls go through the Vercel AI Gateway with AI SDK 7 `generateImage`, `maxRetries: 0`.

| Job | Model |
|---|---|
| A design from words only | `openai/gpt-image-2.5-flare` |
| Anything with an input image: the studio's images, style images, remixes, model photos | `openai/gpt-image-2.5-sunburst` |
| Notes for an image (what's in it, how it looks) | `openai/gpt-6-luna`, reasoning effort low |
| Upscale for print | fal `topaz/upscale/image/transparent` |

Dev normally uses Jon's ChatGPT login (`CHATGPT_ACCESS_TOKEN`), which runs a different image model. Set `IMAGE_PROVIDER=gateway` on dev to test with the production models.

## What a call costs

Billed amounts from the gateway's per-generation records (`GET https://ai-gateway.vercel.sh/v1/generation?id=<gen_…>`, `total_cost`). Output tokens cost $30 per million, image input $8 per million, text input $5 per million. Each input image adds about 1.3¢ every time the model reads it.

| Call | Quality | Output tokens | Billed | Time |
|---|---|---|---|---|
| One 1024×1536 design from words (Flare) | medium | 343 | 1.07¢ | ~12 s |
| One 1024×1536 design with one image (Sunburst) | medium | 343 + ~1,630 input | 2.31¢ | ~30 s |
| Today's batch: four separate designs from words | medium | | 4.3¢ | 13 s in parallel |
| Today's batch: four separate designs with an image | medium | | 9.2¢ | 33 s in parallel |
| One 1920×1920 grid of four, from words | medium | 819 | 2.5¢ | 25 s |
| One 1920×1920 grid of four, with an image | medium | 819 + ~1,690 input | 3.8¢ | 38 s |
| One 1920×1920 grid of four, from words | high | 3,276 | 9.9¢ | 30 s |
| One 1920×1920 grid of four, with an image | high | 3,276 | 11.1¢ | 55–63 s |
| One 1536×2304 grid (tall), from words | high | 2,127 | 6.5¢ | 25 s |
| Notes for one image (GPT-6 Luna) | | ~600 out | 0.03–0.09¢ | 10–25 s |
| Topaz Transparent upscale of one grid design | | | 8¢ | 77–109 s |

Quality changes detail, not size: a high grid is the same 1920×1920 with more detail in fur, faces, and texture; bold lettering looks almost the same. With quality unset the model picked high for four of five grids. High looks clearly better on illustrations, so the grid should default to high: about 10–11¢ per batch of four, which suggests 2 credits per batch (about 5¢ of image cost per credit).

Production today sends `quality: "medium"` for designs and model photos (`IMAGE_QUALITY`, `PHOTO_QUALITY` unset) and makes four separate calls per batch.

## The four-up grid

One call makes four designs in a 2×2 grid; `convex/lib/gridCut.ts` cuts them apart. A grid gives more varied designs than four separate calls (which came back nearly identical) and costs less at medium.

**Size.** GPT Image 2.5 sizes must have both sides a multiple of 16 px, at most 3,686,400 px in total, a long side at most 3× the short side, and no side over 3,840 px; larger sizes are experimental. The largest non-experimental square is **1920×1920**, and that's the grid size. The tall 1536×2304 grid didn't help. Each cut design comes out about 730–900 px wide and 800–940 px tall.

**Prompt.** `GRID_RULES` in `convex/lib/prompts.ts` asks for one complete graphic centered in each quarter, about 80% of its quarter, with wide empty space between them, nothing touching or crossing the middle or the edges, and no grid lines, boxes, labels, or numbers.

**Cutting.** The cutter needs no vision model and no fixed coordinates:

1. It finds the artwork: pixels with alpha 24 or more. If under 5% of the image is clear (the model ignored transparency), it keys out the most common edge color instead, which also clears parts of the design in that exact color.
2. It finds the emptiest column and row in the middle 30% (35–65%) of the image, nearest the center on ties. Those are the cut lines.
3. It labels connected shapes (8-connected) and gives each shape whole to the quarter that holds most of it, so a design that pokes past a cut line isn't sliced.
4. A shape with at least 15% of itself on both sides of a line straddles it. If it's thin where it crosses (35% or less of its thickest point), it's two designs touching and is cut there; otherwise the quarters it covers come back `merged` and are refunded. A quarter with almost no art comes back `empty`.
5. Each design is cropped to its own artwork plus 2 px of soft edge and a **4 px clear margin** on every side, copying only pixels that belong to that design.

In tests, all 16 real grids cut cleanly into four (the nearest art sat 21–116 px from the middle), including solid color-block posters, which keep the clear space around each panel. Cutting takes about 1.4 s per grid. Unit tests: `tests/unit/gridCut.test.ts`.

The grid is built and tested but not yet used by the studio; batches still make four separate 1024×1536 calls.

## The studio: images and the style mixer

The studio has two inputs, and where an image is added decides its job, so nothing has to read the prompt:

- **Images** (numbered 1–4 above the prompt box) are what to work on: their people, words, characters, and layout. With no style in the mixer they keep their own look, so "Change the words to GROW WILD" just works.
- **The style mixer** (closed by default, below the prompt box) holds up to three styles, each with a 0–100 slider. Nothing joins the mix on its own: a member uploads a style image ("Upload a style image" opens a picker with their past style images first, then their other images, or upload from the computer), drops one on the mixer, adds an image's look with "+ Image 1", or picks "Use as style" on a design.

Sliders become shares: two styles at 100 are 50/50, 100 and 50 are 67/33, zero is off. Each row shows its real share.

The prompt placeholder follows the images: "Describe your design…" with none, "Change the words, colors, characters…" with one, and "Refer to them as image 1 and image 2…" with more.

## Notes for every image

When an image first comes into the studio, `convex/imageNotes.ts` asks GPT-6 Luna for notes with `STYLE_NOTES_PROMPT`, and `userImages` stores them once per member and image (matched by SHA-256), so reusing an image costs nothing. Transparent images go to Luna on flat gray with a note saying so, since vision models read clear pixels as black. The notes have these parts:

- **Summary** and **Kind** (photo or art): the image's short name in prompts. Neither is shown in the studio (see "What stays on the server").
- **Subject and layout**, **Words** (every piece of text, most prominent first, with its exact spelling, role, position, size, and lettering), **People and characters** (who is in it and what makes each person recognizable, without naming anyone).
- **Technique**, **Color** (with hex codes), **Line and shading**, **Lettering** (the overall approach), **Figure drawing** (how the image draws faces and bodies compared with real proportions, with numbers where possible), and ranked **Signature traits**.

The first group is content; the second is style. A person's likeness is content; the way an image draws faces is style. The prompt uses each half where it belongs.

GPT-6 Luna read stylized lettering right in 9 of 9 tries and listed 16 separate pieces of text on a newspaper page; GPT-6 Sol and GPT-5.6 Terra cost about 20× more and misread the same lettering. Luna's one miss was an ornate blackletter masthead.

## How the prompt is built

`studioPrompt` in `convex/lib/prompts.ts` assembles the parts in this order; the creator's request comes last and wins any conflict:

1. **Task and rules**: one design on a transparent background, print-ready (or the grid rules).
2. **Attached images**: "Image 1: a smiling woman in a park", "Image 2: vintage picnic illustration (style only: use its look, never its subjects or words)". Images in the mixer that aren't numbered images are attached after them.
3. **Keep**: study the numbered images closely and keep their composition. With no style, keep their look and each person's likeness. With a style, keep each person recognizable by what identifies them (hair, skin tone, glasses, freckles, age, expression, clothing) but redraw their faces and bodies the way the style draws people.
4. **Notes on each numbered image**: all of them with no style; only the content sections when a style is chosen.
5. **Style mix**: one style "sets the whole look"; with several, the largest share leads (sets technique, line work, color, lettering, and figure drawing) and each smaller share must be "clearly visible in every design, not a faint hint" through its top two or three signature traits. Styles within 10 points share the lead. The leading style's figure drawing is stated as a requirement, including for people from photos.
6. **Style definitions**: the style sections of each style's notes.
7. **Request**: the creator's words, with any words in capitals or quotes spelled letter by letter, and new words replacing old ones.

Unit tests: `tests/unit/studioPrompt.test.ts`.

### What the tests showed

- **Copying a style.** With the old "use as inspiration" wording, two of four designs drifted into other styles. Telling the model to study the image closely kept all four in the reference's style.
- **Words.** With a reference whose words read GROW SLOW, the model wrote GRASH ROYALTY for "TRASH ROYALTY" in all four designs, or kept GROW SLOW and put the new words on a crown. Spelling the requested words letter by letter, keeping the reference's own words out of the notes, and saying "take the design's words from the request" fixed it: 8 of 8 correct.
- **Mixing.** The model gives each style about three visible levels: off, a visible accent, or leading. At 80/20 the smaller style vanished until the prompt required it to show in every design; then it showed in all four. 50/50 blends clearly. With three styles, the model spread them across the four designs instead of blending all three into each. The prompt still sends exact percentages, so finer settings will show as models improve.
- **A photo in a style.** A photo of a woman plus a 70s poster of elongated figures: the first prompt kept her realistic face in all eight designs. Separating likeness from figure drawing (in the notes and in the prompt) gave three of three single designs her hair, glasses, freckles, sweater, and smile with the poster's longer face, long neck, and simplified features. The studio's batches still render her closer to realistic, so the stretch is weaker there than in the direct test; stronger wording or a second pass is the next thing to try.
- **Color blocks.** Asked for four solid rectangular posters, the model left the space around every panel transparent, and the cutter cut all four.

## What stays on the server

Nothing the vision model writes about an image, and no prompt, reaches the browser. The browser sends image IDs, slider values, and the creator's own words. `imageGen.runTile`, an internal Convex action, builds the prompt and sends it straight to the image model, and no prompt is stored. A member can still guess a style by looking at the images, but the notes and our wording are never shown.

- `images.status` and `images.library` return an image's URL and whether its notes are pending, ready, or failed, never the notes, summary, or kind. The studio names a style by where it came from ("Image 1's look", "Style image") and shows a mix as thumbnails with their shares.
- A failed design shows one of a few fixed messages (`publicTileError` in `convex/lib/imageErrors.ts`). The raw error stays in `generations.error`, because a provider's error text, or the model's own reply on the ChatGPT path, can quote the prompt.
- Every public function declares the fields it returns, and Convex refuses to return a field that isn't declared, so a new field on `userImages` can't reach the browser by accident.
- No browser code imports prompt code. `tests/unit/clientBoundary.test.ts` follows every import from `src/` and fails if it reaches a `convex/` file outside a short list of files that are safe in the browser (`_generated/api.js`, `lib/authz.ts`, `lib/colors.ts`, `lib/username.ts`). The shop page's shirt-color names moved from `prompts.ts` to `lib/colors.ts` for this.
- The style library from Style Of will follow the same rule: its style definitions live in Convex, public queries return a style's name, category, and preview images, and a member's pick reaches the server as an ID and a slider value. Keep the definitions out of this repository.
- This repository is public for judging, so the prompt templates in `convex/lib/prompts.ts`, and this README, can be read on GitHub until it's made private. The notes for each image and the prompts built from them live only in the database.

## Upscaling for print

fal's Topaz Transparent (`topaz/upscale/image/transparent`, https://fal.ai/models/topaz/upscale/image/transparent) always enlarges 4× and keeps the alpha channel, with PNG output. It costs $0.08 per started 24 megapixels of output, so any grid design (about 3,200×3,600 after upscaling, roughly 12 MP) is 8¢, and a 1024×1536 single design (about 25 MP) is 16¢.

On seven grid designs: transparency was kept every time (clear areas stayed 100% clear, alpha matched 99.99–100% when shrunk back), colors stayed within 1.5–6.6 of 255, no dark rims appeared at edges, and lettering came out sharper than a plain enlargement. Topaz Precision returned no alpha at all, so it can't be the fallback. The image model paints "solid" areas at alpha 240–254, so the print file rounds those up to 255.

Plan: upscale only when someone orders a print, right after payment, using the design's pre-upscale original. Upscaled images are never sent back to the image models. An automatic check compares the upscale with the original (transparency kept, colors close, no haze); a design that fails gets one retry, then waits for the owner. A side-by-side viewer of the print file for spot checks is at `.tmp/flow/upscale/` (served from `screen -S cr-screens`).

## What the printers need

| | Printful | Printify |
|---|---|---|
| Resolution | At least 150 DPI at the printed size for most products; best not to exceed 300. Phone cases and stickers need 300. | 300 DPI recommended |
| Shirt front area | Bella+Canvas 3001: 15 × 18 in on sizes L–5XL; XS–M get the same file scaled to about 11.5 × 13.8 in (76.7%), uncropped, unless a separate file is uploaded | Varies by product; the usual full front is 15 × 18 in |
| Full-front file | 2,250 × 2,700 px at 150 DPI; 4,500 × 5,400 px at 300 | 4,500 × 5,400 px |
| File | PNG preferred (transparency), sRGB IEC61966-2.1, up to 200 MB and 20,000 × 20,000 px | Transparent sRGB PNG, up to 100 MB |

Sources: Printful's DTG guide (https://www.printful.com/creating-dtg-file) and help center (https://help.printful.com/hc/en-us/articles/50264010605457-What-is-DPI-resolution-and-actual-print-file-size, https://help.printful.com/hc/en-us/articles/50264397552657-How-is-my-design-scaled-for-different-garment-sizes, https://help.printful.com/hc/en-us/articles/50264019148177-How-should-I-prepare-my-print-file-for-the-best-results); Printify's help center (https://help.printify.com/hc/en-us/articles/4483601892497-What-dimensions-should-my-design-be, https://help.printify.com/hc/en-us/articles/4483617936657-What-type-of-print-files-does-Printify-require). Printify also notes that labeling a file 300 DPI adds no detail.

What our designs reach (the plan's print check: 150 DPI passes, 200 is great):

| Design | Width | 10 in print | 12 in print | 15 in print |
|---|---|---|---|---|
| Grid design as generated | ~650–900 px | 66–90 DPI | 55–75 DPI | 44–60 DPI |
| Single 1024×1536 design | 1,024 px | 102 DPI | 85 DPI | 68 DPI |
| Grid design after Topaz 4× | 2,628–3,256 px | 263–326 DPI | 219–271 DPI | 175–217 DPI |

So every design needs the upscale for a full-front print, and after it a 15-inch print sits around Printful's 150 minimum to the 200 mark, and 12 inches is comfortably "great." Shrunk to 11.5 inches on small sizes it's about 229–283 DPI.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Convex | Gateway key for image and notes calls |
| `IMAGE_PROVIDER` | Convex, optional | `gateway` or `chatgpt` forces that provider; unset uses ChatGPT when its token is set, else the gateway |
| `IMAGE_QUALITY`, `PHOTO_QUALITY` | Convex, optional | `low`, `medium` (default), or `high` for designs and model photos |
| `STYLE_NOTES_MODEL` | Convex, optional | Model for image notes; default `openai/gpt-6-luna` |
| `FAL_KEY` | Convex (future), `~/.config/cultremix/fal.env` | fal key for upscaling; production needs its own key with a spend limit |
