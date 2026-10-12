# Launch checklist

CultRemix has two environments in one Convex project:

| | Dev | Production |
| --- | --- | --- |
| What it is | The private rehearsal | The live store and the site judges use |
| Where | mighteous, over the tailnet | cultremix.com |
| Convex deployment | `vibrant-rook-798` | `savory-tiger-504` |
| Monad | testnet, relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921` | mainnet, relayer `0x1672581d1B190d045197439039446bD48bd9a74A` |
| Shopify | a free development store | the live store (Basic plan, Shopify Payments, Headless channel) |
| Printful | a store whose orders stop at drafts | the live store; drafts are confirmed after the 1-hour hold |
| Circle | test keys | live keys |
| Who deploys | the Builder, by pushing to `dev` | the Ops thread, from its own clone, when Jon says go |

There's no staging project. Nothing is copied between the two; each is set up by its own commands. Secret values come from `~/.config/cultremix/*.env` or the owner's key store and never go into docs, chat, or commits.

## Every production deploy

- [ ] `bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:e2e` pass on the commit.
- [ ] When the deploy changes publishing, remixing, or the work page: `bun run test:e2e:publish` passes on dev (real image calls, about 35¢; it takes its designs down after).
- [ ] The Builder's Ops message names the commit, the schema changes, any env to set, and the jobs to run. It replaces earlier messages, so only the latest one is followed.
- [ ] Ops backs up production first (`bunx convex export --prod --include-file-storage`), builds the Worker, then runs `bunx convex deploy` and `wrangler deploy` back to back, because production's old pages and new functions don't work together ([Cloudflare deployment](deployment-cloudflare.md#production-deploys)).
- [ ] The build log (`docs/hackathon/log.md`) has an entry for it.
- [ ] After the deploy: `BASE_URL=https://cultremix.com bun run test:e2e` ends with "E2E smoke complete", and the Ops message's checks pass.

## Dev: rehearse each piece

### The shop

Jon signs in once in a Screen Sharing session on mighteous; the Builder does the rest there.

- [ ] **Shopify development store** (free). In the Dev Dashboard, a custom app with these Admin scopes: `write_products`, `read_products`, `write_publications`, `read_publications`, `read_orders`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`, `read_shopify_payments_disputes`. The last lets chargebacks hold and take back their creators' earnings; without it **Connect Shopify** still connects and says the dispute webhooks are missing.
  - Its compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) point at `https://<dev convex site>/webhooks/shopify`, set in the app's settings. The order and dispute webhooks are subscribed by **Connect Shopify** below.
  - The Headless channel, with a Storefront private token.
  - A $5.95 flat shipping rate for the United States.
  - Buyers finish on Shopify's order status page, whose "Continue shopping" link goes to the store's own online store. Point it home: in Online Store, Themes, Edit code, add `<script>location.replace("https://cultremix.com")</script>` at the top of `theme.liquid`'s `<head>` (dev: the dev site's address), so anyone who lands on the Shopify storefront ends up on CultRemix.
- [ ] **Printful**: a store for dev (API) with its token and store id.
- [ ] **Dev env**: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `PRINTFUL_API_TOKEN`, `PRINTFUL_STORE_ID` in Convex; `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` for the dev server. Never `PRINTFUL_AUTO_CONFIRM`.
- [ ] **Connect**: in Admin, For sale, press **Connect Printful** (sets its webhooks and keeps the signing key) and **Connect Shopify** (subscribes the order webhooks, and warns if the Headless channel is missing). Both say what they set up.
- [ ] **Products**: in Admin, Products, add the shirts on offer and set each one's name, prices, and back-print extra. Press **Check with Printful** on each, so its print areas come from Printful's print files.
- [ ] **For sale**: turn on Print-size art, approve two designs (one with a back print). Each product gets a print file; open them and check the placement. Their Shopify products appear in the development store as drafts while Checkout is off.
- [ ] **A test order**: turn on Checkout on dev (its Shopify products become active within a few seconds), buy with the development store's test payment gateway (Bogus Gateway), and check that /admin/orders shows it paid, Printful has a draft with the right file on the right side, and the creator's earnings show on /me/earnings as Test, with "Someone bought …" in their notifications. (Before Shopify exists, **Simulate a sale** on a For sale row shows the same earnings and notifications.)
- [ ] **A kept design**: press Get it printed on a kept design, approve it under "Kept designs to print" in For sale, and check that its Shopify product is **Unlisted** with a handle starting `kept-`, that it doesn't appear in the development store's product search, and that its creator can buy it from the kept page (Shopify says unlisted products work in carts and checkout). Turn Checkout off and on again: every product goes to Draft, then back to Active (Unlisted for the kept one). Then share it with the world: the kept product is archived, and approving the shared design makes a new product under its CR number.
- [ ] **Placement check in Printful**: open the draft in Printful and confirm the design sits where the preview showed it. This settles whether a whole-area file needs a position. Then delete the draft.

### Monad

- [x] Dev's Convex has its relayer key: `MONAD_RELAYER_PRIVATE_KEY`, set October 11 from `MONAD_RELAYER_PRIVATE_KEY_DEV` without printing it. /admin/chain shows the relayer's address and balance (it said "MONAD_RELAYER_PRIVATE_KEY is not set" before).
- [ ] Testnet MON for dev's relayer from the faucet.
- [ ] `bun run chain:deploy:testnet` (a dry run), then `bun run chain:deploy:testnet --broadcast`. Record the address in `shared/config/chains.ts` (`CHAIN_ENVIRONMENTS.dev.registryAddress`) and push.
- [ ] /admin/chain: turn chain writes on and register economic config v1. Turn on Monad records in /admin, publish two designs, and check each one's record on testnet.monadscan.com and /onchain. Note the real cost per publish.

### Circle

- [ ] Jon: a Circle developer account, and a test API key (Circle's console, Keys) in `~/.config/cultremix/circle.env` as `CIRCLE_API_KEY_TEST=...`. That's the only part that needs Jon.
- [ ] Builder: `bun run circle:setup --env dev --apply`. It tries Circle's two API hosts with the key, registers a new entity secret (saved in `circle.env` before Circle sees it, with Circle's recovery file beside it), makes dev's wallet set, and sets dev's `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and `CIRCLE_WALLET_SET_ID` (and `CIRCLE_API_BASE` if only the sandbox host took the key), piped in so they're never printed. Commit the wallet set ID it prints as `CHAIN_ENVIRONMENTS.dev.circleWalletSetId`. New members get a testnet wallet within five minutes.

## Production: go live

Admin, Overview starts with **Ready to sell**: each piece below for real orders and Monad records, ticked once it's in place on that deployment (keys set, Printful and Shopify connected, products picked, print files possible, designs on sale, paid orders sent to print, Checkout, the registry, the relayer key, member wallets, and Monad records), with what each missing one needs. It reads only whether each env value is set.

While judges use the site, [Judging days](hackathon/judging-runbook.md) says what to watch and what to do when something goes wrong.

### What Jon does first

- [ ] Decide: the launch shirts and prices, $5.95 flat US shipping, and the 15% creator pool.
- [ ] Sign up: Shopify Basic with Shopify Payments (as an individual for now; business details can change later), Printful billing, and Circle with a live key.
- [ ] About 1 MON for production's relayer (deploying the registry needs about 0.47 MON on hand, and each publish costs a few hundredths), and a backup of its key in the password manager.
- [ ] Approve the store policies at /policies (they say "Draft, under review" until then), and paste the same text into Shopify's Settings, Policies.
- [ ] Credit on the CultRemix Gateway account for the judging days: about $50. Admin, Overview shows what's left (Gateway credit); every design, note, and model photo is paid from it, about 13¢ a batch, and a judge using all 40 credits spends about $2.60.

### Deploy (Ops)

- [ ] Follow the latest Ops message: pull, install, set production's env, back up production, build, `bunx convex deploy` and `wrangler deploy` back to back, then the seeds and backfills.
- [ ] Production's env for the shop: the live store's `SHOPIFY_*` values, Printful's live `PRINTFUL_API_TOKEN` and `PRINTFUL_STORE_ID`, and `PRINTFUL_AUTO_CONFIRM=true`. The live store's app has the same scopes as dev's, and its privacy webhooks point at `https://savory-tiger-504.convex.site/webhooks/shopify`.
- [ ] On production's Admin, For sale: **Connect Printful** and **Connect Shopify**. In Admin, Products: **Check with Printful** on each product.

### Monad mainnet

- [ ] Ops sets production's relayer key: `MONAD_RELAYER_PRIVATE_KEY` on production's Convex, from `MONAD_RELAYER_PRIVATE_KEY_PROD` in `~/.config/cultremix/chain.env`, never printed. /admin/chain on production then shows the relayer `0x1672…a74A` and its MON. Nothing is sent while chain writes are off.
- [ ] `bun run chain:deploy:mainnet` (a dry run: balance and cost), then `bun run chain:deploy:mainnet --broadcast --confirm-mainnet`.
- [ ] Record the address as `CHAIN_ENVIRONMENTS.prod.registryAddress`, push, and have Ops deploy.
- [ ] Circle for production: with Jon's live key in `circle.env` as `CIRCLE_API_KEY_LIVE`, Ops runs `bun run circle:setup --env prod --apply` (it asks to type "production"). Commit the wallet set ID as `CHAIN_ENVIRONMENTS.prod.circleWalletSetId`, and back up `circle.env` and both recovery files in the password manager: Circle can't recover an entity secret, and it controls every member wallet. Each Monad record names its creator's wallet, so until this step every record waits; afterwards members get wallets within five minutes, and the records queued for them go out.
- [ ] /admin/chain on production: turn chain writes on and register economic config v1. Then turn on Monad records in /admin.

### Orders, in four steps

1. [ ] Products and prices set in Admin, Products; a few designs approved in Admin, For sale, with their Shopify products made (drafts while Checkout is off).
2. [ ] Turn Checkout on in /admin: the Shopify products become active, and work pages show the buy box. Then one order in Shopify Payments' test mode on the live store, end to end: a Printful draft, deleted. Turn Checkout off again if the store shouldn't open yet.
3. [ ] One real order (Jon buys a shirt, with Checkout on). If an order ever can't go on by itself, the owner gets a bell notification and an email ("Order #1001 needs you") within 15 minutes, linking to Admin, Orders. So does a paid order that hasn't reached Printful an hour after payment (Printful not connected, or its calls failing), and in production a draft an hour past its hold that hasn't been confirmed (`PRINTFUL_AUTO_CONFIRM` missing, or **Send paid orders to print** off in Admin, Switches). It prints and ships; Shopify emails the tracking, and /admin/orders shows "buyer emailed by Shopify".
4. [ ] Leave Checkout on: the store is open, and "Buying opens soon" is gone. Then in Admin, Waitlist, press **Email them**: everyone who left an email under "Buying opens soon" for a design now on sale gets one email. Press it again after approving more designs. To stop selling at any time, turn Checkout off: the buy box goes, and Shopify's products become drafts, so even a cart made earlier can't check out.

### Judges

- [ ] `judges.txt` (gitignored): one judge per line, email then username.
- [ ] `bun run judges:provision -- --prod --dry-run --file judges.txt`, then without `--dry-run`. Send each judge their password privately from `.judges.local.json`, then delete the file.
- [ ] Sign in as one judge on a phone: the studio opens with their credits.

### Smoke test (phone and desktop)

- [ ] The header says Early access until Checkout is on, never Testnet.
- [ ] A new member signs in with an email code, picks a username, and gets starting credits.
- [ ] Studio: Generate makes four designs together; one opens full screen.
- [ ] Publish: pick the products it comes on and place it on the drawn shirt; the CR reveal follows, the model photo arrives, and the work page shows its lineage and economics.
- [ ] Remix it as a variation and as a fork.
- [ ] With Checkout on: the work page's buy box shows each style, color, and size; an order reaches /admin/orders.
- [ ] Signed out: the feed, a work page, a profile, /onchain, and the four policies load.

## After launch

- [ ] Fill in [Launch metrics](launch/metrics.md) each day from /admin/metrics.
- [ ] Keep [Cohort notes](launch/cohort.md) for the first members.
- [ ] Answer privacy requests on /admin/orders within 30 days.
- [ ] After judging: turn off judges' creator access (Admin, Members).
- [ ] Once real orders flow: turn on **Sale emails** in Admin, Overview, so creators get an email when a design they share in sells. They come from the sign-in address; members can turn them off in Settings.
- [ ] From mid-November, pay creators from Admin, Payouts: it lists each creator's payable balance. Send the money by USDC or bank, then record it there with its reference (the amount has to match the balance shown).

