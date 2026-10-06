# Studio models, remixable parts, private keeps, and shirt colors

Requested by Jon on 2026-10-06. Builder thread; dev only until Ops deploys. Each stage is pushed to `dev` when it works.

## 1. Studio basics

- **Start from this.** On any finished design (⋯ menu, the viewer's button, and its B key): the prompt, images, and styles clear, the design becomes image 1, and the session stays the same. "Add as an image" keeps the old behavior of adding it to the images already there.
- **Hints for several images.** Once there are two or more numbered images, tappable examples sit under the request box: "Draw image 1 in the style of image 2", "Use the colors of image 2", "Put the people from image 2 into image 1". The request reader already understands these.
- **Style names.** Mixer rows are labeled Style 1 to Style 4. The request reader gets the names, and the prompt tags each mixer image with the name the member sees, so "put style 2 on the lettering" points at the right picture.
- **Background color.** Only image 1 sets it, only while the member hasn't picked a color in this form, and it snaps to the nearest shirt color. Style images and later images never change it. The picker offers the shirt's colors.

## 2. Other image models, for admins

Admins at the "manage" level see a model picker next to Generate. Members keep GPT Image 2.5.

| Choice | How a batch is made | Measured 2026-10-06 |
|---|---|---|
| GPT Image 2.5 (default) | One 2x2 grid call, transparent, cut into four | about 10-11¢ at high |
| Nano Banana 2.1 | One 2x2 grid call at 2K on a flat key color, keyed out, then cut | 6.4¢, 22 s from words; 6.6¢, 31 s with an image |
| Recraft V4.1 | Four 1024x1024 calls that ask for a transparent background | 3.5¢ and 5-10 s each |
| Mix | Four single calls: two GPT Image 2.5, one Nano Banana 2.1, one Recraft V4.1 | about 30¢ |

- Nano Banana 2.1 returns opaque JPEGs (asked for transparency, it painted the background black). The prompt asks for a flat magenta background, or green when the prompt's colors lean pink or purple, and the keyer removes it with color unmixing, so soft pencil edges keep their gray instead of a pink fringe. Keying is free and instant, so no second GPT Image call is needed.
- Recraft V4.1 can't see images through the gateway. Its prompt keeps what content images show and only how style images look; with the full prompt it drew the style images' woman and picnickers.
- Each design records its model; admins see it on the tile. The daily budget reserves each choice's own worst case.

## 3. Remixable parts

Remixable words become remixable parts, one list per design, in the existing `remixFields`:

- **Words**: text boxes, as today.
- **Character** ("the lion"): a "Swap the lion" suggestion; the remixer types a replacement or adds a photo.
- **Person** ("Santa"): a photo slot for someone to become that character. The creator chooses what an empty slot does: keep the original, leave it out, or require a photo.
- **Group** ("Elves"): one photo slot per member of the group the original shows, more with "+ Add", up to the creator's limit. Elves with photos appear; empty slots drop out; no photos keeps the original group.

GPT-6 Luna proposes parts from a design's notes. Creators set them up in the studio ("Make it remixable" on a design), try them with "Try it as a remix", and publishing carries them over. Code turns filled parts into prompt lines ("Draw exactly five elves, one for each person in images 4 to 8, each keeping that person's recognizable likeness; no other elves"). The variation-or-fork comparison is told which parts were open, so a different number of elves stays a variation. The image suite gets a Santa design and family photos.

## 4. Private keeps

The publish dialog asks: **Share with the world** (a CR number, the feed, anyone can order or remix it) or **Keep it just for you** (only you see and order it; the original's creator still gets credit). A kept work gets status `private`, so every public query, which already reads only `published`, leaves it out. It takes a private internal number (family 0) that's never shown, skips the public steps (activity, onchain record, shop listing), and opens on a private page. Sharing it later gives it a public CR number.

## 5. Shirt colors

- An admin **Products** tab searches Printful's public catalog, adds products, and pulls each one's real colors (names, hex, variant IDs). The admin picks which colors are offered. The launch shirt stays the default until another is chosen.
- The studio's background picker, its snapping, and the publish color board use the offered colors.
- The publish step shows the design on each offered color with the existing contrast note. A version of a design made for dark shirts is a later step.

## 6. Blending tests

Three alternatives to fixed parts, at medium quality, two mixes (one with a lettering-heavy style second), scored with the same questions: GPT-6 Luna picks each style's part; Luna writes one blended description; the four designs show the range.

