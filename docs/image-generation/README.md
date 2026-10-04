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

The studio makes each batch as one grid at high quality (`GRID_QUALITY`, default `high`): about 10–11¢ of image cost for four designs, charged 2 credits. Single designs (the ChatGPT path, or `STUDIO_LAYOUT=single`) and model photos use `IMAGE_QUALITY` and `PHOTO_QUALITY` (default `medium`). A grid also reads each input image once per batch instead of four times.

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

**In the studio** (since 2026-10-02), each batch is one grid call (`imageGen.runBatch`). The four cut designs each get their own folder with copies, and the whole grid is kept at `grids/<sha256>/original.png` for checking cuts. A batch costs 2 credits, charged once. A quarter that comes back `merged` or `empty`, or a failed or blocked call, gives credits back: 1 for one or two missing designs, 2 for three or four (`convex/lib/studioRules.ts`); the batch line says "1 credit back". Cutting and storing take about 3 s after the image arrives (1.7 s to cut on Convex's servers, 1.3 s to store four designs with their copies); when Convex's servers were busy it took up to 16 s. In six studio batches on dev (words only, twice; a photo and a poster; a lion design as the style for a dragon; a remix; a photo and a pop-art portrait), all 24 designs cut cleanly and no credits came back. The ChatGPT path and `STUDIO_LAYOUT=single` still make four separate calls at 1 credit each.

## The studio: images and the style mixer

The studio has two inputs, and where an image is added decides its job:

- **Images** (numbered 1–8 above the prompt box) are what to work on: their people, words, characters, and layout. With no style in the mixer they keep their own look, so "Change the words to GROW WILD" just works.
- **The style mixer** (closed by default, below the prompt box) holds up to four styles, each with a 0–100 slider. Nothing joins the mix on its own: a member uploads a style image ("Upload a style image" opens a picker with their past style images first, then their other images, or upload from the computer), drops one on the mixer, adds an image's look with "+ Image 1", or picks "Use as style" on a design.
- **Naming a style in words works the same as the mixer.** With a photo as image 1 and a poster as image 2, "Reimagine image 1 in the style of image 2" builds exactly the prompt the mixer would: image 2 becomes a style at full strength, and because the request names it only for its look, its people and words stay out. Other ways of saying it count too: "image 2's style", "the same style as image 2", "make it look like image 2", "use image 2 as the style", "the second image", "the styles of images 2 and 3". If the mixer already has a slider on for that image, its value is used. "Keep image 1's look" and "not the style of image 1" don't make an image a style. GPT-6 Luna reads the request on the server before each grid batch (`convex/lib/roleReader.ts`, reasoning off, about 1 s; the four-call path uses the phrases) and decides, for each numbered image, whether the request wants what's in it, only its look, or both. The phrases above (`namedStyles` in `convex/lib/prompts.ts`) decide when it can't answer. On 16 requests written to be tricky, Luna read 14 as intended, and the other two defensibly, where the phrases alone read 8: it caught "make her look like she belongs in the second picture", "draw the woman the way the poster draws people", "a dragon in this style", and "remix this with the colors of image 2", and left "swap the lion for my cat" and "put the woman into the picnic scene" as content. Each batch saves what was read, so its line shows a style named in words with the same thumbnails and shares as the mixer.
- **Limits.** Up to 8 numbered images and 4 styles. One call took 16 images in testing and kept every image's subject (see the tests below); each image adds about 0.7–1.3¢ per batch, depending on its size.

Sliders become shares: two styles at 100 are 50/50, 100 and 50 are 67/33, zero is off. Each row shows its real share.

The prompt placeholder follows the images: "Describe your design…" with none, "Change the words, colors, characters…" with one, and "Refer to them as image 1 and image 2…" with more.

## Notes for every image

When an image first comes into the studio, `convex/imageNotes.ts` asks GPT-6 Luna for notes with `STYLE_NOTES_PROMPT`, and `userImages` stores them once per member and image (matched by SHA-256), so reusing an image costs nothing. Transparent images go to Luna on flat gray with a note saying so, since vision models read clear pixels as black. The notes have these parts:

- **Summary** and **Kind** (photo or art): the image's short name in prompts. Neither is shown in the studio (see "What stays on the server").
- **Subject and layout**, **Words** (every piece of text, most prominent first, with its exact spelling, role, position, size, and lettering), **People and characters** (who is in it and what makes each person recognizable, without naming anyone).
- **Technique**, **Color** (with hex codes), **Line and shading**, **Lettering** (the overall approach), **Figure drawing** (how the image draws faces and bodies compared with real proportions, with numbers where possible), and ranked **Signature traits**.

The first group is content; the second is style. A person's likeness is content; the way an image draws faces is style. The prompt uses each half where it belongs.

**Published designs keep their notes.** When a design is published, `imageNotes.analyzeWork` writes notes for it once (or copies the creator's own notes for the same file) and keeps them on the work. Anyone who remixes it gets those notes the moment the design enters their studio, so a remix never waits on Luna. `bunx convex run imageNotes:backfillWorks` writes them for designs published earlier.

GPT-6 Luna read stylized lettering right in 9 of 9 tries and listed 16 separate pieces of text on a newspaper page; GPT-6 Sol and GPT-5.6 Terra cost about 20× more and misread the same lettering. Luna's one miss was an ornate blackletter masthead.

## How the prompt is built

`studioPrompt` in `convex/lib/prompts.ts` assembles the parts in this order; the creator's request comes last and wins any conflict:

1. **Task and rules**: one design on a transparent background, print-ready (or the grid rules).
2. **Attached images**: "Image 1: a smiling woman in a park", "Image 2: vintage picnic illustration (style only: use its look, never its subjects or words)". Images in the mixer that aren't numbered images are attached after them. "Style only" marks images added only in the mixer and numbered images the request names only for their look; a single image in the top row is never marked, so "Change the words" keeps its lion, people, and layout.
3. **Keep**: study the numbered images closely and keep their composition. With no style, keep their look and each person's likeness; if the request asks for a different style, draw everything that way and keep people recognizable within it. With a style: "keep the recognizable likeness of every person and animal in image 1, such as their hair, glasses, and freckles, so someone who knows them would recognize them, while drawing them fully in the style." (The likeness test below compared this with three other wordings.)
4. **Notes on each numbered image**: all of them with no style; with a style, only its scene ("Subject and layout") and its words. The "People and characters" notes describe real faces and kept faces from taking on the style (see the tests below); the model keeps people recognizable from the image itself.
5. **Style mix**: one style "sets the whole look"; with several, the largest share leads (sets technique, line work, color, lettering, and figure drawing) and each smaller share must be "clearly visible in every design, not a faint hint" through its top two or three signature traits. Styles within 10 points share the lead. The leading style's figure drawing is stated as a requirement, including for people from photos.
6. **Style definitions**: the style sections of each style's notes.
7. **Request**: the creator's words, with any words in capitals or quotes spelled letter by letter, and new words replacing old ones.

Unit tests: `tests/unit/studioPrompt.test.ts`.

### What the tests showed

- **Copying a style.** With the old "use as inspiration" wording, two of four designs drifted into other styles. Telling the model to study the image closely kept all four in the reference's style.
- **Words.** With a reference whose words read GROW SLOW, the model wrote GRASH ROYALTY for "TRASH ROYALTY" in all four designs, or kept GROW SLOW and put the new words on a crown. Spelling the requested words letter by letter, keeping the reference's own words out of the notes, and saying "take the design's words from the request" fixed it: 8 of 8 correct.
- **Mixing.** The model gives each style about three visible levels: off, a visible accent, or leading. At 80/20 the smaller style vanished until the prompt required it to show in every design; then it showed in all four. 50/50 blends clearly. Three styles (100/50/50, one 2×2 grid call asking for the same mix in every square): the lead style's lettering and the glitter showed in all four squares, but the woodblock style landed almost entirely in one square instead of blending into each. The prompt still sends exact percentages, so finer settings will show as models improve.
- **A photo in a style.** A photo of a woman plus a 70s poster of elongated figures: the first prompt kept her realistic face in all eight designs. Separating likeness from figure drawing (in the notes and in the prompt) gave three of three single designs her hair, glasses, freckles, sweater, and smile with the poster's longer face, long neck, and simplified features, but studio batches stayed rounder.
- **The photo's own notes were holding the style back** (2026-10-01, "Reimagine image 1 in the style of image 2", four designs each, same images): with all of the photo's notes, all eight designs had her round face and the photo's park and skyline; with only its scene and words, faces narrowed and the park stayed; with no notes, all four took the poster's long, narrow faces and pointed chins, and the setting gave way to the poster's sun, hills, and flowers. Hair, glasses, freckles, earrings, smile, and sweater were kept in all three. The prompt now sends a photo's scene and words, not its description of faces, when a style is chosen.
- **A style named in words.** The same request with both images in the top row and the mixer empty now sends the mixer's prompt (4,672 characters on dev, against about 6,300 before, which asked the model to keep image 2's two picnic women and its words).
- **Changing words on one image.** A lion design reading KING OF THE BLOCK, alone in the top row, with "Change the words to NIGHT SHIFT": four of four kept the lion and the arched varsity lettering and read NIGHT SHIFT.
- **Color blocks.** Asked for four solid rectangular posters, the model left the space around every panel transparent, and the cutter cut all four.
- **Likeness wording** (2026-10-02; the photo of a woman with red curls, round glasses, freckles, and a gap-tooth smile, restyled by the 70s poster and by a pop-art portrait with neon-pink hair, lavender skin, and dot freckles; four wordings of the "Keep" step, four designs each, medium quality): (1) the earlier wording, which listed identifying traits, said the style decides how they're drawn, forbade keeping real face shapes, and let the style's own treatment of hair, freckles, or palette win; (2) "keep the recognizable likeness … so someone who knows them would recognize them, while drawing them fully in the style"; (3) the same with "such as their hair, glasses, and freckles"; (4) the earlier wording without the face-shape rule. All 32 kept her recognizable: curls, glasses, earrings, sweater, and in the pop-art style her gap tooth in nearly every design. All took the style's way of drawing faces: the poster's long faces and pointed chins, and pop-art's big lashed eyes, lavender skin with cyan shadows, and dot freckles. A GPT-6 Luna judge scored them alike: likeness 7.0–7.8 and style 8.5–9.0 with the 70s poster, likeness 7.8–8.0 and style 8.5–8.8 with pop-art, and the style's face proportions in 30 of 32. Listing traits didn't hold the style back, and dropping the face-shape rule didn't bring realistic faces back (that came from the photo's own notes, removed on Oct 1). No wording turned her red hair pink; a request that asks for it wins. The prompt now uses wording 3, the shortest that states the intent. Boards: `.tmp/flow/tests/likeness-*.jpg`; scripts `likeness2.ts` and `judge.ts`.
- **Reading the request with a model** (2026-10-02, `roles.ts`): see "Naming a style in words" above. Reasoning off answered in about 1 s with the same accuracy as low effort (about 3 s).
- **How many images one call takes** (2026-10-02, Sunburst through the gateway, medium, a sticker sheet asking for one sticker per image): 4, 6, 8, 12, and 16 images all worked, and a judge found every image's subject on every sheet, each drawn in its own image's look (the photo stayed photographic, the lion kept KING OF THE BLOCK, the newspaper kept its headline). Transparency held every time. Each image up to 1024 px adds about 830 input tokens (0.66¢); 16 images made a 12¢ call that took 86 s, against 54 s for four (all five ran at once).

## What stays on the server

Nothing the vision model writes about an image, and no prompt, reaches the browser. The browser sends image IDs, slider values, and the creator's own words. `imageGen.runTile`, an internal Convex action, builds the prompt and sends it straight to the image model, and no prompt is stored. A member can still guess a style by looking at the images, but the notes and our wording are never shown.

- `images.status` and `images.library` return an image's URL and whether its notes are pending, ready, or failed, never the notes, summary, or kind. The studio names a style by where it came from ("Image 1's look", "Style image") and shows a mix as thumbnails with their shares.
- A failed design shows one of a few fixed messages (`publicTileError` in `convex/lib/imageErrors.ts`). The raw error stays in `generations.error`, because a provider's error text, or the model's own reply on the ChatGPT path, can quote the prompt.
- Every public function declares the fields it returns, and Convex refuses to return a field that isn't declared, so a new field on `userImages` can't reach the browser by accident.
- No browser code imports prompt code. `tests/unit/clientBoundary.test.ts` follows every import from `src/` and fails if it reaches a `convex/` file outside a short list of files that are safe in the browser (`_generated/api.js`, `lib/authz.ts`, `lib/colors.ts`, `lib/username.ts`). The shop page's shirt-color names moved from `prompts.ts` to `lib/colors.ts` for this.
- The style library from Style Of will follow the same rule: its style definitions live in Convex, public queries return a style's name, category, and preview images, and a member's pick reaches the server as an ID and a slider value. Keep the definitions out of this repository.
- This repository is public for judging, so the prompt templates in `convex/lib/prompts.ts`, and this README, can be read on GitHub until it's made private. The notes for each image and the prompts built from them live only in the database.

## Storage and sizes

Every image is kept in up to four versions:

| Version | Size | Format | Kept in | Used for |
|---|---|---|---|---|
| Original | as made: 1024×1536 designs, ~650–900 px wide grid cuts, 1024×1024 model photos, uploads up to 1024 px | PNG (uploads keep JPEG or WebP) | public bucket | Download, Open full size, publishing, sending to the image models, the viewer and shop page once loaded |
| Medium | fits inside 1200 px, never enlarged | WebP, quality 82 | public bucket | studio tiles, the feed, shop pages, the first frame of the viewer |
| Thumbnail | fits inside 400 px | WebP, quality 78 | public bucket | session cards, image and style chips, the image tray, the style picker |
| Print upscale | Topaz 4× (see below) | PNG | public bucket, under its own code (Print Studio) | the printer's file and the owner's spot check |

Both copies keep transparency (alpha quality 90). On dev's 52 images, the originals total 136.6 MB, the mediums 14.5 MB, and the thumbnails 2.2 MB, and all 47 transparent designs stayed transparent. The blank studio's session cards now load 28 thumbnails, about 1.2 MB, where they used to load the same number of full PNGs.

**Where they live.** Each environment has one public R2 bucket, `cultremix-dev-public` and `cultremix-prod-public`, served from its r2.dev address with a one-year immutable cache. It's organized the way the product is, and everything that isn't public on a page carries a random code in its path (`convex/lib/sizes.ts`):

```
members/<member>/uploads/<date>-<code>/                     an upload: original.jpg (or png, webp), medium.webp, thumb.webp
members/<member>/sessions/<date>-<session>/batch-01/
    grid-<code>.png                                         the 2x2 grid the batch's four designs were cut from
    design-1-<code>/ ... design-4-<code>/                   each design: original.png, medium.webp, thumb.webp
works/<family>/<expression>/                                a published work: original.png, medium.webp, thumb.webp
works/<family>/<expression>/photos/<n>/                     its model photos (a reshoot takes the next n)
works/<family>/<expression>/print-<code>/print.png          its print file
```

**Unguessable links.** `<code>` is 26 lowercase base32 characters, 128 bits from the platform's cryptographic random source (`convex/lib/codes.ts`), made when the file is saved. Every upload, design, grid, and print file has its own code, so a link gives nothing away about any other file: someone with one design's link can't reach the other designs in its batch, the batch's grid, the member's uploads, or a work's print file. The bucket can't be listed through its public address (the root, folder paths, and S3-style list requests all return 404), so the exact link is the only way to a file. Studio links appear only in the member's own studio and public pages show only `works/` files, which are public anyway, so those paths stay readable (`works/101/001/original.png`). If a link ever leaked, moving that one folder to a new code would retire it.

**Folder names.** `<member>` and `<session>` are Convex IDs, and `<date>` is the Pacific date the session started or the upload arrived, so folders list in order in the Cloudflare dashboard. Batches are numbered within their session (`batches.number`, counted by `creativeSessions.batchCount`). Publishing copies the design and its two copies into `works/<family>/<expression>/`; the session keeps its own copy, so its history stays complete. A file's SHA-256 lives in the database (`generations.sha256`, `userImages.sha256`, and `works.contentHash`, the fingerprint the shop page shows and the registry records). The same photo uploaded twice by one member is stored once (`images.findUpload` matches the hash); two members' copies stay in their own folders.

Without R2 keys, `IMAGE_STORE=convex` keeps images in Convex file storage (`cvx:<id>` keys, served by the `/img/` route). Before launch, the production bucket should get a custom domain (such as `img.cultremix.com`, in the bucket's Settings under Custom Domains): Cloudflare rate-limits r2.dev addresses (heavy traffic gets 429 Too Many Requests and slower downloads) and recommends them only for development, while a custom domain adds Cloudflare's cache (https://developers.cloudflare.com/r2/buckets/public-buckets/). Keys are stored without the address, so the switch is one change to `R2_PUBLIC_URL`, and the bucket's CORS rules carry over.

**No content credentials.** The image model writes a C2PA content credential into every PNG it returns (a `caBX` chunk). CultRemix doesn't keep it. `convex/lib/pngMeta.ts` removes that chunk, along with any text, EXIF, and timestamp chunks, from the model's output before anything hashes, cuts, or stores it; the pixel data and the chunks that change how pixels look (transparency, gamma, color space, density) are kept byte for byte. Designs cut from a grid were already clean, since the cutter encodes them from pixels, and so were uploads: the browser redraws each one on a canvas before sending it, which also drops EXIF and any location data. Hashes are taken after the metadata is removed, so a published work's fingerprint on its shop page is the SHA-256 of its file as stored.

**How the copies are made.** `convex/lib/storage.ts` resizes with sharp, which Convex installs on its Node runtime (`convex.json` lists it). A new design or model photo is uploaded at the same time as its two copies are made and uploaded, and the tile appears only when all three are stored, so no page loads the PNG first. With warm servers that takes 0.65–1.1 s per design (the original's upload is about 0.4 s of it); the first designs after a deploy took 2.3–2.6 s. Uploads get their copies right after they're stored; a published design is the same file, so it already has them. The `imageSizes` table maps an original's key to its copies, and queries return `url` (the original) with `thumbUrl` and `mediumUrl`, which fall back to the original until the copies exist. Saving to R2 is one direct upload per file: the R2 component's own `store()` adds a lookup and a separate action that records each object, which this app never reads, and that doubled the time to save a design.

**Older images.** Three jobs bring older images into this layout; each can run again. `bunx convex run sizing:organize` (add `--prod` for production) first numbers every session's batches in the order they were made, then moves designs into their session's batch folders, uploads into each member's uploads folder (one member's file never lands in another's), each grid beside its designs, model photos into their work's `photos/1/`, and published art into `works/`. Designs, model photos, grids, and published art lose the image model's metadata on the way. Files come from Convex storage or any older R2 layout (one folder per SHA-256 under `designs/`, `uploads/`, and `grids/`; flat `gen/`, `art/`, `photo/`, and `inspo/` files with copies under `sizes/`). Each row is patched as soon as its file is in place, and moves are recorded in `storageMoves` so a file several rows share is copied once; a published work's art that a remix used as its image follows the work. A second run reports moved 0. `bunx convex run sizing:backfill` then makes any copies still missing. `bunx convex run sizing:cleanup` deletes everything left in the older layouts and all of Convex file storage; it refuses, deleting nothing, while any table still points outside the current layout, and never deletes a file a table uses. On dev (Oct 3), organize moved 117 items with no failures, a second run moved nothing, the backfill found every copy in place, and new batches and publishes then saved straight into the new layout.

**Print files.** A work's print file goes in its work's folder under its own code (`works/<family>/<expression>/print-<code>/print.png`, built in the Print Studio) and is never shown on a page; the printer and the owner's spot check get its link.

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
| `GRID_QUALITY` | Convex, optional | Quality of the studio's grid call; default `high` |
| `STUDIO_LAYOUT` | Convex, optional | `single` makes four separate designs per batch at 1 credit each instead of one grid at 2 credits |
| `FAL_KEY` | Convex (future), `~/.config/cultremix/fal.env` | fal key for upscaling; production needs its own key with a spend limit |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL` | Convex | The environment's public bucket and its address |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Convex, `~/.config/cultremix/r2.env` (`_DEV` and `_PROD` values) | R2 access for that bucket only; images go to R2 whenever these are set. (The Cloudflare token they come from, `R2_TOKEN_*` in the same file, isn't read by the app.) |
| `IMAGE_STORE` | Convex, optional | `convex` keeps images in Convex storage while the R2 keys are missing |
