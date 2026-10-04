# CultRemix submission

**Monad hackathon, Social, Attention & Culture track.** Due 2026-10-13, 20:59 PDT.

## Links

Jon fills these in.

- Live (staging, Monad testnet): (link)
- Production: https://cultremix.com
- Code: (public GitHub link, shared with metropolis@hackathon.monad.xyz)
- Demo video (3 minutes or less): (link)
- Pitch video (2 minutes or less): (link)
- Logo: (file, JPG/PNG/WEBP, 3 MB or less)
- Monad registry contract: (explorer link)
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
- **Lineage:** a variation is the next number in its family (CR 101-002); a fork starts a new family and says where it came from. Every work page shows the trail back to the original, the remixes of it, and the family as a tree; `/family/<n>` shows the whole tree, with forks branching off. Admins can correct a wrong lineage; the work page shows the correction, and the original record stays as published.
- **Economics panel:** every work page shows who shares in a sale (15% of each sale goes to the people behind the design) and links the rules file, `/economics/v1.json`, with its SHA-256.
- **Social:** profiles at `/u/<username>` with a bio, follower and following lists, and Works, Remixes, and Backed shelves; a home feed with Latest, Trending (hearts, Backs, and remixes from other members over the last week), and Following, plus a row of creators who just published; hearts and follows on every feed row, work page, and profile; a bell for new follows, hearts, remixes, and Backs; rich link previews for work pages, profiles, and families.
- **Backs:** a member can Back up to 3 works a week, one per work and never their own, and each Back is recorded on Monad with its place in line; work pages list the earliest backers and Following shows the Backs of people you follow. Built and tested; hidden until the registry is live.
- **Monad registry (built, deploying to testnet):** the `CultRemixRegistry` contract (55 contract tests) records each work's ID, CR number, parent, kind, fingerprint, and creator wallet, plus lineage corrections, Backs in order, and the economics rules' hash. Publishing queues the registration, signed by the creator's wallet and sent by a relayer that pays the gas, so nobody needs MON or a wallet app. `/admin/chain` shows the queue; the public `/onchain` page explains what's recorded and how to check it. The whole path runs end to end against a local Monad node in the test suite.
- **Print Studio:** at `/print/<CR number>`, the creator trims the art, knocks out a background, upscales it for print, places it on the shirt, and makes a 300 DPI print file with its own SHA-256. A slider shows the art next to what goes to the printer.
- **Shop pages:** the colors the creator offered, sizes, and $36, the design's SHA-256 fingerprint, the Economics panel, and the lineage. Shopify checkout, Printful fulfillment, and creator earnings are built against stand-ins and switch on once those accounts exist; until then "Buying opens soon" collects emails.
- **Storage:** every image lives in its own folder with a thumbnail and a medium copy, so pages load fast; a published work's files live under `works/<family>/<expression>/`. Images carry no hidden metadata.
- **Admin:** switches for each part of the product, app settings, member search with credit grants, launch metrics by day, lineage corrections, and judge accounts.
- **Labels:** production shows **Early access** until checkout opens; staging shows a **Testnet** badge on every CR number.
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

The registry contract and the chain writer are built and tested: 55 contract tests, and an end-to-end run of the real contract against a local Monad node. Deploying the testnet registry is one command once its relayer has testnet MON. Then, with the **Monad records** switch on:

- Each published work's fingerprint and lineage are recorded on Monad (testnet on staging), signed by the creator's CultRemix-held wallet. The work page links the registration transaction, and the family tree marks every recorded design.
- The economics rules file's SHA-256 is registered on Monad, and the Economics panel says “These shares are recorded on Monad.”
- Lineage corrections are recorded on Monad as amendments; the original record stays.
- With the **Backs** switch on too, members Back works, and each Back's place in line comes from the chain.
- Contract address: see **Monad registry contract** in [Links](#links), and `/onchain` on the site.

## What's next

- The Monad registry on testnet for staging, then mainnet records in production.
- Checkout and print on demand for every published design, once the Shopify and Printful accounts are set up.
- Creator earnings paid out from the 15% creator pool.
- More remixable parts than words: people and counts too, so anyone can put their crew into a design.

## 90-second demo script

| Time | On screen | Say |
|---|---|---|
| 0:00–0:08 | The feed on a phone, scrolling past a family of remixes | “Every great shirt is a remix. CultRemix makes the remix the product, and pays the people it came from.” |
| 0:08–0:20 | Studio: add a portrait as image 1 and a 70s concert poster as image 2; open the Style mixer and set the poster to 70; type “Draw image 1 as a concert poster that says FAR OUT” | “Add a few images, mix their styles, and say what you want.” |
| 0:20–0:30 | Press Generate; cut to the four designs filling in together; heart two and swipe through them full screen | “One press, four print-ready designs at once.” |
| 0:30–0:42 | Pick one, Publish, add a title; the full-screen CR reveal; the work page as the model photo arrives | “Publish, and it gets a permanent number and a photo of someone wearing it.” |
| 0:42–0:55 | Signed in as a second member: **Remix this**; the design's words appear as fields; change one word, Generate, and publish one as a variation; the next number in the family | “Anyone can remix it: change the words, keep the art. The remix joins the family as the next number, so every shirt carries its lineage.” |
| 0:55–1:07 | The remix's work page: the family tree, then the Economics panel and its rules file | “Every sale sets aside 15% for the people behind the design: here, the remixer and the family's founder. The rules are public, and anyone can check the math.” |
| 1:07–1:17 | The Print Studio: knock out the background, then drag the slider between the art and the print file | “And every design becomes a real print file, ready for a shirt.” |
| 1:17–1:27 | The work's record on the Monad explorer, its fingerprint matching the work page | “Each work's fingerprint and family tree are recorded on Monad, so anyone can see where a design came from.” |
| 1:27–1:30 | The creator's profile with both works | “Remix culture, get paid. This is CultRemix.” |

Recording notes:

- Generate takes 20–40 seconds. Record the press, then cut to the finished designs.
- A design's remixable words appear a few seconds after it's published, once CultRemix has read them. Its creator can rename or lock them from the work page before you record the remix.
- Use images you have the rights to. Pick a portrait and a poster with strong, simple shapes.
- Record on staging, so the Testnet badge shows on the CR numbers and the Monad record is on testnet.
- Upscaling takes about 90 seconds; if you show it, cut. The **Print-size art** switch must be on.
- The Monad record needs the registry and the **Monad records** switch. If it isn't ready on recording day, replace 1:17–1:27 with the work page's fingerprint and the rules file's hash, and say “Next, these go on Monad.”

## Event requirements

Jon: paste the event's submission fields here, and check each one.

- [ ] Public GitHub repo, shared with metropolis@hackathon.monad.xyz
- [ ] Live staging link on Monad testnet, with judge sign-in instructions (checkout labeled as a test payment)
- [ ] Demo video, 3 minutes or less (YouTube, Loom, or Vimeo)
- [ ] Pitch video, 2 minutes or less
- [ ] Logo, JPG/JPEG/PNG/WEBP, 3 MB or less
