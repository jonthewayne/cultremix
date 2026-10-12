# Image test suite: cases

Rendered from [cases.ts](cases.ts) by `bun run test:image --catalog`; don't edit by hand. How to run the suite: [README.md](README.md).

Pinned to `gpt-image-2.5`: `openai/gpt-image-2.5-sunburst` with images, `openai/gpt-image-2.5-flare` without, grids 1920x1920 at high quality; `openai/gpt-6-luna` for notes, the request reader, the remix comparison, and the checker's questions; `google/gemini-3.1-pro-preview` reads each design's words, for the checker and the spelling check.

109 cases: 4 words, 8 styles, 5 people, 11 remixes, 2 grid and layout, 3 model photo, 10 image notes (gpt-6 luna), 25 request reader (gpt-6 luna), 18 remix comparison (gpt-6 luna), 7 remixable parts (gpt-6 luna), 16 spelling check (gemini 3.1 pro).

## Words

Spelling the request's words, and changing words on an image.

### `words-from-text`: Words from a request alone

A design made from a request alone spells its words exactly, in four clearly different compositions.

- Request: "A sunset badge that says DESERT PEOPLE CLUB"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: DESERT PEOPLE CLUB (4 of 4)
- Checks: Does the design show a desert scene or a sun (4 of 4)
- Checks, whole grid: Are the four designs clearly different from each other in composition or layout (1 of 1)
- First tested 2026-10-02

### `words-not-from-style`: The request's words, never the style's (known limit)

With a style image that has its own words (GROW SLOW), every design spells the request's words letter for letter and borrows none of the style's. Known limit: the style's letterforms sometimes leak into the new words, often in all four designs of a grid (GRASH, TrROH, TRROSH in 2 of 7 suite runs on 2026-10-05). A retest of the same prompt gave 20 of 20 designs right, so two candidate fixes (a copy of the style image with its words removed, and an instruction to letter every word fresh) couldn't be told apart from it. Since 2026-10-11 the studio's spelling check catches it after each batch (words-fix-spelling).

- Style mixer: `grow-slow` at 100
- Request: "A raccoon in a tiny crown that says TRASH ROYALTY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY; never GROW, SLOW, GRASH (4 of 4)
- Checks: Does the design show a raccoon wearing a crown (4 of 4)
- Checks: Is it drawn in the style of the style image: warped cream bubble lettering with layered colored outlines and dense psychedelic illustration (4 of 4)
- First tested 2026-10-01

### `words-fix-spelling`: Fix the spelling

A design whose words came out misspelled (TRASH drawn as TrROH, from words-not-from-style) gets the studio's Fix the spelling request, with the design as image 1: every design reads TRASH ROYALTY, in the raccoon design's lettering style, and at least two of the four keep its subject, layout, and style (the grid still varies composition, which is what lets the model letter the word fresh). Tested 2026-10-11: "Fix only the lettering … change nothing else" copied the wrong letters back (TrRSH, 0 of 4), and so did keeping image 1's composition in all four (0 of 4 spelled right, 4 of 4 kept); naming the misreading and asking for the word from scratch spelled it right in 4 of 4 in two grids, with 2 of 4 and then 4 of 4 keeping the design.

- Images: `trash-royalty-trroh`
- Request: "Fix the spelling in image 1: TRASH is drawn wrong; it reads trroh. Redraw that word from scratch with exactly its 5 letters, in the same lettering style, size, colors, and place, without reusing its current letter shapes. Keep everything else exactly as in image 1, in all four designs: the same drawing, colors, and layout. Change nothing else."
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY; never TRROH, TROH (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject, layout, and style (2 of 4)
- Checks: Does the design show a raccoon wearing a crown (4 of 4)
- First tested 2026-10-11

### `words-change-one-image`: Change the words on one image

One image and "change the words" keeps the image's subject and lettering style and swaps only the words.

- Images: `lion`
- Request: "Change the words to NIGHT SHIFT"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: NIGHT SHIFT; never KING, BLOCK (4 of 4)
- Checks: Does the design show a lion drawn the way the original image draws its lion: golden-brown detailed fur and mane with dark outlines (4 of 4)
- Checks: Is the lettering bold cream varsity capitals with dark outlines, like the original image's lettering (4 of 4)
- First tested 2026-10-01

## Styles

Copying a style, naming a style in words, and mixing styles by their sliders.

### `style-copy`: A style from the mixer (known limit)

A style image in the mixer sets the whole look for a new subject in all four designs, without its own subject, its subject's body parts, or its words. Known limit: at high quality a wolf drawn in the lion's style takes a lion-like mane in about half the designs (2026-10-05). The notes no longer list the mane as a trait, which cleared it at medium quality (12 of 12 wolves), but at high quality the mane comes from the style image itself: removing every mention of it from the prompt, or forbidding a style subject's body parts (which made it worse), left it in about half.

- Style mixer: `lion` at 100
- Request: "A wolf that says MOON CLUB"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: MOON CLUB; never KING, BLOCK (4 of 4)
- Checks: Does the design show a wolf (4 of 4)
- Checks: not: Is the main animal a lion rather than a wolf (3 of 4)
- Checks: not: Does the animal have a lion's mane: a thick ring of long, flowing hair framing its whole face (3 of 4)
- Checks: Is it drawn in the style of the style image: detailed engraved fur strokes in gold, brown, and black with heavy black outlines and a distressed print texture (4 of 4)
- First tested 2026-09-30

### `style-named-in-words`: "In the style of image 2"

Naming an image's style in words works like adding it to the mixer: the design takes its look, never its people or words.

- Images: `person`, `poster-70s`
- Request: "Reimagine image 1 in the style of image 2"
- Checks: four designs cut from one grid on a transparent background
- Checks: Is the woman from the photo recognizable, with round glasses and short curly red hair (4 of 4)
- Checks: Is it drawn like the style image: a 1970s illustrated poster look in muted mustard, olive, and rust (4 of 4)
- Checks: not: Does the design show more than one person (4 of 4)
- First tested 2026-10-02

### `style-of-one-image`: "A dragon in this style"

A single image named only for its look becomes a style: a new subject drawn its way, without its own subject or words.

- Images: `lion`
- Request: "A dragon in this style that says FIRE BREATHER"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: FIRE BREATHER; never KING, BLOCK (4 of 4)
- Checks: Does the design show a dragon (3 of 4)
- Checks: not: Is the main creature a lion rather than a dragon (3 of 4)
- Checks: Is it drawn in the style of the style image: detailed gold, brown, and black rendering with arched lettering (4 of 4)
- First tested 2026-10-02

### `mix-80-20`: Two styles at 80/20

A style at 20% still shows plainly in every design while the 80% style leads, through its way of drawing rather than its subject: until 2026-10-05 the pop-art style mostly showed as its woman's long pink hair on the raccoon.

- Style mixer: `grow-slow` at 80, `pop-art` at 20
- Request: "A raccoon in a tiny crown that says TRASH ROYALTY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY (4 of 4)
- Checks: Does style A lead the design: its dense, finely detailed psychedelic illustration with mushrooms, swirls, and layered colored outlines (4 of 4)
- Checks: Does any part of the design take style B's colors or shading, such as lavender or purple fur with cyan shadows, neon pink, or Ben-Day halftone dots (4 of 4)
- Checks: not: Does the raccoon have long flowing hair, like a person's (3 of 4)
- First tested 2026-09-30

### `mix-50-50`: Two styles at 50/50

Two styles at equal shares blend, each plainly visible in every design.

- Style mixer: `grow-slow` at 100, `poster-70s` at 100
- Request: "A smiling sun that says GOOD DAY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: GOOD DAY (4 of 4)
- Checks: Does the design clearly show style A's look: warped bubble lettering with layered colored outlines, or psychedelic swirls (4 of 4)
- Checks: Does the design also clearly show style B's look: soft 1970s illustration with grainy texture, airbrushed gradients, or rolling hills and landscape (3 of 4)
- First tested 2026-09-30

### `mix-three`: Three styles at 50/25/25

Three styles each show in every design, without the style images' own people. Since 2026-10-05 each smaller style gets a part of every design (the second colors the main subject, the third goes around it); before, the model gave a smaller style a design of its own and drew its image's woman or picnickers there (7 of 16 designs over four runs). With parts, 16 of 16 designs had the pop-art coloring on the raccoon and none had a person.

- Style mixer: `grow-slow` at 100, `pop-art` at 50, `poster-70s` at 50
- Request: "A raccoon in a tiny crown that says TRASH ROYALTY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY (4 of 4)
- Checks: Is the design mostly in the style of style A: warped bubble lettering with layered colored outlines (4 of 4)
- Checks: Is the raccoon's fur lavender or purple (4 of 4)
- Checks: Is there a 1970s-style landscape or sky in the design, such as mountains, a lake, pine trees, or a big sun with rays or wavy bands (3 of 4)
- Checks: not: Does the design show a woman or any other person (4 of 4)
- First tested 2026-09-30

### `mix-lettering-second`: A lettering style in second place

A smaller style known for its lettering goes on the lettering, and the leading style's own person stays out. With the pop-art portrait leading (50%), GROW SLOW (30%), and the 70s poster (20%): when parts went in size order, GROW SLOW was told to color the raccoon and its letters showed in 4 of 12 designs; with GPT-6 Luna picking each part, in 12 of 12. The pop-art notes' figure drawing described "the woman", and she appeared in 5 to 6 of 12 designs until the notes described figure drawing as a way of drawing: then 0 of 12, with the pop-art coloring on all 12 raccoons (2026-10-06, medium quality, three grids each). At high quality the same evening, Luna again put GROW SLOW on the lettering and the poster around the raccoon: letters in 4 of 4, no person.

- Style mixer: `pop-art` at 100, `grow-slow` at 60, `poster-70s` at 40
- Request: "A raccoon in a tiny crown that says TRASH ROYALTY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY (4 of 4)
- Checks: Are the words drawn as warped, inflated psychedelic bubble letters with several layered colored outlines (3 of 4)
- Checks: not: Does the design show a woman or any other person (4 of 4)
- First tested 2026-10-06

### `mix-quiet-lead`: A quieter style leading a louder one (known limit)

The style with the largest share sets the look of every design. Known limit: with the pop-art portrait leading at 50% and the busier GROW SLOW design at 30%, a checker asked which style each design is mostly in said GROW SLOW in 7 to 12 of 12 designs for every way of blending we tried, and the pop-art lead in 0 to 3; describing GROW SLOW by its lettering alone didn't change that (12 of 12). The image model seems to follow how strong a style looks more than its share (2026-10-06, medium quality, three grids each). At high quality the same evening, the pop-art drawing reached 1 or 2 of 4 raccoons (two checks of the same grid) and no design was mostly pop-art; the leader's lavender came and went between grids (4 of 4 raccoons in this case's grid, gray with cyan shading in mix-lettering-second's).

- Style mixer: `pop-art` at 100, `grow-slow` at 60, `poster-70s` at 40
- Request: "A raccoon in a tiny crown that says TRASH ROYALTY"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH ROYALTY (4 of 4)
- Checks: Is the raccoon drawn in a pop-art comic style, with heavy black outlines, flat saturated colors, and hard-edged shading, like style A (3 of 4)
- Checks: Is this design mostly in the look of style A (more than of style B or style C) (3 of 4)
- Checks: Is the raccoon's fur clearly lavender or purple? Answer no if the fur is gray, brown, or black and white with at most a faint purple tint. (3 of 4)
- First tested 2026-10-06

## People

Keeping a person recognizable while a style redraws them, head to toe.

### `photo-70s-poster`: A photo drawn as a 70s poster

A person from a photo stays recognizable while a style redraws them, face proportions included.

- Images: `person`
- Style mixer: `poster-70s` at 100
- Request: "Reimagine image 1 in this style"
- Checks: four designs cut from one grid on a transparent background
- Checks: Is the woman from the photo recognizable, with round glasses and short curly red hair (3 of 4)
- Checks: Is she drawn like the style image: a 1970s illustrated poster in muted mustard, olive, and rust (4 of 4)
- Checks: Is her face drawn longer and narrower than in the photo, the way the style image draws faces (3 of 4)
- Checks: not: Is the design a realistic photograph rather than an illustration (4 of 4)
- First tested 2026-10-01

### `photo-pop-art`: A photo drawn as pop art

The same with a pop-art portrait: the style's palette and dots, and her own hair color unless the request asks otherwise.

- Images: `person`
- Style mixer: `pop-art` at 100
- Request: "Reimagine image 1 in this style"
- Checks: four designs cut from one grid on a transparent background
- Checks: Is the woman from the photo recognizable, with round glasses and curly hair (4 of 4)
- Checks: Is she drawn like the style image: a pop-art comic look with flat bright color, heavy black outlines, and lavender or cyan skin (4 of 4)
- Checks: not: Is her hair pink (3 of 4)
- First tested 2026-10-02

### `photo-pop-art-pink-hair`: A hair color on request

A request can change a person's hair color while the style redraws them and her likeness stays: the prompt keeps each person's own hair color only unless the request says otherwise.

- Images: `person`
- Style mixer: `pop-art` at 100
- Request: "Reimagine image 1 in this style, with bright pink hair"
- Checks: four designs cut from one grid on a transparent background
- Checks: Is her hair pink (3 of 4)
- Checks: Is the woman from the photo recognizable, with round glasses and curly hair (4 of 4)
- First tested 2026-10-05

### `whole-figure`: A whole-body style, her own hair

A cartoon style redraws a person head to toe (long thin legs, big ears) while she keeps her glasses and her own hair.

- Images: `person`
- Style mixer: `cartoon-boys` at 100
- Request: "Draw image 1 as a full-body character, head to toe."
- Checks: four designs cut from one grid on a transparent background
- Checks: Is she shown full body, from head to toe (4 of 4)
- Checks: Are her legs long and thin like the figures in the cartoon style image (3 of 4)
- Checks: Are her ears large and sticking out from her head, like the figures in the cartoon style image (2 of 4)
- Checks: Is she wearing glasses (3 of 4)
- Checks: not: Is her hair drawn as tall pointed spikes standing straight up (3 of 4)
- First tested 2026-10-04

### `style-hair-when-asked`: The style's hair when asked

Asking for the style's hair gives the person the style's hair shape in her own hair color, keeping her glasses.

- Images: `person`
- Style mixer: `cartoon-boys` at 100
- Request: "Draw image 1 as a full-body character, head to toe, with the style's hair."
- Checks: four designs cut from one grid on a transparent background
- Checks: Is her hair drawn as tall pointed spikes standing straight up (3 of 4)
- Checks: Is she wearing glasses (3 of 4)
- Checks: Is her hair red or orange (3 of 4)
- First tested 2026-10-04

## Remixes

Remixing a published design by its word boxes and in words, with and without a style.

### `remix-words`: Remix one word

Changing a remixable word (SLOW to LOUD) puts the new word in all four designs and keeps everything else.

- Images: `grow-slow` (image 1 is the published design being remixed)
- Word boxes: SLOW to LOUD
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: GROW LOUD; never SLOW (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject, layout, and style (4 of 4)
- First tested 2026-10-04

### `remix-two-lines`: Remix two of three lines

Two changed lines at once, with the kept line, the art, and the lettering unchanged.

- Images: `offline-luxury` (image 1 is the published design being remixed)
- Word boxes: OFFLINE to UNPLUGGED, LUXURY to FLEX
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: UNPLUGGED IS THE NEW FLEX; never OFFLINE, LUXURY (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject, layout, and style (4 of 4)
- First tested 2026-10-04

### `remix-of-remix`: Remix a remix

A remix of a remix changes its own words (LOUD to BOLD) the same way.

- Images: `grow-loud` (image 1 is the published design being remixed)
- Word boxes: LOUD to BOLD
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: GROW BOLD; never LOUD (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject, layout, and style (4 of 4)
- First tested 2026-10-04

### `remix-free-text`: Remix in words, not boxes

A remix asked in words (a new background) keeps the subject, words, and look, and makes the change.

- Images: `slow-roll-night` (image 1 is the published design being remixed)
- Request: "a sunny daytime beach with a big sun instead of the night sky, moon, and stars"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: SLOW ROLL (4 of 4)
- Checks: Does the design show the same snail riding a skateboard as the original (4 of 4)
- Checks: Is the scene a sunny daytime beach (4 of 4)
- Checks: not: Does the design show a dark night sky or a moon (3 of 4)
- First tested 2026-10-04

### `remix-words-keep-look`: A word remix keeps the look

Without a style, a word remix keeps the original's look exactly.

- Images: `trash-royalty` (image 1 is the published design being remixed)
- Word boxes: ROYALTY to COUTURE
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH COUTURE; never ROYALTY (4 of 4)
- Checks: Does the design show the same raccoon with a crown and sunglasses (4 of 4)
- Checks: Does it keep the original's look: graffiti lettering with neon pink and cyan spray splatter (4 of 4)
- First tested 2026-10-04

### `remix-words-with-style`: A word remix with a style

A style in the mixer restyles a remix while its composition, subjects, and new words stay.

- Images: `trash-royalty` (image 1 is the published design being remixed)
- Style mixer: `pop-art` at 100
- Word boxes: ROYALTY to COUTURE
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: TRASH COUTURE; never ROYALTY (4 of 4)
- Checks: Does the design show a raccoon with a crown and sunglasses (4 of 4)
- Checks: Does it show the style image's pop-art look, such as lavender or cyan coloring or Ben-Day halftone dots (3 of 4)
- First tested 2026-10-04

### `remix-add-words`: Add words in a remix

A remix can add words in its request (SINCE 1999) and keep the design's own words.

- Images: `grow-slow` (image 1 is the published design being remixed)
- Request: "Add the words "SINCE 1999" in small letters under the mushroom."
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: GROW SLOW SINCE 1999 (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject, layout, and style (4 of 4)
- First tested 2026-10-04

### `remix-longer-and-removed`: Longer words and a removed word

A box can take much longer words (fitted smaller or over more lines), and an emptied box removes its words.

- Images: `grow-slow` (image 1 is the published design being remixed)
- Word boxes: GROW to GROW WILD AND FREE, SLOW emptied
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: GROW WILD AND FREE; never SLOW (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same subject and style (4 of 4)
- First tested 2026-10-04

### `remix-swap-character`: Swap the character

A remix that swaps the main character (a pencil-sketch lion to a wolf) keeps the sketch style, the layout, and the words, and stays a variation of the original.

- Images: `lion-sketch` (image 1 is the published design being remixed)
- Request: "Change the lion to a wolf"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: WILD AT HEART (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same layout and style (4 of 4)
- Checks: Does the design show a wolf (4 of 4)
- Checks: not: Is the animal a lion rather than a wolf (4 of 4)
- Checks: Is it drawn as a graphite pencil sketch with hatched shading (4 of 4)
- First tested 2026-10-05

### `remix-parts-family`: A family as Santa, Mrs. Claus, and the elves

A remix fills a design's remixable people and group with photos: dad becomes Santa, mom Mrs. Claus, and four relatives become the elves where the design has three, each recognizable, in the design's look, and it stays a variation.

- Images: `santa-elves` (image 1 is the published design being remixed)
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: MERRY BRIGHT (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same style (4 of 4)
- Checks: Are there exactly four elves (characters in green elf outfits and pointed hats), no more and no fewer (4 of 4)
- Checks: Does Santa have a short dark beard and rectangular glasses, rather than a long white beard (4 of 4)
- Checks: Does Mrs. Claus have long curly auburn or red hair (4 of 4)
- Checks: Is one of the elves a girl with two blond braids (4 of 4)
- Checks: Is one of the elves an older woman with short white hair and round glasses (4 of 4)
- First tested 2026-10-06

### `remix-parts-group-size`: More elves, Mrs. Claus left out

A group takes as many photos as the creator allows (six elves where the design has three), a person with no photo is left out when the creator's rule says so, and the remix still reads as a variation because the creator opened those parts.

- Images: `santa-elves` (image 1 is the published design being remixed)
- Request: (nothing typed)
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: MERRY BRIGHT (4 of 4)
- Checks: the remix comparison calls it image 1's design, a variation with the same style (4 of 4)
- Checks: Are there exactly six elves (characters in green elf outfits and pointed hats), no more and no fewer (4 of 4)
- Checks: not: Is there a Mrs. Claus, or any woman in a red Santa-style dress who isn't an elf (4 of 4)
- Checks: Does Santa have a long white beard (4 of 4)
- Checks: Is one of the elves a man with a short dark beard and rectangular glasses (4 of 4)
- First tested 2026-10-06

## Grid and layout

Four designs per call, cut apart cleanly on a transparent background.

### `color-blocks`: Solid color panels

Designs that are solid rectangles still come back on a transparent background, and the cutter cuts all four.

- Request: "A solid rectangular retro gig poster for a band called THE NIGHT OWLS, filling a full panel of color"
- Checks: four designs cut from one grid on a transparent background
- Checks: words read: NIGHT OWLS (4 of 4)
- Checks: Is the design one filled rectangle with straight outer edges, like a printed poster, even if it has a border or a frame inside it (4 of 4)
- First tested 2026-10-02

### `four-images`: Four images in one call

One call takes several images and uses each one's subject: asked for a sticker per image, the grid comes back as one design per image, each in its own image's look.

- Images: `lion`, `cat-photo`, `person`, `slow-roll-night`
- Request: "A sticker sheet with one sticker for each attached image, each showing that image's main subject drawn the way that image draws it"
- Checks: four designs cut from one grid on a transparent background
- Checks, whole grid: Across the four designs, do a lion, a cat, a woman with curly red hair and glasses, and a snail on a skateboard all appear (1 of 1)
- First tested 2026-10-02

## Model photo

The photo of a model wearing a published design.

### `model-photo`: Model photo

A street-style photo of a model wearing the design, with the graphic reproduced faithfully.

- Design: `grow-slow` on a #efe6d2 shirt
- Checks: words read: GROW SLOW (1 of 1)
- Checks: Is a person wearing a t-shirt with the design printed on the front (1 of 1)
- Checks: Does the printed graphic match the design: the same mushrooms and lettering (1 of 1)
- Checks: Is it a realistic photograph (1 of 1)
- First tested 2026-09-29

### `model-photo-hoodie-back`: Model photo: a hoodie printed on the back

The photo follows where the creator placed the design: a pullover hoodie with the design large on the back, shot from behind with the model looking over a shoulder.

- Design: `slow-roll-night` on a #ffffff shirt
- Worn as: a hoodie, printed on the back at 85% of Full, 8% down
- Checks: words read: SLOW ROLL (1 of 1)
- Checks: Is the person wearing a hooded sweatshirt (a hoodie) (1 of 1)
- Checks: Is the design printed on the back of the garment, with the person seen from behind (1 of 1)
- Checks: Does the printed graphic match the design: the same snail on a skateboard and the same lettering (1 of 1)
- Checks: Is it a realistic photograph (1 of 1)
- First tested 2026-10-10

### `model-photo-small-chest`: Model photo: a small print on the chest

A design placed Small near the top prints small on the upper chest, not across the whole front.

- Design: `grow-slow` on a #1b1b1c shirt
- Worn as: a tee, printed on the front at 40% of Full, 0% down
- Checks: Is a person wearing a t-shirt with the design printed on the front (1 of 1)
- Checks: Is the printed design small, covering well under half of the shirt's width (1 of 1)
- Checks: Is the design on the upper chest, closer to the collar than to the hem (1 of 1)
- Checks: Is the design centered left to right on the shirt, rather than off to one side like a pocket logo (1 of 1)
- Checks: Does the printed graphic match the design: the same mushrooms (1 of 1)
- First tested 2026-10-10

## Image notes (GPT-6 Luna)

What the notes capture from each image: its words, its look, how it draws people.

### `notes-words-grow-slow`: Notes read stylized lettering

The notes quote warped bubble lettering exactly.

- Image: `grow-slow`, a psychedelic mushroom t-shirt graphic, GROW SLOW (CR 101-001)
- Checks: Words quotes GROW and SLOW
- First tested 2026-10-01

### `notes-words-lines`: Notes read stacked lines

The notes quote every line of stacked typography.

- Image: `offline-luxury`, a vintage ocean-wave typography graphic, OFFLINE IS THE NEW LUXURY (CR 102-001)
- Checks: Words quotes OFFLINE, IS THE NEW, and LUXURY
- First tested 2026-10-04

### `notes-words-arched`: Notes read arched lettering

The notes quote arched varsity lettering exactly.

- Image: `lion`, a distressed lion-head t-shirt graphic with arched lettering KING OF THE BLOCK
- Checks: Words quotes KING OF THE BLOCK
- First tested 2026-10-01

### `notes-words-script-request`: Notes read heavy script with the design's request

A published design's notes, read with the request it was made from, quote a heavy brush-script name right, and still quote words the request never asked for.

- Image: `wanda-knows-best`, heavy white brush-script lettering with black shadows and speckled grain: Wanda, Knows best, Nothing else
- Checks: Words quotes WANDA
- Checks: Words quotes KNOWS BEST and NOTHING ELSE, which the request didn't ask for
- First tested 2026-10-11

### `notes-words-script-plain`: Notes read heavy script without a request (known limit)

The notes quote a heavy brush-script name right from the image alone. On 2026-10-11 they read WANDA as MAMA, the way production's script designs were misread, which is why published designs are read with their request.

- Image: `wanda-knows-best`, heavy white brush-script lettering with black shadows and speckled grain: Wanda, Knows best, Nothing else
- Checks: Words quotes WANDA
- First tested 2026-10-11

### `notes-newspaper`: Notes list every piece of text

On a newspaper page, the notes list the masthead, headline, and many separate pieces of text.

- Image: `newspaper`, a photo of a vintage newspaper front page, THE DAILY REMIX
- Checks: Words quotes THE DAILY REMIX
- Checks: Words quotes LOCAL CAT ELECTED MAYOR
- Checks: Words lists at least 10 separate pieces
- First tested 2026-09-30

### `notes-figure`: Notes describe how a style draws people

For a cartoon style, Figure drawing gives proportions in numbers and its Hair line names the style's spiky hair.

- Image: `cartoon-boys`, a cartoon of three tall boys with spiky hair, huge ears, and hoodies
- Checks: Figure drawing says how many heads tall, or the head's share of the height
- Checks: its Hair line names spikes
- First tested 2026-10-04

### `notes-photo`: Notes on a photo of a person

A photo is marked as a photo, and its Hair line describes her own curls.

- Image: `person`, a photo of a made-up woman with short copper-red curls, round glasses, freckles, and a gap-tooth smile in a park
- Checks: Kind is photo
- Checks: its Hair line describes her curls
- First tested 2026-10-04

### `notes-hair-portrait`: Notes describe a portrait's hair

The Hair line describes the hair's shape and texture without its color, so a request can ask for it on someone else.

- Image: `pop-art`, a pop-art comic portrait of a made-up woman with neon-pink hair and Ben-Day dot freckles
- Checks: its Hair line describes long waves or locks, without a color
- First tested 2026-10-04

### `notes-hair-poster`: Notes describe a poster's hair

The Hair line describes how the poster draws hair, long flowing waves, so a request can ask for it.

- Image: `poster-70s`, a 1970s poster of two friends at a picnic under a big sun, drawn as elongated caricatures
- Checks: its Hair line describes long flowing waves
- First tested 2026-10-04

## Request reader (GPT-6 Luna)

What a request wants from each numbered image, and whether it asks for the style's hair.

| Case | Images | Mixer | Request | Expected | Since |
|---|---|---|---|---|---|
| `reader-mixer-plain` | `person` | `cartoon-boys` | "Draw image 1 as a full-body character, head to toe." | content | 2026-10-04 |
| `reader-mixer-hair-words` | `person` | `cartoon-boys` | "Draw image 1 as a full-body character, head to toe, with her hair sticking straight up in spikes like the style." | content, style hair either way | 2026-10-04 |
| `reader-this-style` | `person` | `cartoon-boys` | "make her in this style, waving" | content | 2026-10-04 |
| `reader-cartoon-no-style` | `person` |  | "Draw her as a full-body cartoon character" | content | 2026-10-02 |
| `reader-style-of-image-2` | `person`, `poster-70s` |  | "Reimagine image 1 in the style of image 2" | content/style | 2026-10-02 |
| `reader-belongs` | `person`, `poster-70s` |  | "make her look like she belongs in the second picture" | content/style or content/both | 2026-10-02 |
| `reader-draws-people` | `person`, `poster-70s` |  | "draw the woman the way the poster draws people" | content/style | 2026-10-02 |
| `reader-dragon` | `lion` |  | "a dragon in this style" | style | 2026-10-02 |
| `reader-colors` | `lion`, `pop-art` |  | "remix this with the colors of image 2" | content/style | 2026-10-02 |
| `reader-swap` | `lion`, `cat-photo` |  | "swap the lion for my cat" | content/content | 2026-10-02 |
| `reader-into-scene` | `person`, `poster-70s` |  | "put the woman into the picnic scene" | content/content | 2026-10-02 |
| `reader-keep-look` | `grow-slow` |  | "keep image 1's look but change the words to GROW LOUD" | both or content | 2026-10-02 |
| `reader-negated` | `person`, `poster-70s` |  | "not the style of image 2, just put her on the picnic blanket" | content/content | 2026-10-02 |
| `reader-scene-and-mixer` | `person`, `poster-70s` | `cartoon-boys` | "put her on the picnic blanket from image 2, drawn in the style" | content/content | 2026-10-04 |
| `reader-words-and-mixer` | `grow-slow` | `cartoon-boys` | "change the words to GROW LOUD" | content | 2026-10-04 |
| `reader-like-lion` | `person`, `lion` |  | "draw her like the lion design" | content/style | 2026-10-02 |
| `reader-own-colors` | `person` | `pop-art` | "use image 1's colors with the style" | both | 2026-10-02 |
| `reader-colors-second` | `grow-slow`, `pop-art` |  | "use the colors from the second image" | content/style | 2026-10-05 |
| `reader-keep-own-colors` | `lion`, `pop-art` |  | "keep the lion's own colors but draw it like image 2" | both/style | 2026-10-05 |
| `reader-style-hair` | `person` | `cartoon-boys` | "Draw image 1 as a full-body character, head to toe, with the style's hair." | content, style hair | 2026-10-04 |
| `reader-cartoon-hair` | `person` | `cartoon-boys` | "give her the cartoon's spiky hair" | content, style hair | 2026-10-04 |
| `reader-hair-like-image-2` | `person`, `cartoon-boys` |  | "draw image 1 in the style of image 2, with hair like image 2" | content/style, style hair | 2026-10-04 |
| `reader-keep-curls` | `person` | `cartoon-boys` | "full body, and keep her curls" | content | 2026-10-04 |
| `reader-pink-hair` | `person` | `cartoon-boys` | "make her hair pink" | content | 2026-10-04 |
| `reader-mohawk` | `person` | `cartoon-boys` | "give her a mohawk" | content | 2026-10-04 |

## Remix comparison (GPT-6 Luna)

Whether a remix keeps its original's look and layout (a variation, even with a new subject or words) or restyles or rebuilds it (it may be a fork).

| Case | Original | Remix | Expected | Since |
|---|---|---|---|---|
| One word changed | `grow-slow` | `grow-loud` | variation | 2026-10-05 |
| A remix of a remix, one word changed | `grow-loud` | `grow-bold` | variation | 2026-10-05 |
| A small line of words added | `grow-slow` | `since-1999` | variation | 2026-10-05 |
| Words reworked and one removed | `grow-slow` | `grow-wild-free` | variation | 2026-10-05 |
| Two lines changed | `offline-luxury` | `unplugged-flex` | variation | 2026-10-05 |
| One word changed | `trash-royalty` | `trash-couture` | variation | 2026-10-05 |
| A new background, same subject and words | `slow-roll-night` | `slow-roll-beach` | variation | 2026-10-05 |
| All the words changed | `lion` | `lion-night-shift` | variation | 2026-10-05 |
| Identical | `grow-slow` | `grow-slow` | variation | 2026-10-05 |
| Restyled with pop art, same layout and lettering | `trash-royalty` | `trash-couture-pop` | either | 2026-10-05 |
| Restyled with a 70s poster, same layout and lettering | `trash-royalty` | `trash-couture-70s` | either | 2026-10-05 |
| The subject swapped, same look and layout | `lion` | `dragon` | variation | 2026-10-05 |
| The mushrooms swapped for a cactus, same look and lettering | `grow-slow` | `grow-slow-cactus` | variation | 2026-10-05 |
| A pencil-sketch lion swapped for a wolf | `lion-sketch` | `wolf-sketch` | variation | 2026-10-05 |
| Redrawn as pixel art, same layout and colors | `grow-slow` | `grow-slow-pixel` | fork | 2026-10-05 |
| A photo redrawn as a full-body cartoon | `person` | `person-cartoon` | fork | 2026-10-05 |
| A photo redrawn as a 70s poster | `person` | `person-70s` | fork | 2026-10-05 |
| An unrelated design | `grow-slow` | `slow-roll-night` | fork | 2026-10-05 |

## Remixable parts (GPT-6 Luna)

The characters, people, and groups the parts reader proposes from a design's notes, and the part it writes from a creator's words in Add a part.

### `parts-santa-elves`: Santa, Mrs. Claus, and three elves

Proposed parts: Santa and Mrs. Claus as people, and the elves as a group of three a remix can resize.

- Image: `santa-elves`, a vintage storybook Santa, Mrs. Claus, and three elves over a MERRY & BRIGHT banner
- Checks: Santa is a person
- Checks: Mrs. Claus is a person
- Checks: the elves are a group of 3
- Checks: people and groups are described by role and outfit, never their looks
- First tested 2026-10-11

### `parts-lion`: A lion-head graphic

Proposed parts: the lion as a character to swap, and no people.

- Image: `lion`, a distressed lion-head t-shirt graphic with arched lettering KING OF THE BLOCK
- Checks: the lion is a character
- Checks: no people or groups
- First tested 2026-10-11

### `parts-raccoon`: The crowned raccoon

Proposed parts: the raccoon as a character, and its lettering left to the word boxes.

- Image: `trash-royalty`, a graffiti raccoon in a crown and sunglasses, TRASH ROYALTY (CR 103-001)
- Checks: the raccoon is a character
- Checks: no part for its words
- First tested 2026-10-11

### `parts-words-only`: A typography design

A design that's mostly lettering gets no people or groups; its words are remixed by the word boxes.

- Image: `offline-luxury`, a vintage ocean-wave typography graphic, OFFLINE IS THE NEW LUXURY (CR 102-001)
- Checks: no people or groups
- First tested 2026-10-11

### `parts-add-elves`: "Let people add their family as elves, up to 8"

Add a part: the creator's words become the elves as a group of three, with the most a remix may have.

- Image: `santa-elves`, a vintage storybook Santa, Mrs. Claus, and three elves over a MERRY & BRIGHT banner
- The creator's words: "let people add their family as elves, up to 8"
- Checks: a group labeled elves
- Checks: 3 in the design, at most 8
- Checks: described by role and outfit only
- First tested 2026-10-11

### `parts-add-santa`: "People can put themselves in as Santa"

Add a part: the creator's words become Santa as a person drawn from a remixer's photo.

- Image: `santa-elves`, a vintage storybook Santa, Mrs. Claus, and three elves over a MERRY & BRIGHT banner
- The creator's words: "people can put themselves in as Santa"
- Checks: a person labeled Santa
- Checks: described by role and outfit only
- First tested 2026-10-11

### `parts-add-animal`: "Swap the lion for any animal"

Add a part: the creator's words become the lion as a character to swap.

- Image: `lion-sketch`, a pencil sketch of a lion's head under hand-lettered WILD AT HEART
- The creator's words: "people can swap the lion for any animal they like"
- Checks: a character labeled lion
- First tested 2026-10-11

## Spelling check (Gemini 3.1 Pro)

The studio's Typo? chip: a finished design's lettering read back letter for letter and compared with the words its batch asked for, flagging an asked word drawn a letter or two off and leaving lettering spelled right alone.

| Case | Design | Words checked | Flags | Since |
|---|---|---|---|---|
| TRASH drawn as TrROH | `trash-royalty-trroh` | TRASH ROYALTY | TRASH | 2026-10-11 |
| TRASH drawn as TRROSH, two letters off | `trash-royalty-trrosh` | TRASH ROYALTY | TRASH | 2026-10-11 |
| TRASH drawn as TRROW, three letters off | `trash-royalty-trrow` | TRASH ROYALTY | TRASH | 2026-10-11 |
| TRASH ROYALTY spelled right | `trash-royalty` | TRASH ROYALTY | none | 2026-10-11 |
| A remix's new word | `trash-couture` | COUTURE | none | 2026-10-11 |
| A remix of GROW SLOW to GROW LOUD | `grow-loud` | LOUD | none | 2026-10-11 |
| Two lines a remix changed | `unplugged-flex` | UNPLUGGED; THE NEW FLEX | none | 2026-10-11 |
| A style named in capitals isn't lettering | `grow-slow` | GROW SLOW; PSYCHEDELIC 1970S | none | 2026-10-11 |
| Four words | `grow-wild-free` | GROW WILD AND FREE | none | 2026-10-11 |
| A year in digits | `since-1999` | SINCE 1999 | none | 2026-10-11 |
| A long line in wave lettering | `offline-luxury` | OFFLINE IS THE NEW LUXURY | none | 2026-10-11 |
| Arched, distressed lettering | `lion` | KING OF THE BLOCK | none | 2026-10-11 |
| Lettering that may be read in pieces | `lion-night-shift` | NIGHT SHIFT | none | 2026-10-11 |
| Neon lettering | `slow-roll-night` | SLOW ROLL | none | 2026-10-11 |
| Hand lettering asked for in quotes | `lion-sketch` | Wild at Heart | none | 2026-10-11 |
| An ampersand on a banner | `santa-elves` | MERRY; BRIGHT | none | 2026-10-11 |

## Fixtures

Reference images in [fixtures/](fixtures/), all made by CultRemix's own image calls.

| Fixture | What it is | Made |
|---|---|---|
| `person` | a photo of a made-up woman with short copper-red curls, round glasses, freckles, and a gap-tooth smile in a park | Flare, 2026-09-30 |
| `poster-70s` | a 1970s poster of two friends at a picnic under a big sun, drawn as elongated caricatures | Flare, 2026-09-30 |
| `pop-art` | a pop-art comic portrait of a made-up woman with neon-pink hair and Ben-Day dot freckles | Flare, 2026-10-02 |
| `lion` | a distressed lion-head t-shirt graphic with arched lettering KING OF THE BLOCK | Flare, 2026-10-01 |
| `newspaper` | a photo of a vintage newspaper front page, THE DAILY REMIX | Flare, 2026-09-30 |
| `cat-photo` | a photo of an orange cat sitting on laundromat washing machines | Flare, 2026-09-29 |
| `grow-slow` | a psychedelic mushroom t-shirt graphic, GROW SLOW (CR 101-001) | dev works/101/001 |
| `grow-loud` | a psychedelic mushroom t-shirt graphic, GROW LOUD (CR 101-003, a remix of GROW SLOW) | dev works/101/003 |
| `offline-luxury` | a vintage ocean-wave typography graphic, OFFLINE IS THE NEW LUXURY (CR 102-001) | dev works/102/001 |
| `trash-royalty` | a graffiti raccoon in a crown and sunglasses, TRASH ROYALTY (CR 103-001) | dev works/103/001 |
| `slow-roll-night` | a neon snail on a skateboard under a night sky, SLOW ROLL (CR 104-001) | dev works/104/001 |
| `cartoon-boys` | a cartoon of three tall boys with spiky hair, huge ears, and hoodies | dev studio, 2026-10-04 |
| `trash-royalty-trroh` | a psychedelic raccoon in a crown whose lettering reads TrROH ROYALTY, a misspelled TRASH ROYALTY | suite run 20261005-1915, words-not-from-style design 1 |
| `trash-royalty-trrow` | the psychedelic raccoon in a crown with its lettering reading TRROW ROYALTY, TRASH three letters off | suite run 20261005-1915, words-not-from-style design 2 |
| `wanda-knows-best` | heavy white brush-script lettering with black shadows and speckled grain: Wanda, Knows best, Nothing else | Flare, 2026-10-11 |
| `trash-royalty-trrosh` | the psychedelic raccoon in a crown with its lettering reading TRROSH ROYALTY, TRASH two letters off | suite run 20261005-1915, words-not-from-style design 3 |
| `since-1999` | GROW SLOW with SINCE 1999 added under the mushroom | dev studio, 2026-10-04 |
| `grow-wild-free` | the mushroom design reading GROW WILD AND FREE | dev studio, 2026-10-04 |
| `grow-bold` | the mushroom design reading GROW BOLD | dev studio, 2026-10-04 |
| `unplugged-flex` | the wave design reading UNPLUGGED IS THE NEW FLEX | dev studio, 2026-10-04 |
| `trash-couture` | the raccoon design reading TRASH COUTURE | dev studio, 2026-10-04 |
| `trash-couture-pop` | TRASH COUTURE restyled with the pop-art portrait | dev studio, 2026-10-04 |
| `trash-couture-70s` | TRASH COUTURE restyled with the 70s poster | dev studio, 2026-10-04 |
| `slow-roll-beach` | SLOW ROLL with a sunny beach instead of the night sky | dev studio, 2026-10-04 |
| `lion-night-shift` | the lion design reading NIGHT SHIFT | dev studio, 2026-10-01 |
| `dragon` | a dragon in the lion design's style, FIRE BREATHER | dev studio, 2026-10-02 |
| `person-cartoon` | the woman from the photo as a full-body cartoon | dev studio, 2026-10-04 |
| `person-70s` | the woman from the photo drawn as a 1970s poster | dev studio, 2026-10-02 |
| `grow-slow-pixel` | GROW SLOW redrawn as pixel art, same layout and colors | dev studio, 2026-10-05 |
| `grow-slow-cactus` | GROW SLOW's lettering and frame around a desert cactus instead of the mushrooms | dev studio, 2026-10-05 |
| `lion-sketch` | a pencil sketch of a lion's head under hand-lettered WILD AT HEART | Flare, 2026-10-05 |
| `wolf-sketch` | the pencil-sketch lion design with a wolf in its place | remix of lion-sketch, Sunburst, 2026-10-05 |
| `santa-elves` | a vintage storybook Santa, Mrs. Claus, and three elves over a MERRY & BRIGHT banner | dev studio, Sunburst, 2026-10-06 |
| `family-dad` | a photo of a made-up man in his forties with a short dark beard, rectangular glasses, and a gray hoodie | Sunburst, 2026-10-06 |
| `family-mom` | a photo of a made-up woman in her forties with long curly auburn hair and freckles | Sunburst, 2026-10-06 |
| `family-girl` | a photo of a made-up girl about eight with two blond braids and a gap-toothed smile | Sunburst, 2026-10-06 |
| `family-boy` | a photo of a made-up boy about twelve with short black hair and a red baseball cap | Sunburst, 2026-10-06 |
| `family-toddler` | a photo of a made-up toddler with curly brown hair in a blue striped shirt | Sunburst, 2026-10-06 |
| `family-grandma` | a photo of a made-up woman in her seventies with short white hair and round glasses | Sunburst, 2026-10-06 |
