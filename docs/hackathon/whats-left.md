# What's left for the hackathon

As of October 11, 2026, 4:30 a.m. Pacific. The Monad submission is due **Tuesday, October 13, 20:59 PDT**. This replaces the October 7 version.

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
2. **Production go**, so Ops can deploy production. Production is still on 8bc367d (September 30); the [Ops message](../launch-checklist.md#deploy-ops) brings it up to dev.
3. **Sign-ups only Jon can do**, because they ask for a card, identity, bank or tax details, or acceptance of terms:
   - Shopify: the Basic plan and Shopify Payments.
   - Printful: billing.
   - Circle: a developer account, with a test key now and a live key for production.
4. **A Screen Sharing session on mighteous.** Jon signs in once, in a Chrome window with its own profile, and the Builder does the rest there: the development store and its app (scopes in the [launch checklist](../launch-checklist.md#the-shop)), the Headless channel's token, the shipping rate, and Printful's store and token. Then three presses in Admin finish the setup: **Connect Printful**, **Connect Shopify**, and **Check with Printful**.
5. **MON.** Testnet faucet MON for dev's relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921`, and about 1 MON for production's relayer (deploying the registry needs about 0.47 MON on hand; each publish costs a few hundredths).
6. **A backup of production's relayer key** in Jon's password manager, copied over Screen Sharing.
7. **The hackathon pieces.**
   - Make the repo public.
   - Approve the store policies at /policies, then paste them into Shopify.
   - Paste the submission form's fields into [submission.md](submission.md).
   - Invite the first creators.
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

**If time allows:** ~~a list of kept designs~~ and ~~signed-in end-to-end tests~~ are done (October 10). October 11 added a demo rehearsal with its fixes, clean hydration on signed-in pages, an accessibility check (`bun run test:a11y`), loading skeletons, a fingerprint check on /onchain, and faster pages (Lighthouse mobile home 60 to 92). The production build was also run in the Workers runtime: it needs production's Convex deployed first, which the Ops message now says.

**After judging:** more products, a Printify price comparison, a small second design on the front of a back print, and a registry admin key separate from the relayer's.

## The last three days

| Day | Jon | Builder and Ops |
| --- | --- | --- |
| Sun Oct 11 | Decisions, sign-ups, the setup session, MON; record the videos | Store and app setup in the session, test orders on the development store; production deploy on Jon's go |
| Mon Oct 12 | A real order; review the submission | Testnet registry once faucet MON lands; mainnet registry once production's relayer has MON; production smoke test |
| Tue Oct 13 | Submit by 20:59 PDT | Buffer |

