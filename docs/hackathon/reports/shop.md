# Shop report (V1 U9 and U10)

Branch `codex/shop`, on top of `042efbd` (Economics: shared split rules). Not pushed.

Every published work can now be bought, and each paid order goes to print and to creator earnings. All of it runs against faked Shopify and Printful clients. When the keys arrive, what's left is setting the env vars, registering the webhooks, filling in the Printful catalog IDs, and turning on `commerce.checkout`.

| Commit | Step |
| --- | --- |
| `aca5464` | 1. Shopify product sync behind `commerce.checkout` |
| `1c658d6` | 2. Cart and checkout on the work page behind `commerce.checkout` |
| `4883b67` | 3 and 4. Shopify order webhooks, hydration, refunds, and the earnings ledger |
| `fa49b33` | 4. `/me/earnings` and the owner-only `/admin/orders` |
| `cc65bbe` | 5. Printful fulfillment: drafts, hold then confirm, webhooks, reconciliation |
| `073f5b6` | Env var docs |
| this commit | This report |

## Files built

### Convex

| File | What it does |
| --- | --- |
| `convex/schema/shop.ts` | `shopTables`: `shopProducts`, `workVariants`, `shopifyTokens`, `shopCursors`, `webhookEvents`, `webhookPayloads`, `shopifyInbox`, `orders`, `orderItems`, `refunds`, `orderShipments`, `earnings` |
| `convex/shopify.ts` | Product sync on publish (`onPublished`, `syncWork`, `syncAllPublished`, `retryDueProducts`), the token cache, and the public `offer` query (null while checkout is off) |
| `convex/orders.ts` | Webhook ingest, hydration from the Admin API, the 15-minute reconcile, payload purge, and the owner-only `adminList` |
| `convex/earnings.ts` | Earnings rows per line, unit, and recipient; reversals on refund success; maturity; `mine` for the signed-in member; `releaseCreatorHolds` |
| `convex/fulfillment.ts` | The Printful workflow (`advance`, `run`, the lease, record, confirm, delete draft, apply refunds), `ingestPrintfulEvent`, and the 30-minute `reconcile` |
| `convex/crons.ts` | New file. All entries sit between the `Shop` markers: order reconcile (15 min), product retry (15 min), Printful reconcile (30 min), earnings maturity (1 h), and the daily payload purge |
| `convex/http.ts` | Adds `POST /webhooks/shopify` and `POST /webhooks/printful` |
| `convex/lib/shopify/adminClient.ts` | Admin GraphQL client. It caches the client-credentials token, refreshes it early and on a 401, and its fetch can be replaced in tests |
| `convex/lib/shopify/productSync.ts` | `productSet` by handle `cr-FFF-EEE`, the 4 colors × S–2XL variants, publishing to the Headless channel, and the SKU `CR-FFF-EEE-<COLOR>-<SIZE>` |
| `convex/lib/shopify/orderQuery.ts` | The order query and `normalizeOrder` (lines, payment time, recipient, refunds, and their transactions) |
| `convex/lib/shopify/reconcile.ts` | Pages through orders updated since the cursor |
| `convex/lib/shopify/webhookVerify.ts` | Base64 HMAC-SHA256 over the raw body, in constant time |
| `convex/lib/shopify/webhookRoute.ts` | Checks size, HMAC, shop domain, and topic. It stores the event, payload, and inbox entry, then answers 200 |
| `convex/lib/printful/client.ts` | Printful v2 client: orders by `@external_id`, create, confirm, delete, item PATCH and DELETE, and shipments. It classifies errors as ambiguous or definite and maps statuses |
| `convex/lib/printful/webhookVerify.ts` | Hex HMAC-SHA256 of `x-pf-webhook-signature`. The dedupe key ignores `retries` |
| `convex/lib/printful/webhookRoute.ts` | Checks the signature and store, then dedupes and ingests |
| `convex/lib/creatorPool.ts` | Allocates units, refunds, and shipments over the economics split rules |
| `convex/lib/shopFlags.ts` | `commerce.checkout` (default off), the `fulfillment.autoConfirm` kill switch, and a strict `DEPLOYMENT_ENV` reader |
| `convex/lib/shopLineage.ts` | Reads a work's lineage for the recipient table, frozen at hydration |

Small edits to existing Convex files:

- `convex/publish.ts` (+2 lines): `markPublished` schedules `shopify.onPublished`.
- `convex/schema.ts` (+2 lines): `...shopTables,`.
- `convex/schema/cultremix.ts` (+3 lines): `works.printKey` and `works.printSha256`, both optional.
- `convex/_generated/api.d.ts`: every new module, edited by hand.

### Shared config

- `shared/config/print-products.ts`: the 4 colors and S–2XL sizes, $36 (2XL $39), and `printfulVariantIds`, which are placeholders.
- `shared/config/shopify.ts`: API version `2026-07` and the webhook topics.
- `tsconfig.json` now includes `shared`.

### Site

| File | What it does |
| --- | --- |
| `src/server/storefront.ts` | Storefront API client: private token and buyer IP header |
| `src/server/cart.ts` | Cart logic on the server. The browser names only the work, color, size, and quantity; the variant comes from the work's live offer |
| `src/lib/cart.functions.ts` | TanStack Start server functions |
| `src/lib/money.ts` | Money helpers |
| `src/lib/ref.ts` | First-touch `?ref=` for 30 days |
| `src/components/commerce/BuyBox.tsx`, `CartDrawer.tsx`, `useCart.ts` | Color, size, and quantity, the cart drawer, and checkout |
| `src/routes/cr.$cr.tsx` | Shows the buy box only when an offer exists. Otherwise the page is exactly as before ("Buying opens soon") |
| `src/routes/me.earnings.tsx` | Pending, Available, and Paid totals, plus the member's own activity. Test earnings are labeled Test and left out of the totals |
| `src/routes/admin_.orders.tsx` | Owner only: payment and fulfillment state, lines, refunds, and orders still loading |
| `src/routeTree.gen.ts` | Regenerated |

### Tests

- Convex-local: `tests/convex-local/shopProducts.test.ts`, `shopifyOrders.test.ts`, `fulfillment.test.ts`, and the shared helpers in `shopFixtures.ts`.
- Unit: `tests/unit/cart.test.ts`, `creatorPool.test.ts`, `economics.test.ts`, `printfulClient.test.ts`, `printfulWebhookVerify.test.ts`, `productSync.test.ts`, `shopifyAdminClient.test.ts`, `shopifyOrder.test.ts`, `shopifyWebhookVerify.test.ts`.
- Fixtures: `tests/fixtures/shopifyOrder.ts`, a captured-shape Admin order.

### Docs

- `docs/environment-variables.md`: new matrix rows and a "Shop (Shopify and Printful)" section.

## Mapping to the plan

### U9: products, cart, checkout

- **Product shape:** handle `cr-101-001`, title `CR 101-001 · <title>`, options Color and Size.
- **Variants:** SKU `CR-101-001-<COLOR>-<SIZE>`. The full list of 4 colors × S–2XL is sent on every call, 2XL is $39, inventory is untracked, and the inventory policy is `CONTINUE` (KTD-17).
- **Metafields:** `cultremix.work_id` and `cultremix.cr_number`.
- **Lookup and images:** `workVariants` rows give the reverse lookup. Product images are the work's model photo and art.
- **Token cache:** refreshes early and on a 401. Tested in `shopifyAdminClient.test.ts`; the plan named this `shopifyTokenCache.test.ts`.
- **Cart:**
  - Line attributes `_work_id` and `_cr`, plus a cart attribute `_ref`.
  - Two works can share one cart.
  - A variant the work doesn't offer is refused.
  - The buyer's IP is forwarded from `CF-Connecting-IP`.
  - The cookie is httpOnly, `SameSite=Lax`, and `Secure` on https.
  - The ref is first-touch for 30 days.
  - Tested in `cart.test.ts`; the plan split these across `storefront.test.ts` and `ref.test.ts`.
- **Not yet verified:** "F5 reaches dev checkout" needs a real Shopify development store, so it waits on keys.

### U10: orders, Printful, refunds, earnings

| Requirement | Where | Status |
| --- | --- | --- |
| Bad or missing HMAC → 401, nothing written | both webhook routes | tested |
| Malformed or oversized body → 400 | `/webhooks/shopify` | tested (Printful malformed → 400 also tested) |
| Duplicate webhook does nothing | event-key dedupe | tested, including Printful deliveries that differ only in `retries` |
| Same order via two webhooks → one order and one Printful order | inbox + hydration + fulfillment lease | tested |
| Crash after the Printful create → replay finds the order by external ID | GET `@external_id` before every POST | tested, plus the ambiguous create (504) and a lost create |
| Unmapped variant → needs_attention, no Printful call | `fulfillment.advance` | tested |
| Auto-confirm only in prod (INV-20) | env, flag, and 1-hour hold | tested: staging never confirms, prod confirms at 1 h |
| Bad Printful signature → 401 | `/webhooks/printful` | tested |
| A status that goes backwards is ignored | `isForward` | tested |
| Cancel during the hold deletes the draft; a later cancel → needs_attention | `fulfillment` | tested |
| Refund → proportional negative earnings | `earnings.ts`, `creatorPool.ts` | tested |
| Recipients per the KTD-18 table, including one person in two roles | `economics.ts` + `creatorPool.ts` | tested |
| Quantity, discount, and rounding | `creatorPool.test.ts`, `economics.test.ts` | tested |
| Per-unit maturity 30 days after that unit's shipment | `matureDue` | tested |
| A pending refund holds; a failed refund releases | earnings and fulfillment | tested |
| A shipping-only refund leaves the pool unchanged | `creatorPool` | tested |
| Events in any order (cancel or refund before paid) | hydration reads the whole order | tested |
| A validly signed event from another store is ignored (INV-28) | both routes | tested |
| A production test order is recorded but never printed and earns nothing | `deploymentEnv` | tested; unknown env behaves like prod |
| Staging test orders make simulated earnings and drafts | | tested; earnings labeled Test, drafts never confirmed |
| Other members can't read earnings | `earnings.mine` takes no arguments and reads only the viewer's rows | by construction |
| 15-minute order reconciliation | `orders.reconcile` | tested |
| Printful reconciliation | `fulfillment.reconcile` (30 min) | tested |
| Outgoing file hash equals the onchain content hash (INV-10) | | **not enforced**; see Follow-ups |
| Disputes (`convex/disputes.ts`), `seedEconomics`, `EconomicsPanel`, `/economics/$version` | | **not built**; see Follow-ups |

## Tests and results

Run at this commit:

- `bun run typecheck`: clean.
- `bun run test`: **unit 32 files / 208 tests passed; convex-local 4 files / 54 tests passed.**
  - The shop tests are `shopifyOrders` (20), `fulfillment` (28), `shopProducts` (5), and nine unit files.
- `bun run build`: succeeds, and `routeTree.gen.ts` is committed.
- **No network calls.** Every Shopify and Printful call goes through a replaceable `fetch`, and the convex-local tests route fetch to in-memory fakes.
- **Mutation check:** I removed the "look the order up before any create" guard, and 2 fulfillment tests failed, which shows those tests can catch a regression. The guard was then restored.
- **Timeouts:** the shop convex-local files set `testTimeout: 30_000`. The first `t.fetch` cold-loads every module (about 3 s), which went past the 5 s default when everything ran in parallel. The shared vitest config is untouched.

## Decisions

### One Printful order per Shopify order

- **Identity:** each Printful order is identified by `external_id` = the Shopify numeric order ID.
- **Create:**
  - A lease serializes the work on each order.
  - Each attempt runs GET `/v2/orders/@<id>` before POST.
  - If the create is ambiguous (network error, 5xx, 409, 429, or an empty 200), the order is only looked up, once a minute, for 15 minutes. If it is still missing after that, it moves to `needs_attention`, and no second create ever happens.
  - A refused create (4xx) goes to `needs_attention` and isn't retried.
- **Retries:** transient and unconfigured failures don't reschedule themselves. The 30-minute sweep retries them, and the lease stops anything earlier. This avoids tight loops while Printful keys are missing.

### Hold then confirm

- **Confirmation conditions:** a draft is confirmed only when all of these hold:
  - `DEPLOYMENT_ENV=prod`
  - `PRINTFUL_AUTO_CONFIRM=true`
  - the `fulfillment.autoConfirm` flag isn't set to false
  - one hour has passed since payment
  - there are no pending or unapplied refunds
- **Changes during the hold:**
  - A cancel or a full refund deletes the draft.
  - A partial refund PATCHes the item to its new absolute quantity, so repeating it is harmless.
- **After confirmation:** a cancel or refund moves the order to `needs_attention` for the owner, per KTD-17 and INV-23.

### Status and shipments

- **Status:** Printful statuses only move forward, except into `needs_attention`.
- **Shipments:**
  - Each shipment is recorded once.
  - Only shipped units start the 30-day maturity clock.
  - An order that is gone from Printful is flagged.

### Orders that can't go automatically

| Case | Result |
| --- | --- |
| No print file | `needs_attention` with "CR 101-002 has no print file." |
| No variant ID | `needs_attention` |
| No shipping address (protected customer data) | `manual_required`. A Printful webhook for an order made by hand links it |

### Shopify events

- Every topic triggers a fresh read of the whole order from the Admin API, so the order the events arrive in doesn't matter.
- An older snapshot never overwrites a newer one.
- Payloads are purged after 30 days.

### Earnings

- Lineage and the config version are frozen when the order is hydrated, and the config is always `v1` for now.
- Shares owed to members without creator access are held with reason `not_creator` until `releaseCreatorHolds` runs. This follows A1's proposed default.
- Balance totals scan at most 2000 rows per member.

### Plan deviations

- The ledger lives in `convex/earnings.ts`; the plan named it `convex/economics.ts`.
- The admin page is `src/routes/admin_.orders.tsx`, so it doesn't nest under an `admin` layout.
- Test files are named by area rather than exactly as the plan listed them.

### `convex/lib/economics.ts`

Its behavior is unchanged, and I found nothing wrong with it.

## Stubbed or waiting on keys

- **Printful catalog IDs:** `printfulVariantIds` in `shared/config/print-products.ts` are all `null` until U0(d) confirms them. Until then every paid order lands in `needs_attention` with a clear reason. Variants already synced with an ID are used first, and the config is the fallback.
- **Print files:** `works.printKey` and `works.printSha256` are set by Print Studio, which isn't built in this branch. Without them, orders go to `needs_attention` with "has no print file."
- **Assumptions U0 must check against the live APIs, then recapture the fixtures:**
  - Printful's order-item PATCH and DELETE endpoints.
  - Printful's webhook signature encoding (hex, with the secret hex-decoded when it is hex).
  - The v2 status list.
  - Shopify's 2026-07 order and refund shapes.
- **Real checkout:** an end-to-end checkout on a development store is unverified until keys arrive.

## Merge instructions

### Schema

- **New file:** `convex/schema/shop.ts`, plus one line `...shopTables,` after `...cultremixTables,` in `convex/schema.ts`.
- **New fields on an existing table:** `works.printKey` and `works.printSha256`, both `v.optional`. Print Studio should write these. The print file's key must stay `works/<family>/<expression>/print-<code>/print.png`; the shop only reads `printKey` and builds the public URL from `R2_PUBLIC_URL`.
- **Protected files:** none of `convex/lib/sizes.ts`, `convex/lib/storage.ts`, `convex/sizing.ts`, or `convex/storageMoves.ts` were touched.
- **Likely conflicts:**
  - `convex/crons.ts` is new. If another branch also creates it, keep both sets of entries; the shop's sit between the `Shop` markers.
  - `convex/http.ts` gains two routes.
  - `convex/_generated/api.d.ts` gains new module entries; merge them by hand.
  - `src/routeTree.gen.ts`: rerun `bun run build` after merging and commit the result.

### Env vars

All are listed in `docs/environment-variables.md`. The Builder sets them per environment. Each environment gets its own Shopify store and Printful store, with the same names and different values.

**Convex env (dev, staging, prod):**

| Variable | Notes |
| --- | --- |
| `DEPLOYMENT_ENV` | `dev`, `staging`, or `prod` |
| `SHOPIFY_SHOP_DOMAIN` | `*.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | |
| `SHOPIFY_CLIENT_SECRET` | also the key that signs Shopify webhooks |
| `PRINTFUL_API_TOKEN` | |
| `PRINTFUL_STORE_ID` | |
| `PRINTFUL_WEBHOOK_SECRET` | |
| `R2_PUBLIC_URL` | Printful fetches print files from it |
| `PRINTFUL_AUTO_CONFIRM=true` | **prod only**, and only once Jon wants real orders printed |
| `SHOPIFY_API_VERSION` | optional; leave unset (pinned to `2026-07`) |

**Cloudflare Worker (each environment):**

| Variable | Type |
| --- | --- |
| `SHOPIFY_SHOP_DOMAIN` | var |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | secret |

Ops owns `wrangler.jsonc` `env.production`; I didn't touch it.

### Webhooks the Builder registers

| Service | Target | Signed with | Topics or events |
| --- | --- | --- | --- |
| Shopify (each store) | `https://<convex-site-url>/webhooks/shopify` | `SHOPIFY_CLIENT_SECRET` | `orders/paid`, `orders/cancelled`, `refunds/create`; JSON format, API version `2026-07` |
| Printful (each store) | `https://<convex-site-url>/webhooks/printful` | `PRINTFUL_WEBHOOK_SECRET` | `order_created`, `order_updated`, `order_failed`, `order_canceled`, `order_put_hold`, `order_remove_hold`, `shipment_sent` |

### What Jon creates

**In Shopify** (one store per environment: a development store for dev and staging, and the production store):

1. **A Headless sales channel.** Product sync publishes to the publication whose name contains "Headless", and fails clearly if there isn't one.
2. **A Storefront private access token** from that Headless channel, with permission to read product listings and to write carts and checkouts. This becomes `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`.
3. **A custom app with client-credentials access** (client ID and secret).
   - Admin scopes: `write_products`, `read_products`, `write_publications`, `read_publications`, `read_orders`.
   - Protected customer data access for shipping name and address. Without it, orders arrive `manual_required`.
4. **Commerce settings:**
   - One flat US shipping rate (KTD-17 proposes $5.95).
   - US only.
   - The test payment gateway on the development store.
5. **The storefront password:** if one is on, judges need it in their access instructions.

**In Printful** (one store per environment):

1. An API store with a **private token** (`PRINTFUL_API_TOKEN`) and its **store ID** (`PRINTFUL_STORE_ID`).
2. A **webhook** pointed at the URL above, with its **secret** (`PRINTFUL_WEBHOOK_SECRET`).
3. The **catalog variant IDs** for the garment in White, Ivory, Pepper, and Black, sizes S–2XL. Fill these into `printfulVariantIds` in `shared/config/print-products.ts` (U0(d)).

### Turning it on

1. Set `featureFlags` `commerce.checkout` to enabled. Until then the work page is unchanged and nothing syncs.
2. Run `shopify.syncAllPublished` once, so works published before the flag go on sale.
3. Leave `fulfillment.autoConfirm` unset; setting it to `false` pauses confirmation.

### Glue to other areas

- **Creator access:** whatever grants it should call `internal.earnings.releaseCreatorHolds({ userId })`, so held shares become Available.
- **Site header:** a link to `/me/earnings` for creators, and to `/admin/orders` for the owner. I didn't add these.
- **Refs:** `useCaptureRef()` is currently called only by the BuyBox. Moving it to `src/routes/__root.tsx` would capture `?ref=` on every page.
- **Print Studio:** sets `works.printKey` (the path above) and `works.printSha256` on publish.
- **Product images:** product sync sends the work's model photo and art. Real Printful mockups can replace them later.

### Follow-ups

1. **INV-10:** check that the bytes at `printKey` hash to `printSha256` and to the onchain content hash before sending the file to Printful.
2. **Disputes:** record a dispute (`convex/disputes.ts`), hold maturity while it's open, and reverse earnings if it's lost.
3. **Economics:** `seedEconomics`, the public `EconomicsPanel`, and the `/economics/$version` JSON route. The config version is fixed at `v1` until then.
4. **Payouts:** nothing moves earnings to Paid yet.
5. **Live checks:** once keys land, recapture the Shopify and Printful fixtures from real responses, then run one development-store test checkout through to a Printful draft.
6. **Balances:** replace the 2000-row balance scan with stored per-member totals once volume calls for it.
