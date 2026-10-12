# Launch set: the first designs on production

Once production is deployed, publishing about ten designs and a few remixes of them gives judges a full feed, a Trending tab, and family trees to explore. Every request below already worked on dev, where each batch took about 30 seconds and cost about 12¢ of gateway credit, so the whole set is about $2 and half an hour.

## Before you start

- **Quickest:** `bun run launch:batches -- --prod` (Ops can run it, or you can from the repo; it asks you to type production) starts all nine originals below in @curiousentity's studio at once, each in its own session named for the design, a few seconds apart, about $1.20 of gateway credit in all. The next step is then only picking and publishing. `--list` shows what it would start, `--only "Grow Slow,Night Shift"` starts some, and `--as <username>` uses another account. On dev on October 12, Stay Sharp arrived as four designs in a session named Stay Sharp. Once the originals are published, `bun run launch:batches -- --prod --remixes --as <second account>` starts the remixes below the same way, as that account: each opens Remix this on its original and changes the word box or asks in Anything else to change, in a session named for it ("Night Shift: OWL"). On dev, Night Shift's SHIFT-to-OWL remix came back as four NIGHT OWL designs with the original's moon and lettering.
- Sign in on cultremix.com as @curiousentity. The owner has unlimited credits, so nothing here spends credits, only gateway credit (Admin, Overview shows it).
- For the remixes, sign in as a second member in another browser (another email of yours), so the remixes come from someone else, the way they would for a judge. It gets the starting credits every new member gets, and Admin, Members can add more.
- Publish each design with a title. The originals go first, so they get the lowest numbers.

## Originals

Type each request in the studio with no images and press Generate (or let `launch:batches` start them all), then publish the best of the four.

| Title | Request |
| --- | --- |
| Grow Slow | A psychedelic 70s mushroom graphic that says GROW SLOW |
| Trash Royalty | A raccoon in a tiny crown that says TRASH ROYALTY |
| Slow Roll | A retro badge of a snail on a skateboard that says SLOW ROLL, now at night with neon colors |
| Night Shift | A sticker of a sleepy moon wearing headphones that says NIGHT SHIFT |
| Offline Luxury | A woodblock-print wave with the words OFFLINE IS THE NEW LUXURY |
| Stay Sharp | A tiny cactus in sunglasses that says STAY SHARP |
| Roll With It | A raccoon in sunglasses on a skateboard that says ROLL WITH IT |
| Night Owl Club | A sleepy moon wearing a tiny knit beanie, with the words NIGHT OWL CLUB in bubbly retro letters |
| Merry & Bright | A Christmas t-shirt graphic: Santa, Mrs. Claus, and three elves standing together in a row, in a warm vintage storybook illustration style, with the words MERRY & BRIGHT |

A design whose words come out a letter off shows **Typo?**; press **Fix the spelling** before publishing it.

## Remixes, from the second account

Each starts with **Remix this** on the original's page (or let `launch:batches -- --remixes --as <second account>` start them all). A remix that changes only word boxes is always a variation; for the rest, the publish dialog compares it with the original and suggests one. These are the results dev and the image test suite got.

| Original | What to do | Expect |
| --- | --- | --- |
| Grow Slow | Change the word box SLOW to LOUD | A variation, the family's next number |
| Grow Slow | In Anything else to change: "Replace all the mushrooms with one giant blooming desert cactus at sunset, with no mushrooms anywhere." | A variation: a swapped subject keeps the design |
| Grow Slow | In Anything else to change: "Redraw the whole design as an 8-bit pixel-art arcade game title screen, with chunky pixel lettering and a pixel-art mushroom." | A fork is suggested: choose it, and it starts a new family that credits Grow Slow |
| Slow Roll | In Anything else to change: "Make it a sunny daytime beach scene: a bright blue sky and a big sun instead of the night sky, moon, and stars." | A variation: a new background keeps the design |
| Night Shift | Change the word box SHIFT to OWL | A variation |

Then, from the second account, heart a few designs and follow @curiousentity, so Trending and Following have something in them.

## Optional: a family as elves

On Merry & Bright's page, as its creator, press **Edit** under Remixable parts and check that it found Santa, Mrs. Claus, and the elves. Set Mrs. Claus to "leave them out" without a photo and the elves to up to 6 photos, then Save. Press **Remix this**, add your family's photos to Santa and the elves, Generate, and publish one with **Keep it just for you**. It stays private at its own page and still credits the original, which shows kept designs without putting your family in the feed.
