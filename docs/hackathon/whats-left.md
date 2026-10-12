# What's left for the hackathon

As of October 12, 2026, 12:17 a.m. Pacific. The Monad submission is due **Tuesday, October 13, 20:59 PDT**. This replaces the October 7 version.

## Decided October 7

- **Two environments in the one Convex project.** Dev is the private rehearsal on Monad testnet, reached over the tailnet. Production (cultremix.com) is the live store and the site judges use, and it records on Monad mainnet.
- **Real orders on production before the 13th.** Shopify runs checkout on its Basic plan with Shopify Payments, and the Headless channel puts that checkout behind cultremix.com. Printful prints each shirt to order (DTG). Orders go live in four steps:
  1. Test orders on a free Shopify development store.
  2. One test-mode order on the live store.
  3. A real order.
  4. Checkout turns on.
- **Shirts.** We offer mid-to-high-end products only, picked in `/admin/products`. The recommended launch shirt is the Bella+Canvas 3001 at $29 ($31 for 2XL); the Comfort Colors 1717 (heavyweight) and Bella+Canvas 4810GD (oversized) can follow. Dev rehearses with the 1717 at $36 and the Gildan 18500 hoodie at $56. Jon hasn't picked production's yet.
- **Creators' 15% stays.** Payouts start after judging, either in USDC on Monad or as bank deposits with a $50 minimum. The first earnings become payable in mid-November.
- **Production's relayer** is `0x1672581d1B190d045197439039446bD48bd9a74A`, created October 7. Its key is `MONAD_RELAYER_PRIVATE_KEY_PROD` in `~/.config/cultremix/chain.env`. It will deploy the mainnet registry, which also makes it the registry's admin (lineage corrections and the economics rules need that role).

## Waiting on Jon

1. **Decisions.** Pick the launch products and their prices, and confirm $5.95 flat US shipping and the 15% creator pool for real orders.
2. **Production go**, so Ops can deploy production. Production is still on 8bc367d (September 30); the [Ops message](../launch-checklist.md#deploy-ops) brings it up to dev. It backs up production first, then deploys Convex and the Worker back to back. The whole sequence ran on a copy of production's data on October 11 ([Rehearsing a big deploy](../deployment-cloudflare.md#rehearsing-a-big-deploy)), and every step passed.
3. **Sign-ups only Jon can do**, because they ask for a card, identity, bank or tax details, or acceptance of terms:
   - Shopify: the Basic plan and Shopify Payments.
   - Printful: billing.
   - Circle: a developer account and two API keys from its console (Keys), a test key and a live key, saved in `~/.config/cultremix/circle.env` as `CIRCLE_API_KEY_TEST` and `CIRCLE_API_KEY_LIVE`. `bun run circle:setup` does the rest: it registers each environment's entity secret, keeps the secret and Circle's recovery file beside the key (back them up), makes the wallet set, and sets the env. Monad records on production need it: each record names its creator's wallet, and production's wallets come only from Circle, so without it every record waits. In the October 11 rehearsal, production's 11 earlier works queued and all 11 waited for wallets.
4. **A Screen Sharing session on mighteous.** Jon signs in once, in a Chrome window with its own profile, and the Builder does the rest there: the development store and its app (scopes in the [launch checklist](../launch-checklist.md#the-shop)), the Headless channel's token, the shipping rate, and Printful's store and token. Then three presses in Admin finish the setup: **Connect Printful**, **Connect Shopify**, and **Check with Printful**.
5. **FAL_KEY on production, and Print-size art on.** Judges trying **Prepare for print** (a row in the submission's Judging evidence) can trim and place without them, but upscaling and removing a background need both: production's Convex env needs `FAL_KEY` (it's in `~/.config/cultremix/fal.env`, and the Ops message's step 2 can set it), and an admin turns on Print-size art in Admin, Switches. Each upscale is about 8¢ of fal credit and a background removal about 2¢; members pay 2 credits per upscale.
6. **Gateway credit.** The CultRemix Gateway account had $12.74 on October 11 at 11 p.m. (Admin, Overview shows it). Judges' designs, notes, and model photos are paid from it, about 13¢ a batch, so add credit (about $50) before judging.
7. **MON.** Testnet faucet MON for dev's relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921` (dev already has its relayer key, so the testnet registry can go up as soon as the MON lands), and about 2 MON for production's relayer. Measured October 12 at mainnet's 102 gwei: deploying burns about 0.2 MON (the script wants 0.47 on hand first), each design's record about 0.021 MON (registerWork, about 179,000 gas, and Monad charges for the gas limit), and a Back about 0.011. So 1 MON covers about 37 records after the deploy, while production's earlier designs, the launch set, judges' designs, and their remixes could pass 50; 2 MON covers about 85. MON was about 2.6¢ on OKX on October 12, so an exchange's minimum purchase will buy far more than that: about $5 buys some 190 MON, thousands of records. A relayer that runs out tells the owner, and records wait until it's topped up. OKX sells MON and withdraws it on the Monad network straight to the relayer's address (Coinbase lists MON too; check that its withdraw screen offers the Monad network). Pick the network named Monad, never Ethereum or Base, and send a small test amount first.
8. **A backup of production's relayer key** in Jon's password manager, copied over Screen Sharing.
9. **The hackathon pieces.**
   - Make the repo public. Checked October 11: none of the 404 commits holds a secret (the known keys, and the shapes of OpenAI, Cloudflare, Shopify, Circle, fal, Resend, Gateway, and private keys). Your Gmail address is gone from the current docs but stays in two September 29 commits; rewriting history would change every later commit hash the build log cites, so leave it unless that matters to you. The ChatGPT archive in `docs/reference/` has no memories or custom instructions (the share link strips them). There's no LICENSE file, so the code stays all rights reserved unless you add one.
   - Approve the store policies at /policies, then paste them into Shopify.
   - Paste the submission form's fields into [submission.md](submission.md).
   - Invite the first creators.
   - Once production is deployed, publish 8 to 10 designs there and a few remixes of them (variations and a fork), so judges land on a full feed, Trending, and family trees. [launch-set.md](launch-set.md) has requests that worked on dev, about $2 and half an hour in all.
   - Record the two videos ([scripts](video-scripts.md)).

## Builder work

**Live ordering, all built:**

1. ~~Checkout sells the products on offer.~~ Done October 10, for several products: creators pick the products a design comes on and place it once; each product has its own prices, back-print extra, and print areas ([products.md](reports/products.md)).
2. ~~The owner approves each work for sale.~~ Done October 10: approving makes a print file for each product (upscale, render, print check) and a Shopify product for each.
3. ~~Shopify's privacy webhooks.~~ Done October 10 (`convex/privacy.ts`).
4. ~~Tracking to Shopify.~~ Done October 10 (`convex/shopifyFulfill.ts`): each Printful shipment becomes a Shopify fulfillment with tracking, and Shopify emails the buyer.
5. ~~Store policies.~~ Drafted October 10 at /policies, marked as drafts until Jon approves them.
6. ~~Store setup from Admin.~~ Done October 10: Connect Printful, Connect Shopify, and Check with Printful replace hand-copied webhooks and print sizes.
7. ~~Payouts.~~ Done October 10: Admin, Payouts lists each creator's payable balance and records payments; creators see them on /me/earnings.
8. ~~Sale notifications.~~ Done October 11: "Someone bought Slow Roll CR 106-001. You earn $5.40." On dev, **Simulate a sale** shows a sale's earnings and notifications without Shopify. Sale emails are built behind a switch that starts off (turn on in Admin once real orders flow).
9. ~~Ordering kept designs.~~ Done October 11: **Get it printed** on a kept design's page; Admin approves it for its creator alone, and it sells to them from their private page.
10. The order rehearsal runs once the accounts exist ([launch checklist](../launch-checklist.md), "Dev: rehearse each piece").

**Monad:**

11. The testnet registry goes up on dev, then a few designs are published there and the real costs measured.
12. Circle wallets get tested on dev with test keys, then production switches to live keys.
13. The mainnet registry and the economics rules go up on production: `bun run chain:deploy:mainnet --broadcast --confirm-mainnet` once production's relayer has its MON (the dry run works now).

**Launch:**

14. ~~The launch checklist.~~ Rewritten October 10 for dev and production ([launch-checklist.md](../launch-checklist.md)).
15. ~~The submission package.~~ Done October 10: logo PNGs (`cultremix-logo.png`, `cultremix-logo-wide.png`), README, submission, and judges docs, and the demo and pitch scripts.
16. `A judging-days runbook.` Done October 11: [judging-runbook.md](judging-runbook.md), what to watch while judges are on the site and what to do when something goes wrong.
17. `An end-to-end test of the core flow.` Done October 11: `bun run test:e2e:publish` makes a batch, publishes it, waits for its remixable words, remixes a word, publishes the variation, and checks the family, with real image calls on dev (about 35¢), taking its designs down after. Its first run found a design page opened during the last second and a half of publishing stuck on "This design isn't published"; fixed the same night.

**If time allows:** ~~a list of kept designs~~ and ~~signed-in end-to-end tests~~ are done (October 10). October 11 added a demo rehearsal with its fixes, clean hydration on signed-in pages, an accessibility check (`bun run test:a11y`), loading skeletons, a fingerprint check on /onchain, and faster pages (Lighthouse mobile home 60 to 92). The production build was also run in the Workers runtime against both versions of the functions: production's current pages and the new functions crash each other's work pages, so the Ops message backs up production, then deploys Convex and the Worker back to back ([Production deploys](../deployment-cloudflare.md#production-deploys)). Since then: **Try again** on a batch whose designs all failed (a filter block), Admin in the site's own header and light page with its tabs kept on the Monad tab, an Admin link in the account menu, and the last 40 px tap targets from the QA report. Kept designs stay private past checkout: their Shopify products are unlisted under unguessable handles, sharing one archives them, and a kept design's sale never names it to the original's creator ("Someone bought a private remix of your …"). The signed-in pages passed an accessibility check, now part of the signed-in e2e, after two fixes. And Printful only gets the approved print file (the plan's INV-10): each file is checked against its fingerprint just before an order is made, and a changed one is made again before the order goes. Chargebacks and inquiries (INV-23) hold their order's earnings while open, take them back when the buyer wins a chargeback, and release them otherwise; the Shopify app needs `read_shopify_payments_disputes` for their webhooks. The Print Studio can **Remove background** from art on an opaque background (fal's BiRefNet, about a fifth of a cent), so a design whose background knockout can't clear can still be sold. Admins can **Take this design down** from its page (the plan's withdraw, INV-27), which matters for a public site where anyone uploads images: it hides the design, stops its sale and printing, and tells its creator why; Admin, Overview can put it back up. A Shopify sync that finishes after a takedown now drafts its product too, and payouts wait out an open dispute on earnings that had already matured. Turning **Checkout** off now makes every Shopify product a draft, so even a cart made earlier can't check out (the plan's commerce rollout). The studio checks spelling: a batch that asks for words has each design's lettering read back, and a design drawn a letter or two off is marked, with **Fix the spelling** (approved October 5), which the image test suite checks (`words-fix-spelling`, and the `spelling` group's 16 finished designs, three of them misspelled). Uploads are stored only as real images, at most 60 new ones an hour per member, and **Add a part** is limited to 30 model reads an hour. Judges see a **Welcome, judge** list in the studio, the early-access list gets its one email from Admin, Waitlist once Checkout is on (**Email them**), a kept design's creator hears when it's ready to print, stuck orders, paid orders still not at Printful an hour on, a low image credit, and a relayer out of MON tell the owner and ops (bell and email), Admin, Switches has **Send paid orders to print** (pausing Printful confirmations), creator access decides earnings the way plan A1 says, a design taken down gets no new remixes published and its kept remixes can't be printed, taking a product off sale drafts it in Shopify, every page sends security headers, Admin, Overview starts with **Ready to sell** (what's left before real orders and Monad records, row by row) and lists **Browser errors** people hit, work pages list what a remix of the design can change and say its Monad record is queued until the registry goes live, putting a design back up tells its creator, and Admin, Overview shows the **Gateway credit** left, which pays for every design: it was $12.74 at 11 p.m., about 98 batches, and a judge who uses all 40 credits spends about $2.60, so it needs topping up before judging.

**The V1 plan, checked October 11.** Its requirements (R1–R44) against the build: everything is built except the per-member ChatGPT connection (R30–R32), which the September 29 sprint plan deferred and no later plan picked up, so every design is made through the CultRemix Gateway, and the Print Studio's "AI touch-up by instruction" (R8), which the studio's **Start from this** covers before publishing (a touch-up after publishing would print something other than the published, fingerprinted design). R8's background removal was missing too (an earlier version of this note said otherwise) and was built October 11, along with the invariants INV-10 (Printful gets the approved file) and INV-23 (disputes). R44's "staging link on testnet" became production on mainnet with the October 7 decision; dev stays the testnet rehearsal.

**After judging:** more products, a Printify price comparison, a small second design on the front of a back print, and a registry admin key separate from the relayer's.

## The last three days

| Day | Jon | Builder and Ops |
| --- | --- | --- |
| Sun Oct 11 | Decisions, sign-ups, the setup session, MON; record the videos | Store and app setup in the session, test orders on the development store; production deploy on Jon's go |
| Mon Oct 12 | A real order; review the submission | Testnet registry once faucet MON lands; mainnet registry once production's relayer has MON; production smoke test |
| Tue Oct 13 | Submit by 20:59 PDT | Buffer |

