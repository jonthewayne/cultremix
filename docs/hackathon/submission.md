# CultRemix submission

**Monad hackathon, Social, Attention & Culture track.** Due 2026-10-13, 20:59 PDT.

## Links

Jon fills in the ones marked (link).

- Live: https://cultremix.com (production, recording on Monad mainnet)
- Code: (public GitHub link, shared with metropolis@hackathon.monad.xyz)
- Demo video (3 minutes or less): (link). Script: [video-scripts.md](video-scripts.md#demo-about-250)
- Pitch video (2 minutes or less): (link). Script: [video-scripts.md](video-scripts.md#pitch-about-145)
- Logo: [cultremix-logo.png](cultremix-logo.png) (1024 × 1024 PNG, 28 KB), or [cultremix-logo-wide.png](cultremix-logo-wide.png) (1600 × 900, with the name)
- Monad registry contract: [0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0](https://monadscan.com/address/0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0) on Monad mainnet, live since October 13; its verified source is on [MonadVision](https://monadvision.com/address/0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0)
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
- **Studio:** up to 8 numbered images (“draw image 1 in the style of image 2”). What we read from each image stays on the server. A style mixer that blends up to 4 styles by sliders is built and hidden for now.
- **Generate:** one press makes four designs at once, transparent and print-ready, for 2 credits a batch. Credits come back for any design that doesn't arrive, a filtered request says so plainly, and **Try again** reruns a batch that didn't work.
- **Spelling check:** image models sometimes draw a word a letter or two off. When a request asks for words, each design's lettering is read back letter for letter; one that came out wrong says what it reads ("It reads TRROSH where you asked for TRASH"), and **Fix the spelling** redraws just that word in the same lettering. Publishing still works, with the same warning.
- **Sessions and the viewer:** each run of batches is a session you can name, reopen, and keep working in. Heart the designs you like and they line up in a favorites tray; open any design full screen and page through with arrows, keys, or a swipe; compare 2 to 4 side by side; dismiss the ones you don't want (they're hidden, never deleted). Works on phones, including saving to Photos.
- **Publish:** an optional title, a choice between a variation and a fork for remixes, then a full-screen CR number reveal. A photo of someone wearing the design arrives a moment later, with a different person, pose, and place each time. Each member gets a few photo shoots a day; past that, the photo waits and its creator can take it the next day.
- **Remix by changing the words:** CultRemix reads the words on each published design and offers them as boxes, one per line of lettering; the creator chooses which ones remixers can change. **Remix this** shows those boxes, and Generate makes four versions with those words changed, spelled letter for letter, keeping the art, lettering, and colors. Anything else, like more words or a new style, goes in the request box. The batch and the published remix say what changed ("Changed the words: SLOW to LOUD").
- **Remixable parts:** a creator can also open a design's characters, people, and groups to remixers. CultRemix proposes them from the design, the creator can add one in plain words ("let people add their family as elves"), and **Make it remixable** in the studio sets each one up, with **Try it as a remix** to test it before publishing. A character can be swapped by words or a photo; a person is drawn from a remixer's photo, and without one is kept, left out, or asked for, as the creator chose; a group takes a photo for each member, up to the creator's limit. Santa, Mrs. Claus, and three elves can become a family's six elves with Mrs. Claus left out, and it's still a variation of the original. Each work page lists what a remix of it can change, under **Remix this**.
- **Lineage:** a variation is the next number in its family (CR 101-002); a fork starts a new family and says where it came from. A remix that changed only the design's remixable words is always a variation; one that changed more can be either, and the publish dialog suggests a fork. Every work page shows the trail back to the original, the remixes of it, and the family as a tree; `/family/<n>` shows the whole tree, with forks branching off. Admins can correct a wrong lineage; the work page shows the correction, and the original record stays as published.
- **Economics panel:** every work page shows who shares in a sale (15% of each sale goes to the people behind the design) and links the rules file, `/economics/v1.json`, with its SHA-256.
- **Social:** profiles at `/u/<username>` with a bio, follower and following lists, and Works, Remixes, and Backed shelves; a home feed with Latest, Trending (hearts, Backs, and remixes from other members over the last week), and Following, plus a row of creators who just published; hearts and follows on every feed row, work page, and profile; a bell for new follows, hearts, remixes, Backs, and sales; rich link previews for work pages, profiles, and families.
- **Backs:** a member can Back up to 3 works a week, one per work and never their own, and each Back is recorded on Monad with its place in line; work pages list the earliest backers and Following shows the Backs of people you follow. Live on production since October 13.
- **Monad registry (live on mainnet since October 13):** the `CultRemixRegistry` contract (55 contract tests) records each work's ID, CR number, parent, kind, fingerprint, and creator wallet, plus lineage corrections, Backs in order, and the economics rules' hash. Publishing queues the registration, signed by the creator's wallet and sent by a relayer that pays the gas, so nobody needs MON or a wallet app. `/admin/chain` shows the queue; the public `/onchain` page explains what's recorded and how to check it. The whole path runs end to end against a local Monad node in the test suite.
- **Products and placement:** when publishing, the creator picks the products a design comes on (a tee, a hoodie, whatever is on offer) and places it once on a drawn shirt at real size, with the print area outlined: front or back, any size up to its edges, higher or lower. The same choice fits every product, or any one can be placed separately. The model photo follows it, down to a back print shot from behind.
- **Print files:** an admin approves each work for sale. CultRemix upscales the art, makes a 300 DPI print file for each product with the design where its creator put it, and lists each one in Shopify. The Print Studio (`/print/<CR number>`) lets the creator trim, knock out a flat background color or remove any other background, and compare the art with what goes to the printer.
- **Kept designs:** publishing can keep a design just for its creator (a family shirt, an inside joke): no CR number, no feed, credit still going to the design it remixes. Its creator can order it from its private page once an admin approves it for them, and can share it with the world later.
- **Shop pages:** the products, colors, and sizes it's sold in, the design's SHA-256 fingerprint, the Economics panel, and the lineage. Shopify checkout, Printful fulfillment with tracking emails, and creator earnings are built and tested against stand-ins and switch on once those accounts exist; until then "Buying opens soon" collects emails, and once checkout opens an admin sends each person one email naming the designs they asked about. Store policies are at `/policies`, and buyers' addresses are removed 30 days after their orders ship.
- **Creator earnings:** each sale sets aside 15% for the people behind the design, recorded shirt by shirt. The creator's bell says "Someone bought Slow Roll CR 106-001. You earn $5.40." (a remix's sale names the original too), and with the Sale emails switch on, an email says the same, and `/me/earnings` shows what's pending, available, and paid. A share becomes payable 30 days after the shirt ships; the owner pays it from Admin, Payouts, by USDC or bank, and records the payment.
- **Storage:** every image lives in its own folder with a thumbnail and a medium copy, so pages load fast; a published work's files live under `works/<family>/<expression>/`. Images carry no hidden metadata.
- **Admin:** today's image spend and the gateway credit left, switches for each part of the product (turning Checkout off also makes every Shopify product a draft), takedowns, app settings, member search with credit grants, launch metrics by day, lineage corrections, judge accounts, products and prices, approving works for sale, orders, creator payouts, and one-press setup for the Shopify and Printful accounts.
- **Labels:** production shows **Early access** until checkout opens; the private dev rehearsal shows a **Testnet** badge on every CR number.
- **Live:** cultremix.com since 2026-09-30.

Stack: TanStack Start on Cloudflare Workers, Convex with Better Auth, GPT Image 2.5 through the CultRemix Gateway, fal for print upscaling, Cloudflare R2, Monad.

## Check a file today

Every work page shows its fingerprint, the SHA-256 of its original file, with a link to that file. On `/onchain`, **Which design is this file?** hashes a dropped file in the browser (only the hash leaves the device) and names the design it is; a resaved copy doesn't match. This works before the registry is deployed, and once it is, the same fingerprint is the `contentHash` recorded on Monad: under a match, **Check it on Monad yourself** has the browser read the design's record from Monad's public RPC (`workIdAt`, then `getWork`) and compare the fingerprints, so the check doesn't depend on trusting CultRemix's servers. The anvil test reads a real registration this way.

## What the registry proves

A CultRemix-run service submits each record, signed by the key of a CultRemix-held wallet assigned to the member's account, with the work's fingerprint and lineage. That proves the design existed with that exact content at that time and which design it came from, in a public record. Because CultRemix holds the keys, it doesn't independently prove that a person agreed to it, and the Back limit is per account. More in the [README](../../README.md#what-the-registry-proves).

## Judging evidence

### What judges can verify now

Signed out works for all of these unless noted.

| Claim | How to check it |
| --- | --- |
| Every published design has a fixed fingerprint | On any work page (`/cr/<number>`), note the SHA-256 under **Fingerprint**. Open the full-size design and run `shasum -a 256` on the downloaded file. They match. **Verify it yourself** under the fingerprint does both checks in the browser: it downloads and hashes the original file, and reads the design's record from Monad's public RPC. |
| The sale split follows public rules | On a work page, the Economics panel names the people who share in a sale and links `/economics/v1.json` with its SHA-256. Run `curl -s <site>/economics/v1.json \| shasum -a 256`; it matches the panel. The file says how 15% of a sale is shared, so you can recompute the split yourself. |
| Remixes carry their lineage | On a remix's work page, **Lineage** walks back to the original, across forks. **Remixes of this** and the family tree show what came after; **See the whole tree** opens `/family/<n>`. A variation's number continues its family; a fork starts a new one and says “Forked from CR …”. |
| A remix's boxes offer only the words its creator opened | Signed in as a judge: on a work page, **Remix this**. Its words appear as boxes; change one and press Generate. The batch says “Changed the words: … to …”, and the four designs keep the art, lettering, and colors. The server checks each box against the parent's stored words, so the browser can't open words the creator locked. Asking for more in the request box is allowed; when publishing, a remix that looks different from its original is offered as a fork. |
| Words are spelled as asked | Signed in as a judge: ask for words in capitals (a sticker that says NIGHT SHIFT). About 20 seconds after the designs arrive, each one's lettering has been read back; a design drawn a letter or two off says **Typo?**, its large view says what it reads, and **Fix the spelling** redraws that word. |
| Credit follows a fork | A fork's Economics panel includes the creator of the design it came from; a variation's includes the family's founder. |
| Corrections are public and append-only | A corrected work shows **Lineage amended** with the date, what changed, and the reason; the original record stays as published. |
| It's social | Profiles at `/u/<username>`, follower and following lists, hearts on every work, and the **Trending** tab. Signed in: follow another judge, then open **Following** on the home page; the bell shows their follows, hearts, and remixes of your work. |
| Provenance is explained and checkable | `/onchain` lists what's recorded on Monad and walks through checking a design from its fingerprint (`workIdAt`, then `getWork` on the explorer). /onchain also lists the latest recorded designs with their transactions, each work page links its registration transaction, and the family tree marks recorded designs. |
| The studio makes four print-ready designs at once | Signed in as a judge: add images, say what you want ("image 1 in the style of image 2"), press Generate. Four transparent designs arrive; 2 credits are used. |
| Designs become print files | Signed in as a judge, publish a design and open **Prepare for print** on its page. Trim, knock out a flat color or remove any other background, place, and make the print file; the Print Studio shows its DPI and SHA-256. |
| Prompts stay private | Watch the browser's network tab while generating: the prompt we build from your instruction and the notes we read from your style images never reach the browser. Checked October 11 by recording every message the studio received over its live connection while opening a session made with a photo and style images: the member's own request came through, and no notes or prompt text did. |

### On Monad mainnet

The registry went live on Monad mainnet on October 13 at [`0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0`](https://monadscan.com/address/0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0), deployed by one command (`bun run chain:deploy:mainnet --broadcast --confirm-mainnet`) that also registered the economics rules and verified the source on Sourcify. The contract has 55 contract tests, and the test suite runs the real contract and chain writer end to end against a local Monad node. With the **Monad records** and **Backs** switches on, as they are on production:

- Each published work's fingerprint and lineage are recorded on Monad mainnet, signed by the creator's CultRemix-held wallet, within seconds of publishing. The work page links the registration transaction, and the family tree marks every recorded design. The 12 designs published before the registry went live were recorded the same night.
- The economics rules file's SHA-256 is registered on Monad, and the Economics panel says “These shares are recorded on Monad.”
- Lineage corrections are recorded on Monad as amendments; the original record stays.
- Members Back works, and each Back's place in line comes from the chain.
- The relayer pays every fee, so nobody needs MON or a wallet app: about 0.021 MON a design and 0.011 a Back, well under a cent each.
- Contract address: see **Monad registry contract** in [Links](#links), and `/onchain` on the site.

## What's next

- Checkout and print on demand for every approved design, once the Shopify and Printful accounts are set up.
- A small second design on the front of a back print, such as the CR mark on the chest.
- The first creator payouts in mid-November, 30 days after the first orders ship (the payout tools are built).
- Making designs on a member's own ChatGPT plan, with the CultRemix Gateway as the backup (the V1 plan's ChatGPT connection).

## Videos

The demo (3 minutes or less) and pitch (2 minutes or less) scripts, with recording notes, are in [video-scripts.md](video-scripts.md).

## Event requirements

Checked October 12 against the event's pages. Confirm the deadline on the portal's own countdown before submitting.

- **Deadline:** Tuesday, October 13, 11:59 p.m. Eastern (8:59 p.m. Pacific), through [hackathon.monad.xyz](https://hackathon.monad.xyz) ([Susano Labs](https://news.susanolabs.com/monad/en/news/metropolis-opens-hackathon-project-submissions-2105704400748683495)).
- **Judging:** October 14 to 27, with winners announced November 3 ([Rise In](https://www.risein.com/monad)). cultremix.com, its gateway credit, and its relayer's MON have to hold up through October 27 ([Judging days](judging-runbook.md)).
- **Built in the window:** a working product built on Monad between September 1 and October 13. Earlier foundations are allowed if what's presented is new ([hackathon.monad.xyz](https://hackathon.monad.xyz), [Dev Grants Daily](https://devgrantsdaily.com/items/2026-09-16-monad-metropolis-2026/)). CultRemix's planning began September 27, and cultremix.com went live September 30.
- **Network:** Monad testnet or mainnet both count ([Rise In](https://www.risein.com/monad/monad-metropolis-hackathon)).

What the form asks for, as other teams' submissions list it ([one example](https://github.com/Planckify-Labs/monad-submission)), and where each piece is:

- [ ] The project registered on the portal, with its track: Social, Attention & Culture.
- [ ] Team info.
- [ ] Name, description, the problem, the solution, and how it uses Monad: [Pitch](#pitch), [Why this track](#why-this-track), and [What the registry proves](#what-the-registry-proves).
- [ ] Public GitHub repo, readable by metropolis@hackathon.monad.xyz.
- [ ] Live link with judge sign-in instructions: https://cultremix.com, its [How it works](https://cultremix.com/how-it-works) page, and [Judges](../judges.md).
- [x] The registry's contract address: `0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0` ([Monadscan](https://monadscan.com/address/0x9bc9f1E1d076563130b4109DD6AfFd8708CeDBE0)).
- [ ] Demo video, 3 minutes or less (YouTube, Loom, or Vimeo).
- [ ] Pitch video, 2 minutes or less.
- [ ] Logo, JPG/JPEG/PNG/WEBP, 3 MB or less: [cultremix-logo.png](cultremix-logo.png).
- [ ] The disclosures below, if the form asks (the portal expects an AI tools disclosure).

## Disclosures

Drafts for the form. Jon: confirm the bracketed line, then paste.

**Prior work and third-party components.** CultRemix was built during the hackathon. Planning began September 27, 2026, and cultremix.com went live September 30. It started from our own app starter template (TanStack Start on Cloudflare Workers, with Convex and Better Auth), which supplied the sign-in pages, project setup, and deploy scripts. Everything specific to CultRemix was written during the hackathon: the studio, publishing and CR numbers, remixes and their lineage, the CultRemixRegistry contract on Monad and the relayer that writes to it, the shop, and the Print Studio. Third-party services: Convex (database and server functions), Better Auth (sign-in), Cloudflare Workers and R2 (hosting and image storage), Vercel AI Gateway (image and text models, called the CultRemix Gateway in the app), fal (print upscaling and background removal), Resend (sign-in email), Shopify and Printful (checkout and printing, built but not live yet), Circle (member wallets, once set up), and viem and Foundry for the contract.

**AI tools.** AI coding agents in OpenAI's Codex app wrote most of the code, tests, and documentation, following Jon Shumate's direction. [Jon: confirm the models. This builder thread runs Anthropic's Claude.] Jon set the product, design, and business decisions and tested the site as it was built. ChatGPT was used for early brainstorming; that conversation is in the repo under `docs/reference`. In the product itself, GPT Image 2.5 makes the designs and model photos, with Nano Banana 2.1 and Recraft V4.1 available to admins. GPT-6 Luna reads uploaded images and published designs, Gemini 3.1 Pro checks lettering, and fal's Topaz and BiRefNet models upscale art and remove backgrounds for print. Every design and model photo on the site was made this way.
