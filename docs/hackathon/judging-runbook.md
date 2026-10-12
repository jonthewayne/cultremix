# Judging days: what to watch and what to do

For Jon (and Ops) while judges use cultremix.com. Everything here works on production once the latest Ops message is deployed.

## Before judges arrive

1. **Gateway credit.** Admin, Overview shows Gateway credit in dollars and "About N batches". Judges' designs, notes, and model photos are all paid from the CultRemix Gateway account: about 13¢ a batch, and a judge who uses all 40 credits spends about $2.60. Top it up to about $50.
2. **Settings** (Admin, Overview): a $50 daily image budget and 3 model-photo shoots per member per day. The budget counts UTC days, so it starts over at 5 p.m. Pacific.
3. **Judge accounts.** Admin, Judges: an email and a username make an account with a password, creator access, 40 credits, and that username, so the judge lands straight in the studio. Copy each password when it appears; it shows only there, once. For a list, Ops can run `bun run judges:provision -- --prod --file judges.txt` (one "email username" per line); its passwords go to `.judges.local.json`, readable only by you. Running either again changes nothing for existing judges unless you ask for a new password. Send each judge their email and password privately, with [the judges' page](../judges.md): on the sign-in page they tap **Have a password? Sign in with it**.
4. **The launch set.** Publish the designs and remixes in [launch-set.md](launch-set.md), so the feed, Trending, and family trees have something in them when judges arrive.

## While judges are on the site

- **The bell**, signed in as the owner. Alerts arrive there and by email to the owner and ops: the gateway credit under $10 or out, and later, once those parts are on, a relayer out of MON and orders that can't go on by themselves.
- **Admin, Overview**: Gateway credit (a red "Low" line under $10), Browser errors (pages that broke in someone's browser, by page and count), and Ready to sell.

## When something goes wrong

| What someone sees | Why | What to do |
| --- | --- | --- |
| The studio says "The studio can't make designs right now. Try again in a little while." | The CultRemix Gateway account is out of credit. | Add credit to the Gateway account; designs work again right away. The failed designs' credits went back to their makers. |
| "The studio is resting until tomorrow." | The day's image budget is spent. | Raise the daily budget in Admin, Overview, Settings, or wait for 5 p.m. Pacific. |
| A batch's designs all failed with the filter note | The image model's filter refused the request; it's sometimes wrong. | **Try again** on the batch's line, or reword the request. The failed designs' credits came back. |
| A judge can't sign in | A lost or mistyped password. | Admin, Judges: their email and username with "Give an existing judge a new password", then send it privately. |
| A judge is out of credits | 40 credits make 20 batches. | Admin, Members: search for them, then Give credits. |
| "A remix can change" lists words the design doesn't say | The notes reader misread its lettering. | Ops: `bunx convex run --prod images:rereadWorkNotes '{"cr":"<number>"}'` reads it again. Its creator can also switch words off with Edit on the design's page. |
| Something offensive or infringing is published | Anyone can upload images. | Signed in as the owner, open its page and press **Take this design down**: it disappears from the site, its sale and printing stop, and its creator is told why. Admin, Overview lists takedowns and can put one back up. |
| "Publishing is paused for now" | The Publishing switch is off. | Admin, Overview, Switches: turn Publishing on. |
| Browser errors lists something | A page broke in someone's browser. | Send the Builder the page, the message, and the count. |

## What judges see that's expected

- **Early access** in the header (production never says Testnet).
- **Buying opens soon** and **Tell me when it's ready** on shop pages, until Checkout is on.
- **Queued for Monad: it's recorded once the registry goes live** under a new design's fingerprint, until the mainnet registry is up, Monad records is on, and members have Circle wallets.
- **Draft, under review** on the store policies, until you approve them.
