# What's left for the hackathon

As of October 6, 2026, 7:30 p.m. Pacific. The Monad submission (Social, Attention & Culture track) is due **Tuesday, October 13, 20:59 PDT**. This list compares the V1 plan ([2026-09-27-feat-cultremix-v1-core-loop.md](../plans/2026-09-27-feat-cultremix-v1-core-loop.md)) with what's on `dev` today. Production still runs the September 30 build (`8bc367d`) until Jon says go.

## Where V1 stands

| Unit | Status |
|---|---|
| U0 account checks | Done: the gateway, Topaz upscaling, print sizes, and Resend email on production. Waiting: Circle, Printful, Shopify, testnet MON, and a physical print sample |
| U1 scaffold | Done; the staging settings are in place, waiting for a staging Convex project |
| U2 identity and judges | Done |
| U3 image providers, credits, budget | Done for the CultRemix Gateway, plus Nano Banana 2.1 and Recraft V4.1 for admins. Per-creator "Sign in with ChatGPT" (R30–R32) isn't built; everyone uses the gateway |
| U4 studio | Done: grid batches, numbered images, the style mixer, sessions |
| U5 favorites and viewer | Done, with Compare (stretch S4) |
| U6 Print Studio | Done. Upscaling needs `FAL_KEY` in each environment. No physical sample ordered |
| U7 wallets and Monad registry | Built and tested against a local Monad node. Not deployed: the relayer `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921` still had 0 testnet MON when checked tonight, and Circle has never been called live |
| U8 publish and work pages | Done; the Shopify step waits for U9 |
| U9 Shopify | Built against stand-ins; there's no store yet |
| U10 orders, Printful, earnings | Built against stand-ins. Checkout still sells the fixed launch colors, not the Printful product chosen in `/admin/products` |
| U11 remix, lineage, corrections | Done, plus remixable parts (Santa and the elves), variation-or-fork checks, and private keeps |
| U12 social | Done. Backs stay hidden until the registry is live |
| U13 staging launch | Not started: no staging Convex project, bucket, keys, or Worker |
| U14 cohort and evidence | `/admin/metrics` and the templates in `docs/launch/` exist; nobody has been invited yet |
| U15 production on mainnet | After the hackathon, target October 20 |
| Stretch | S4 Compare is done. S2 (USDC settlement demo), S1 (creator subscription), and S3 (shipping updates to Shopify) haven't started |

## Jon's part (these unblock the rest)

1. **Testnet MON for the relayer** `0x7D39bCfd08b206fEaacb4F1E2817aDB22e06f921`, from the Monad faucet. With it, the registry deploys (`bun run chain:deploy:testnet`), and the Monad records and Backs switches can go on. This is what the track's "does it run onchain" criterion looks at.
2. **A Circle developer account**: a test API key and entity secret. Staging and production refuse chain writes without real Circle wallets; only dev has a local signer.
3. **A staging Convex project** named `cultremix-staging` with a deploy key (step 1 of [the launch checklist](../launch-checklist.md)). Ops does the rest of that checklist. The alternative is submitting on production, but production writes to Monad mainnet by design.
4. **Production go** for the current `dev`. The Ops message is ready.
5. **Repo access.** The GitHub repo is private right now. The event asks for a public repo shared with `metropolis@hackathon.monad.xyz`.
6. **Shopify and Printful**, if the demo should show a real test checkout (the plan's F5: a judge pays with a test card, a Printful draft order appears, and test earnings show as pending). That needs:
   - a Shopify development store with a Dev Dashboard app;
   - a Printful account with an API token.

   Order a Printful sample by October 8 for any chance of having the shirt by the 13th.
7. **The event's submission fields** pasted into [submission.md](submission.md), the judges' emails, and invitations to the first 15–25 creators (U14). Their numbers and quotes are the evidence for the founder/market (25%) and traction (20%) criteria.
8. **The two videos**: a demo of 3 minutes or less and a pitch of 2 minutes or less, planned for October 11–12.
9. **Small calls:**
   - whether "AI" goes back into the page descriptions;
   - rotating the Resend key that was pasted in chat on September 29;
   - keeping high quality at 2 credits a batch as the default.

## Builder work that needs no accounts

1. **The submission package.**
   - A logo file (PNG, from the CR mark).
   - README, [submission.md](submission.md), and [judges.md](../judges.md) brought up to date with remixable parts, private keeps, Start from this, and shirt colors.
   - A demo script of 3 minutes or less and a pitch script of 2 minutes or less. Today's script runs 90 seconds.
2. **Checkout from the chosen shirt.** Sell the active Printful product's colors and variant IDs. Upscale right after payment, with the automatic check.
3. **A list of kept designs** for their creator. Today only each design's own `/keep/<id>` page exists.
4. **Signed-in end-to-end tests** for the studio, publishing, remixing, and social flows. Only the read-only smoke test exists.
5. **QA leftovers.**
   - Bigger tap targets on the studio's image chips.
   - Focus return in the style mixer.
   - The admin pages' header against the site header.
   - The sign-in button label flickering.
6. **Studio follow-ups.**
   - Role words on mixer rows ("Leads," "Colors the subject," "Around it").
   - A "Show me the range" choice.
   - A spelling check after each batch.
   - The next quiet-lead experiment ([Styles and mixing](../image-generation/style-mixing.md#open-problems-and-what-to-try-next)).
   - A full image-suite run for a fresh baseline (about $3).
7. **Once MON arrives**: deploy the testnet registry, record its address, register the economics config, and check that each published work's registration reaches the explorer.

## Ops

Ops sets up staging from [the launch checklist](../launch-checklist.md) once the Convex project exists, deploys production on Jon's go, and sets `FAL_KEY` on production. A custom domain for the image bucket can come before the production launch.

## A possible week

| Day | Jon | Builder and Ops |
|---|---|---|
| Wed Oct 7 | MON, Circle, the staging project, production go | Submission package, checkout colors, the kept list; production deploy |
| Thu Oct 8 | Shopify and Printful if wanted; order the sample; invite creators | Registry on testnet; staging seeded; judge accounts |
| Fri–Sat Oct 9–10 | Try staging as a judge | S2 settlement demo if Circle works; end-to-end tests; QA; full suite run |
| Sun–Mon Oct 11–12 | Record the videos | Final README and submission text; staging smoke test |
| Tue Oct 13 | Submit by 20:59 PDT | Buffer |

## After the hackathon

- U15, production on mainnet (target October 20).
- Make the repo private again, and turn off judge access.
- Printify, the Style Of library, and creator subscriptions.
- Per-creator ChatGPT sign-in, if still wanted.
