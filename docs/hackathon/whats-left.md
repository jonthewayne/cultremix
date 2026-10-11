# What's left for the hackathon

As of October 7, 2026, 9 p.m. Pacific. The Monad submission is due **Tuesday, October 13, 20:59 PDT**. This replaces the October 6 version, which planned a separate staging project.

## Decided October 7

- **Two environments in the one Convex project.** Dev is the private rehearsal on Monad testnet, reached over the tailnet. Production (cultremix.com) is the live store and the site judges use, and it records on Monad mainnet. There's no staging project, so the launch checklist's staging section needs rewriting.
- **Real orders on production before the 13th.** Shopify runs checkout on its Basic plan with Shopify Payments, and the Headless channel puts that checkout behind cultremix.com. Printful prints each shirt to order (DTG). Orders go live in four steps:
  1. Test orders on a free Shopify development store.
  2. One test-mode order on the live store.
  3. A real order.
  4. Checkout turns on.
- **Shirts.** We offer mid-to-high-end shirts only, picked in `/admin/products`. The recommended launch shirt is the Bella+Canvas 3001 at $29 ($31 for 2XL). The Comfort Colors 1717 (heavyweight) and Bella+Canvas 4810GD (oversized) can follow. Jon hasn't picked yet.
- **Creators' 15% stays.** Payouts start after judging, either in USDC on Monad or as Stripe bank deposits with a $50 minimum. The first earnings become payable in mid-November.
- **Production's relayer** is `0x1672581d1B190d045197439039446bD48bd9a74A`, created October 7. Its key is `MONAD_RELAYER_PRIVATE_KEY_PROD` in `~/.config/cultremix/chain.env`. It will deploy the mainnet registry, which also makes it the registry's admin (lineage corrections and the economics rules need that role).

## Waiting on Jon

1. **Decisions.** Pick the launch shirt and its price, and confirm $5.95 flat US shipping and the 15% creator pool for real orders.
2. **Production go**, so Ops can deploy production.
3. **Sign-ups only Jon can do**, because they ask for a card, identity, bank or tax details, or acceptance of terms:
   - Shopify: the Basic plan and Shopify Payments.
   - Printful: billing.
   - Circle: a developer account, with a test key now and a live key for production.
4. **A Screen Sharing session on mighteous.** Jon signs in once, in a Chrome window with its own profile, and the Builder does the rest of the setup there.
5. **MON.** Testnet faucet MON for dev's relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921`, and about 100 MON for production's relayer.
6. **A backup of production's relayer key** in Jon's password manager, copied over Screen Sharing.
7. **The hackathon pieces.**
   - Make the repo public.
   - Paste the submission form's fields into [submission.md](submission.md).
   - Invite the first creators.
   - Record the two videos on October 11–12.

## Builder work

**Live ordering:**

1. ~~Checkout sells the active shirt from `/admin/products`.~~ Done October 10, for several products: creators pick the products a design comes on and place it once; each product has its own prices, back-print extra, and print areas ([products.md](reports/products.md)).
2. ~~The owner approves each work for sale.~~ Done October 10: approving makes a print file for each product (upscale, render, print check) and a Shopify product for each.
3. ~~Shopify's privacy webhooks.~~ Done October 10 (`convex/privacy.ts`): data requests wait on /admin/orders for the owner; removals clear addresses and raw order bodies; addresses also go 30 days after shipping.
4. ~~Tracking to Shopify.~~ Done October 10 (`convex/shopifyFulfill.ts`): each Printful shipment becomes a Shopify fulfillment with tracking, and Shopify emails the buyer.
5. ~~Store policies.~~ Drafted October 10 at /policies (shipping, returns, privacy, terms), marked as drafts until Jon approves them.
6. The order rehearsal runs once the accounts exist ([launch checklist](../launch-checklist.md), "Dev: rehearse each piece").

**Monad:**

7. The testnet registry goes up on dev, then a few designs are published there and the real costs measured.
8. Circle wallets get tested on dev with test keys, then production switches to live keys.
9. The mainnet registry and the economics rules go up on production: `bun run chain:deploy:mainnet --broadcast --confirm-mainnet` once production's relayer has about 0.47 MON (the dry run works now).

**Launch:**

10. ~~The launch checklist.~~ Rewritten October 10 for dev and production ([launch-checklist.md](../launch-checklist.md)).
11. The submission package:
    - a logo file;
    - README, submission, and judges docs brought up to date;
    - a demo script of 3 minutes or less and a pitch script of 2 minutes or less.

**If time allows:** a list of kept designs, signed-in end-to-end tests, the QA leftovers, and the studio follow-ups.

**After judging:** payouts, more shirts, a Printify price comparison, and a registry admin key separate from the relayer's.

## A possible week

| Day | Jon | Builder and Ops |
|---|---|---|
| Wed–Thu Oct 7–8 | Decisions, sign-ups, the setup session, MON | Checkout from the chosen shirt, approval and print files, privacy webhooks; production deploy |
| Fri Oct 9 | Try a test order | Test orders on the development store; the testnet registry once faucet MON lands |
| Sat–Sun Oct 10–11 | A real order; record the videos | Live test-mode order; mainnet registry; Circle |
| Mon Oct 12 | Review the submission | Submission package; production smoke test |
| Tue Oct 13 | Submit by 20:59 PDT | Buffer |
