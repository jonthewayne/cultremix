# Roadmap after the hackathon

Updated November 11, 2026. Jon lifted the judging freeze today. CultRemix works end to end: the studio, publishing with CR numbers, lineage and remixing, Shopify checkout and Printful printing, the Monad registry, and the earnings ledger. What it lacks is proof that people buy, remix, and come back. The order below favors whatever produces that proof soonest. Product and economics decisions live in [decisions.md](decisions.md); this file is about order.

## Now

1. **Reopen production for real orders.** Implement the October 15 economics decisions (costs first, then shares; private brand deals; the five-point creator minimum from the brand's allocation) as one new rules version, together with the waiting dev work (brand deals, changing a design's colors). Finalize the Terms, turn off judges' creator access, deploy, register the new rules on Monad, and turn checkout on. See [after-judging](plans/2026-10-14-after-judging.md).
2. **Hoodies, and pictures that match the product.** A friend asked for a design on a hoodie and would have bought it. Add one premium hoodie, put it on the designs already for sale, map colors across products, and show Printful's real product mockups. See [the products plan](plans/2026-11-11-products-hoodies.md).
3. **First real sales.** Order samples and a few shirts ourselves to check print quality, shipping, packing slips, and earnings end to end, then sell to friends and community.
4. **Review every screen.** \`bun run screens\` captures the whole site at desktop and phone widths into a viewer at \`.tmp/screens/index.html\`; use it before each release.

## Next

5. **Weekly remix drop.** Feature one design each week and invite remixes; highlight the best ones and credit their makers. Uses features that already exist (Featured, Latest, remixing, notifications) and turns remixing into a habit.
6. **Creator payouts.** Creators enter a wallet address (USDC on Monad) and press Withdraw; Jon approves and sends. The ledger, holds, and minimum are built. See [creator payouts](plans/2026-10-13-feat-creator-payouts.md). Needed once remixes start selling.
7. **Live remix sessions.** A live page where viewers watch the studio, chat, suggest phrases, and vote, with "Words by @viewer" on published shirts. See [live sessions](plans/2026-10-13-feat-live-sessions.md). Build it once the weekly drop shows what people enjoy.
8. **One brand pilot.** One artist, band, or small brand on a deal set in Admin, Brands, promoting their family of designs.

## Later

- **Style library** from Style Of (Jon's other company, in progress). Pull its styles into the studio; bring back the style mixer then.
- **Phrase credits that pay**, phrases as tracked content, and creator codes (in the live sessions plan).
- A **heavyweight tee** (Comfort Colors 1717) and other products once the hoodie sells.
- **Family remix templates** (Santa, Mrs. Claus, and any number of elves) polished as a seasonal feature.
- **More image models** for the owner to compare (the studio's admin model picker), and per-member ChatGPT connections (V1 R30–R32).
- **Printify comparison** with real order costs; Printful stays the printer until then.
- **A registry admin key** separate from the relayer's; Circle wallets only if members ever hold money in CultRemix.

