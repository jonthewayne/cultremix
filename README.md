# CultRemix

**Remix culture, get paid.**

CultRemix is a studio and shop for remixable t-shirt art. Add a few images, mix their styles, say what you want, and Generate makes four print-ready designs at once. Publish one and it gets a permanent CR number, like **CR 101-001**, a photo of someone wearing it, and a shop page. Anyone can remix a published design; the remix joins its family as the next number, **CR 101-002**, so every shirt carries its lineage, and the people upstream share in what it earns.

Built for the Monad hackathon (Social, Attention & Culture track). Live at [cultremix.com](https://cultremix.com).

## How it fits together

| Piece | What it does |
| --- | --- |
| **TanStack Start on Cloudflare Workers** | The site: feed, studio, shop pages (`/cr/<number>`), profiles (`/u/<username>`), the Print Studio (`/print/<number>`), sign-in, settings, and `/admin`. Routes live in `src/routes/`. |
| **Convex** | The database and every server function: studio batches, publishing, lineage, the feed and follows, print files, credits, flags, metrics (`convex/`). Tables are in `convex/schema.ts` and `convex/schema/`. |
| **Better Auth** (on Convex) | Email code sign-in for everyone; email and password only for accounts an admin made (judges). Public password sign-up is refused. |
| **CultRemix Gateway** | Image generation (GPT Image 2.5) and the notes we read from style images. Prompts and style notes stay on the server and never reach the browser. |
| **fal** | Upscaling for print (Topaz, keeps transparency): in the Print Studio, and before a work's print files are made. |
| **Shopify and Printful** | Checkout runs on Shopify's Headless channel; Printful prints each order (DTG) from a 300 DPI file per product and ships it, and its tracking goes back to Shopify, which emails the buyer. Built and tested against stand-ins until the accounts exist. |
| **Cloudflare R2** | One public bucket per environment. Each image lives in its own folder with a thumbnail and a medium copy; a published work's files sit under `works/<family>/<expression>/`, and anything not published sits under an unguessable 128-bit code. The full layout is in [Image generation → Storage and sizes](docs/image-generation/README.md#storage-and-sizes). |
| **Monad** | Provenance for published designs: each work's fingerprint (SHA-256), its lineage, its Backs, and the economics rules it follows. The registry contract (`contracts/`) and the chain writer (`convex/chain.ts`) are built; the mainnet registry deploys with `bun run chain:deploy:mainnet` once production's relayer has MON. See below. |

More detail: [Architecture](docs/architecture.md), [Image generation](docs/image-generation/README.md), [Onchain provenance ADR](docs/adr/0001-onchain-provenance.md).

## What's in it today

- **Studio.** Add up to 8 images, mix up to 4 styles, say what you want (or start from an idea), and Generate makes four designs at once. Favorite the ones you like, page through them full screen, compare 2 to 4 side by side, and dismiss the rest. Sessions keep every batch, so you can come back to a design later.
- **Publishing and CR numbers.** A published design gets its CR number, a shop page, and a photo of someone wearing it. Each member gets a few photo shoots a day (set in `/admin`; the owner has no limit). A photo past the limit waits, and its creator can take it the next day.
- **Remix by changing the words and parts.** CultRemix reads each design's words and its characters, people, and groups, and offers them as remixable parts; its creator chooses which ones a remix may change and sets their rules, in the studio before publishing (**Make it remixable**, then **Try it as a remix**) or on the publish reveal and work page after. **Remix this** shows them as a form: change the words, swap the lion for a wolf, give Santa a photo, or add a photo for each elf (a family of five becomes five elves), and Generate makes four versions with those changes, keeping the art, lettering, and colors. Anything else, like more words or a new style, goes in the request box. The batch and the published remix say what changed. A remix that changed only its words and parts publishes as a variation; one that changed more can start a new family as a fork, which the publish dialog suggests.
- **Share it or keep it.** Publishing asks who a design is for: **Share with the world** gives it a CR number and a spot in the feed, and anyone can order or remix it; **Keep it just for you** keeps it private, on a page only its creator can open, with credit still going to the design it remixes. A kept design can be shared later. Its creator can still order it: **Get it printed** asks, an admin approves it for them alone in `/admin/sale`, and once checkout is open the kept page sells it to them and nobody else. Its Shopify products are unlisted, under handles made from the design's private ID, so they never show up in Shopify's product lists or search. Sharing it later takes those products off sale (Shopify archives them), and the shared design sells under its public number once an admin approves it.
- **Lineage with forks and corrections.** A remix is published as a *variation* (the next number in its family, CR 101-002) or a *fork* (a new family that says where it came from). Each work page shows the trail back to the original, the remixes of it, and its family as a tree; `/family/<n>` shows the whole tree, with forks branching off. When a lineage is wrong, an admin can correct it at `/admin/lineage`; the work page shows the correction and the original record stays as published.
- **Economics panel.** Every work page shows who shares in a sale: 15% of each sale goes to the people behind the design, split between the work's creator, the family's founder, and, for a fork, the creator of the design it came from. The rules are a public file, [`/economics/v1.json`](https://cultremix.com/economics/v1.json), served byte for byte as the SHA-256 the panel shows, so anyone can check the split.
- **Social.** Profiles at `/u/<username>` with a bio, follower and following lists, and Works, Remixes, and Backed shelves. The home feed has Latest, Trending (hearts, Backs, and remixes from other members over the last week), and, for members, Following. Hearts and follows work everywhere a design or a creator appears, a bell tells you when someone follows you or hearts, remixes, or Backs your work, and work pages and profiles share with a rich preview.
- **Backs.** A member can Back up to 3 works a week, one Back per work and never their own. Each Back is recorded on Monad with its place in line, and the work page lists the earliest backers. Backs stay hidden until the registry is live and the **Backs** and **Monad records** switches are on.
- **Monad registry.** Publishing queues each work's registration, signed by the creator's wallet and sent by a relayer that pays the gas, so nobody needs MON or a wallet app. Lineage corrections and the economics rules' hash go through the same registry. `/admin/chain` shows the queue, and the public `/onchain` page explains what's recorded and how to check a design from its fingerprint. Once registrations confirm, work pages link their transactions and family trees mark recorded designs.
- **Products and placement.** Publishing asks which products a design comes on (the tees, hoodies, and more an admin offers in `/admin/products`, each with its own prices and print areas) and where it sits: front or back, Small to Full, higher or lower, shown on a drawn garment at real size. One placement fits every product, since it's stored as a share of each print area; any product can be placed separately. The model photo follows it.
- **Going on sale.** An admin approves each work in `/admin/sale`. CultRemix upscales the art, makes a 300 DPI print file for each product with the design where its creator put it, and creates a Shopify product for each. Buyers pick the style, color, and size.
- **Print Studio.** At `/print/<number>`, a work's creator (or the owner) trims the art, knocks out a background, upscales it for print (when the **Print-size art** switch is on), and places it. A slider shows the art beside what goes to the printer.
- **Shop pages.** The products, colors, and sizes a design sells in. Shopify checkout, Printful fulfillment with tracking emails, and creator earnings are built against stand-ins and switch on with the **Checkout** switch once those accounts exist; until then "Buying opens soon" collects emails. Store policies are at `/policies`; buyers' addresses are removed 30 days after their orders ship, and Shopify's privacy requests are handled.

## Running it

You need [Bun](https://bun.sh) and a Convex account.

```bash
bun install
bun run setup        # asks which Convex team to use; writes env files
bun run dev          # Convex + the site on http://localhost:3000
```

Then set up the new deployment once:

```bash
bun run seed:environment      # app settings, every switch at its default, CR counters
```

Sign in with the `FIRST_SUPER_ADMIN_EMAIL` address and claim the owner account in Settings. You're Creator № 1, and `/admin` is yours.

Without image keys, dev uses a stand-in generator so the whole flow still works. Real images need `AI_GATEWAY_API_KEY` and the R2 values in [Environment variables](docs/environment-variables.md).

### Everyday commands

```bash
bun run typecheck    # TypeScript (and Convex, when a deployment is configured)
bun run test         # unit tests and Convex tests on an in-memory backend
bun run build        # production build
bun run test:e2e     # browser smoke test
bun run test:chain:anvil  # the chain writer against a local Monad node (needs Foundry)
bun run test:image   # the image pipeline against the real models: ~9 min, ~$2.85 (tests/image-e2e)
```

### Launch scripts

```bash
bun run seed:environment                        # set up a fresh environment (safe to rerun)
bun run judges:provision -- --file judges.txt   # make judge accounts with passwords
```

Both target your dev deployment by default and production with `--prod` (they ask first). Neither ever copies data between environments. There are two environments: dev, the private rehearsal on Monad testnet, and production, cultremix.com on Monad mainnet. See [Judges](docs/judges.md) and the [Launch checklist](docs/launch-checklist.md).

## Admin

`/admin` is for the owner and staff:

- **Overview**: switches for each part of the product (Studio, Publishing, Checkout, Monad records, Backs, Sale emails, Print-size art) and app settings (signup credits, the daily image budget, photo shoots per member per day).
- **Members**: search by username, email, or creator number; give credits; turn creator access on or off.
- **Metrics**: counts by day and in total (members, members who generated, batches, designs, published works, remixes, families, credits used, model photos).
- **Judges**: make a judge account with a password (owner only).
- **Lineage**: look up a work by CR number and correct its lineage (owner and ops staff).
- **Products**: search Printful's catalog, add products with their colors and placements, put them on offer, pick the default, and set each one's name, prices, back-print extra, and print areas. **Check with Printful** reads a product's print areas from Printful's print files.
- **For sale**: **Connect Printful** and **Connect Shopify** set up each account's webhooks once its keys are in the env. Kept designs whose creators asked to have them printed come first, approved for their creators alone. Approve a published work for sale, follow its print files and Shopify products per product, and pause or resume. On dev and staging, **Simulate a sale** makes a Test order, so you can see what a sale does (Test earnings and the creators' notifications) before Shopify exists.
- **Orders**: Shopify orders with payment, Printful fulfillment, refunds, shipments and tracking, and privacy requests to answer (owner only). A paid order still waiting to go to print says why ("Trying again: Printful is not configured yet."). Before Printful makes an order, each print file is read from the address Printful will use and checked against the fingerprint saved when it was made; a file that changed or is gone is made again from the same art, and the order waits for it. Chargebacks and inquiries show on their orders: while one is open its creators' earnings are held, a chargeback the buyer kept takes them back, and one the store won releases them.
- **Payouts**: each creator's payable balance from real orders; record a payment by USDC or bank with its reference, and export a CSV (owner only).
- **Waitlist**: the emails "Buying opens soon" collected, with a CSV export.
- **Monad**: opens `/admin/chain`, the registry and its queue.

Support staff can look but not change anything.

## What the registry proves

When a design is published, CultRemix records its fingerprint and its place in a remix family on Monad. In plain words, that record proves this:

> A CultRemix-run service submitted a record, signed by the key of a CultRemix-held wallet assigned to that account, at that time, with that lineage and that fingerprint.

What it does **not** prove: because CultRemix holds the wallet keys for members, the record doesn't independently prove that a person agreed to it, and the limit on Backs is per account, not per human. It does prove the design existed with that exact content at that time, and which design it was remixed from, in a public record no one can quietly rewrite.

Only finalized blocks count. Dev uses Monad testnet (and shows a **Testnet** badge on CR numbers); production uses Monad mainnet. The full reasoning is in [ADR 0001](docs/adr/0001-onchain-provenance.md).

> The registry contract ([contracts/](contracts/README.md)) and the chain writer are in this repository: publishing queues each work's registration, Backs and lineage corrections go through the same relayer, and `/admin/chain` shows the queue. The registries aren't deployed yet (each needs its relayer funded), so the **Monad records** and **Backs** switches stay off and nothing is written to Monad today. Each work's page already shows its SHA-256 fingerprint and lineage (corrections are confirmed offchain while Monad records is off), and the economics rules file has its hash.

## More docs

- [Judges](docs/judges.md)
- [Launch checklist](docs/launch-checklist.md)
- [Hackathon submission](docs/hackathon/submission.md) and [build log](docs/hackathon/log.md)
- [Launch metrics](docs/launch/metrics.md) and [cohort notes](docs/launch/cohort.md)
- [Environment variables](docs/environment-variables.md)
- [Auth](docs/auth.md) and [Authorization](docs/authorization.md)
- [Cloudflare deployment](docs/deployment-cloudflare.md)
- [Testing](docs/testing.md)
- [Setup](docs/setup.md) and [Starter improvements](docs/starter-improvements.md)
