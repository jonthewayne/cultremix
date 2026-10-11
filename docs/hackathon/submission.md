# CultRemix submission

**Monad hackathon, Social, Attention & Culture track.** Due 2026-10-13, 20:59 PDT.

## Links

Jon fills in the ones marked (link).

- Live: https://cultremix.com (production, recording on Monad mainnet)
- Code: (public GitHub link, shared with metropolis@hackathon.monad.xyz)
- Demo video (3 minutes or less): (link). Script: [video-scripts.md](video-scripts.md#demo-about-250)
- Pitch video (2 minutes or less): (link). Script: [video-scripts.md](video-scripts.md#pitch-about-145)
- Logo: [cultremix-logo.png](cultremix-logo.png) (1024 × 1024 PNG, 28 KB), or [cultremix-logo-wide.png](cultremix-logo-wide.png) (1600 × 900, with the name)
- Monad registry contract: (explorer link, once `bun run chain:deploy:mainnet` has run)
- Judge sign-in: each judge gets an email and password privately (see [Judges](../judges.md)). On the sign-in page, tap **Have a password? Sign in with it**.

## Pitch

**Remix culture, get paid.**

CultRemix is a studio and shop for remixable t-shirt art. Add a few images, mix their styles, say what you want, and get four print-ready designs at once. Publish one and it gets a permanent CR number, like CR 101-001, a photo of someone wearing it, and a shop page. Anyone can remix a published design; the remix joins its family as the next number, CR 101-002, so every shirt carries its lineage, and when it sells, the creators upstream share in it.

## Why this track

- **Social:** remixing is the conversation. Every design invites the next one, and families grow in public.
- **Attention:** a CR number is a name people can say, share, and collect. The feed puts new work and its remixes side by side.
- **Culture:** the lineage is the point. Monad holds each work's fingerprint and family tree, so credit follows the design wherever it goes.

## What works today

From the [build log](log.md) and the [builder reports](reports/):

- **Sign-in:** email code sign-in, a username step, and starting credits. Sign-ins last 400 days. Judges get an email and password made for them.
- **Studio:** up to 8 numbered images (“draw image 1 in the style of image 2”) and a style mixer with up to 4 styles, each with a slider for its share. What we read from each image stays on the server.
- **Generate:** one press makes four designs at once, transparent and print-ready, for 2 credits a batch. Credits come back for any design that doesn't arrive, and a filtered request says so plainly.
- **Sessions and the viewer:** each run of batches is a session you can name, reopen, and keep working in. Heart the designs you like and they line up in a favorites tray; open any design full screen and page through with arrows, keys, or a swipe; compare 2 to 4 side by side; dismiss the ones you don't want (they're hidden, never deleted). Works on phones, including saving to Photos.
- **Publish:** an optional title, a choice between a variation and a fork for remixes, then a full-screen CR number reveal. A photo of someone wearing the design arrives a moment later, with a different person, pose, and place each time. Each member gets a few photo shoots a day; past that, the photo waits and its creator can take it the next day.
- **Remix by changing the words:** CultRemix reads the words on each published design and offers them as fields; the creator chooses which ones remixers can change. **Remix this** shows those words as inputs, and Generate makes four versions with only those words changed, spelled letter for letter, keeping the art, lettering, and colors. The batch and the published remix say what changed ("Changed the words: SLOW to LOUD").
- **Lineage:** a variation is the next number in its family (CR 101-002); a fork starts a new family and says where it came from. A remix that changed only the design's remixable words is always a variation; one that changed more can be either, and the publish dialog suggests a fork. Every work page shows the trail back to the original, the remixes of it, and the family as a tree; `/family/<n>` shows the whole tree, with forks branching off. Admins can correct a wrong lineage; the work page shows the correction, and the original record stays as published.
- **Economics panel:** every work page shows who shares in a sale (15% of each sale goes to the people behind the design) and links the rules file, `/economics/v1.json`, with its SHA-256.
- **Social:** profiles at `/u/<username>` with a bio, follower and following lists, and Works, Remixes, and Backed shelves; a home feed with Latest, Trending (hearts, Backs, and remixes from other members over the last week), and Following, plus a row of creators who just published; hearts and follows on every feed row, work page, and profile; a bell for new follows, hearts, remixes, Backs, and sales; rich link previews for work pages, profiles, and families.
- **Backs:** a member can Back up to 3 works a week, one per work and never their own, and each Back is recorded on Monad with its place in line; work pages list the earliest backers and Following shows the Backs of people you follow. Built and tested; hidden until the registry is live.
- **Monad registry (built, deploying to testnet):** the `CultRemixRegistry` contract (55 contract tests) records each work's ID, CR number, parent, kind, fingerprint, and creator wallet, plus lineage corrections, Backs in order, and the economics rules' hash. Publishing queues the registration, signed by the creator's wallet and sent by a relayer that pays the gas, so nobody needs MON or a wallet app. `/admin/chain` shows the queue; the public `/onchain` page explains what's recorded and how to check it. The whole path runs end to end against a local Monad node in the test suite.
- **Products and placement:** when publishing, the creator picks the products a design comes on (a tee, a hoodie, whatever is on offer) and places it once on a drawn shirt at real size: front or back, Small to Full, higher or lower. The same choice fits every product, or any one can be placed separately. The model photo follows it, down to a back print shot from behind.
- **Print files:** an admin approves each work for sale. CultRemix upscales the art, makes a 300 DPI print file for each product with the design where its creator put it, and lists each one in Shopify. The Print Studio (`/print/<CR number>`) lets the creator trim, knock out a background, and compare the art with what goes to the printer.
- **Kept designs:** publishing can keep a design just for its creator (a family shirt, an inside joke): no CR number, no feed, credit still going to the design it remixes. Its creator can order it from its private page once an admin approves it for them, and can share it with the world later.
- **Shop pages:** the products, colors, and sizes it's sold in, the design's SHA-256 fingerprint, the Economics panel, and the lineage. Shopify checkout, Printful fulfillment with tracking emails, and creator earnings are built and tested against stand-ins and switch on once those accounts exist; until then "Buying opens soon" collects emails. Store policies are at `/policies`, and buyers' addresses are removed 30 days after their orders ship.
- **Creator earnings:** each sale sets aside 15% for the people behind the design, recorded shirt by shirt. The creator's bell says "Someone bought Slow Roll CR 106-001. You earn $5.40." (a remix's sale names the original too), and `/me/earnings` shows what's pending, available, and paid. A share becomes payable 30 days after the shirt ships; the owner pays it from Admin, Payouts, by USDC or bank, and records the payment.
- **Storage:** every image lives in its own folder with a thumbnail and a medium copy, so pages load fast; a published work's files live under `works/<family>/<expression>/`. Images carry no hidden metadata.
- **Admin:** switches for each part of the product, app settings, member search with credit grants, launch metrics by day, lineage corrections, judge accounts, products and prices, approving works for sale, orders, creator payouts, and one-press setup for the Shopify and Printful accounts.
- **Labels:** production shows **Early access** until checkout opens; the private dev rehearsal shows a **Testnet** badge on every CR number.
- **Live:** cultremix.com since 2026-09-30.

Stack: TanStack Start on Cloudflare Workers, Convex with Better Auth, GPT Image 2.5 through the CultRemix Gateway, fal for print upscaling, Cloudflare R2, Monad.

## What the registry proves

A CultRemix-run service submits each record, signed by the key of a CultRemix-held wallet assigned to the member's account, with the work's fingerprint and lineage. That proves the design existed with that exact content at that time and which design it came from, in a public record. Because CultRemix holds the keys, it doesn't independently prove that a person agreed to it, and the Back limit is per account. More in the [README](../../README.md#what-the-registry-proves).

## Judging evidence

### What judges can verify now

Signed out works for all of these unless noted.

| Claim | How to check it |
| --- | --- |
| Every published design has a fixed fingerprint | On any work page (`/cr/<number>`), note the SHA-256 under **Fingerprint**. Open the full-size design and run `shasum -a 256` on the downloaded file. They match. |
| The sale split follows public rules | On a work page, the Economics panel names the people who share in a sale and links `/economics/v1.json` with its SHA-256. Run `curl -s <site>/economics/v1.json \| shasum -a 256`; it matches the panel. The file says how 15% of a sale is shared, so you can recompute the split yourself. |
| Remixes carry their lineage | On a remix's work page, **Lineage** walks back to the original, across forks. **Remixes of this** and the family tree show what came after; **See the whole tree** opens `/family/<n>`. A variation's number continues its family; a fork starts a new one and says “Forked from CR …”. |
| A remix changes only the words its creator allowed | Signed in as a judge: on a work page, **Remix this**. Its words appear as fields; change one and press Generate. The batch says “Changed the words: … to …”, and the four designs keep the art, lettering, and colors. The server checks each change against the parent's stored words, so the browser can't change words the creator locked. |
| Credit follows a fork | A fork's Economics panel includes the creator of the design it came from; a variation's includes the family's founder. |
| Corrections are public and append-only | A corrected work shows **Lineage amended** with the date, what changed, and the reason; the original record stays as published. |
| It's social | Profiles at `/u/<username>`, follower and following lists, hearts on every work, and the **Trending** tab. Signed in: follow another judge, then open **Following** on the home page; the bell shows their follows, hearts, and remixes of your work. |
| Provenance is explained and checkable | `/onchain` lists what's recorded on Monad and walks through checking a design from its fingerprint (`workIdAt`, then `getWork` on the explorer). Once the registry is deployed, each work page links its registration transaction and the family tree marks recorded designs. |
| The studio makes four print-ready designs at once | Signed in as a judge: add images, mix styles, press Generate. Four transparent designs arrive; 2 credits are used. |
| Designs become print files | Signed in as a judge, publish a design and open **Prepare for print** on its page. Trim, knock out, place, and make the print file; the Print Studio shows its DPI and SHA-256. |
| Prompts stay private | Watch the browser's network tab while generating: the prompt we build from your instruction and the notes we read from your style images never reach the browser. |

### When the registry is deployed

The registry contract and the chain writer are built and tested: 55 contract tests, and an end-to-end run of the real contract against a local Monad node. Deploying the mainnet registry is one command (`bun run chain:deploy:mainnet`) once production's relayer has about 0.47 MON. Then, with the **Monad records** switch on:

- Each published work's fingerprint and lineage are recorded on Monad mainnet, signed by the creator's CultRemix-held wallet. The work page links the registration transaction, and the family tree marks every recorded design.
- The economics rules file's SHA-256 is registered on Monad, and the Economics panel says “These shares are recorded on Monad.”
- Lineage corrections are recorded on Monad as amendments; the original record stays.
- With the **Backs** switch on too, members Back works, and each Back's place in line comes from the chain.
- Contract address: see **Monad registry contract** in [Links](#links), and `/onchain` on the site.

## What's next

- The Monad registry on mainnet in production.
- Checkout and print on demand for every approved design, once the Shopify and Printful accounts are set up.
- A small second design on the front of a back print, such as the CR mark on the chest.
- The first creator payouts in mid-November, 30 days after the first orders ship (the payout tools are built).
- More remixable parts than words: people and counts too, so anyone can put their crew into a design.

## Videos

The demo (3 minutes or less) and pitch (2 minutes or less) scripts, with recording notes, are in [video-scripts.md](video-scripts.md).

## Event requirements

Jon: paste the event's submission fields here, and check each one.

- [ ] Public GitHub repo, shared with metropolis@hackathon.monad.xyz
- [ ] Live link with judge sign-in instructions. Production (cultremix.com) records on Monad mainnet; check that the event accepts a mainnet build, since this line once read "Live staging link on Monad testnet".
- [ ] Demo video, 3 minutes or less (YouTube, Loom, or Vimeo)
- [ ] Pitch video, 2 minutes or less
- [ ] Logo, JPG/JPEG/PNG/WEBP, 3 MB or less
