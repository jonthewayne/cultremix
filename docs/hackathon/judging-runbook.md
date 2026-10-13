# Judging days: what to watch and what to do

For Jon (and Ops) while judges use cultremix.com. Everything here works on production once the latest Ops message is deployed.

Judges use the site from October 14 to 27, and winners are announced November 3, so the image credit and the relayer's MON have to last two weeks. $50 of credit is about 380 batches, enough for about 19 judges who each use all 40 credits. The relayer had 15.29 MON on October 13 after the registry deploy and the first 12 records, enough for about 700 more (a design's record is about 0.021 MON, a Back about 0.011). The bell (and email to the owner) says when the credit drops below $10, when the relayer is running low on MON (about 20 records left), and when it runs out; Admin, Overview shows the credit, and /admin/chain the relayer's MON.

## Before judges arrive

1. **Gateway credit.** Admin, Overview shows Gateway credit in dollars and "About N batches". Judges' designs, notes, and model photos are all paid from the CultRemix Gateway account: about 13¢ a batch, and a judge who uses all 40 credits spends about $2.60. Top it up to about $50.
2. **Settings** (Admin, Overview): a $50 daily image budget and 3 model-photo shoots per member per day. The budget counts UTC days, so it starts over at 5 p.m. Pacific.
3. **Judge accounts.** Admin, Judges: an email and a username make an account with a password, creator access, 40 credits, and that username, so the judge lands straight in the studio. Copy each password when it appears; it shows only there, once. For a list, Ops can run `bun run judges:provision -- --prod --file judges.txt` (one "email username" per line); its passwords go to `.judges.local.json`, readable only by you. Running either again changes nothing for existing judges unless you ask for a new password. Send each judge their email and password privately, with [the judges' page](../judges.md): on the sign-in page they tap **Have a password? Sign in with it**.
4. **The launch set.** Publish the designs and remixes in [launch-set.md](launch-set.md), so the feed, Trending, and family trees have something in them when judges arrive. `bun run launch:batches -- --prod` starts all nine originals in your studio at once, each in a session named for it, so what's left is picking and publishing.

## While judges are on the site

- **The bell**, signed in as the owner. Alerts arrive there and by email to the owner and ops: the gateway credit under $10 or out, and later, once those parts are on, a relayer running low on MON (about 20 records left) or out of it, and orders that can't go on by themselves.
- **Admin, Overview**: Gateway credit (a red "Low" line under $10), Browser errors (pages that broke in someone's browser, by page and count), and Ready to sell.

## When something goes wrong

| What someone sees | Why | What to do |
| --- | --- | --- |
| The studio says "The studio can't make designs right now. Try again in a little while." | The CultRemix Gateway account is out of credit. | Add credit to the Gateway account; designs work again right away. The failed designs' credits went back to their makers. |
| "The studio is resting until tomorrow." | The day's image budget is spent. | Raise the daily budget in Admin, Overview, Settings, or wait for 5 p.m. Pacific. |
| A batch's designs all failed with the filter note | The image model's filter refused the request; it's sometimes wrong. | **Try again** on the batch's line, or reword the request. The failed designs' credits came back. |
| A judge can't sign in | A lost or mistyped password. | Admin, Judges: their email and username with "Give an existing judge a new password", then send it privately. |
| A judge is out of credits (Generate reads "Out of credits", with **Ask for more**, which emails hey@cultremix.com) | 40 credits make 20 batches, and credits don't refill on their own. | Admin, Members: search for them, then Give credits. |
| "A remix can change" lists words the design doesn't say | The notes reader misread its lettering. | Ops: `bunx convex run --prod images:rereadWorkNotes '{"cr":"<number>"}'` reads it again. Its creator can also switch words off with Edit on the design's page. |
| Something offensive or infringing is published | Anyone can upload images. | Signed in as the owner, open its page and press **Take this design down**: it disappears from the site, its sale and printing stop, and its creator is told why. Admin, Overview lists takedowns and can put one back up. |
| "Publishing is paused for now" | The Publishing switch is off. | Admin, Overview, Switches: turn Publishing on. |
| Browser errors lists something | A page broke in someone's browser. | Send the Builder the page, the message, and the count. |

## What judges see that's expected

- **Early access** in the header (production never says Testnet).
- **Buying opens soon** on shop pages until Checkout is on, with **Tell me when it's ready** for a signed-in judge (an email box for visitors who aren't signed in).
- **Waiting to be registered on Monad** under a new design's fingerprint for a few seconds after publishing, then **Registered on Monad · View transaction**. If one stays waiting, /admin/chain shows why: usually a brand-new member's wallet (they get one within five minutes) or a relayer out of MON.
- **Draft, under review** on the store policies, until you approve them.
