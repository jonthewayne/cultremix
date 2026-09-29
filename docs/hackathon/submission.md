# CultRemix submission

- Live: https://cultremix-prod.jonthewayne.workers.dev
- Code: https://github.com/jonthewayne/cultremix (branch `dev`)
- Video: (Jon adds the link)

## Pitch

CultRemix is a studio and shop for remixable t-shirt art. Drop in any inspiration image, say what should change, and get four print-ready designs with transparent backgrounds. Publish one and it gets a permanent CR number, like CR 101-001, a photo of someone wearing it, and a shop page. Anyone can remix a published design, and the remix joins its family as the next number, CR 101-002, so every shirt carries its lineage.

## What works today

- Email sign-in, username onboarding, and 24 starting credits (one per design, refunded if a design fails). During early access, sign-in codes aren't emailed, so visitors can browse the public feed and shop pages.
- Studio: drop in an inspiration image and describe the change. The background color is sampled from the image's edges and can be edited. Each Generate makes four transparent 1024×1536 designs that fill in as they finish.
- Favorites, a full-size viewer with arrow keys, and "Use as inspiration".
- Publish: an optional title, then a full-screen CR number reveal. A photo of a model wearing the design on a shirt in the background color is generated at publish.
- Feed, newest first: the design and the model photo side by side, with the big CR lockup, title, and creator.
- Shop page: sizes, $36 with checkout opening soon, the design's SHA-256 ("Verified on Monad — coming soon"), and its remix family.
- Remix: a published design opens in the studio as the inspiration, and the published result becomes the next number in its family.
- Stack: TanStack Start on Cloudflare Workers; Convex with Better Auth; GPT Image 2.5 (Sunburst for edits, Flare for text) through the Vercel AI Gateway.

## What's next

- Print on demand for every published design.
- Shopify checkout.
- Provenance on Monad: each design's SHA-256 and remix lineage recorded on chain.
- Creator subscriptions, and earnings for creators whose designs get remixed.
- Email delivery and the cultremix.com domain.

## 90-second demo script

| Time | On screen | Say |
|---|---|---|
| 0:00–0:10 | The feed | "Every great shirt is a remix. CultRemix makes the remix the product." |
| 0:10–0:35 | Studio: drop in the motel-sign photo, type "NO VACANCY FOR BAD VIBES", Generate; cut to the finished tiles | "Drop in anything that inspires you and say what should change. You get four print-ready designs with transparent backgrounds, on a color pulled from your photo." |
| 0:35–0:45 | Heart two, open the viewer, arrow through | "Keep the ones you love and flip through them full size." |
| 0:45–1:00 | Publish with a title, the CR 101-001 reveal, the feed row as the photo arrives | "Publish, and it gets a permanent number, CR 101-001, and a photo of someone wearing it." |
| 1:00–1:10 | Shop page | "Every design gets a shop page, with a fingerprint we'll anchor on Monad." |
| 1:10–1:25 | Remix, "make it night: navy and neon", Generate, publish, CR 101-002 | "Anyone can remix it. The remix joins the family as CR 101-002, so every shirt carries its lineage." |
| 1:25–1:30 | The feed with both | "Next: print on demand, checkout, provenance on Monad, and creator subscriptions. This is CultRemix." |

Designs take 20–40 seconds each, so record the Generate click and cut to the finished tiles. Inspiration images and instructions are in `~/cultremix-seed/` on mighteous (the share's `cultremix-seed` folder).

## Event requirements

(Jon: paste the event's submission fields here.)
