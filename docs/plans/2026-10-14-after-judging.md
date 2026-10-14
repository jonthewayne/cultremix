# After judging: what's waiting on dev

Production is frozen while the Monad hackathon is judged, October 14 to 27, 2026 (AGENTS.md). Everything below is built and tested on the dev branch and the dev deployment (`vibrant-rook-798`, viewed at https://mighteous.tailb6e2ea.ts.net:3000 over the tailnet). None of it is on cultremix.com, and the public repo's `main` branch stays at the submitted commit (`4e90c3b`, tag `hackathon-submission`).

## Brand deals (economics v4)

A brand deal is one number CultRemix sets: the families' share of each sale, the brand and the families' creators together. It comes out of CultRemix's share, so it's the only number that changes what we keep. The brand splits it with the creators on its own page.

| | Published in v4 |
| --- | --- |
| A new deal | 25%: 15% to the brand, 10% to creators |
| The most a deal can be | 30% of the price |
| The least creators get in a brand's families | 5% |
| Everywhere else | creators 15%, a share link 5% (unchanged) |

- **Admin, Brands** sets the families' share and the creators' starting part, and keeps a private note of what was agreed. A table shows what one shirt pays everyone under the deal, beside the standard split, with Printful's catalog prices for each product on offer, the card fee, and shipping (`shared/config/shopCosts.ts`). Red marks a shirt where CultRemix would keep under $2.
- **The brand's page** (`/brand`, linked from the menu of a brand's account) shows its families and a slider for the creators' share, from 5% to the families' whole share, with our suggested 10% and an example sale. A change applies to new sales, and the owner and ops get a bell notification.
- On a $24 tee with a share link, CultRemix keeps $6.71 without a brand, $4.31 on a 25% deal, and $3.11 at the 30% cap; a $26 2XL keeps $2.35 at the cap. The 50% cap in v3 would have lost $1.69 a shirt.
- The sale math is v3's. v4 adds `brandFamilyMaxBps` and `brandCreatorDefaultBps` and moves `brandDefaultBps` to 15% (`/economics/v4.json`).

## A design's colors after publishing

On a design's page, its creator and the owner have **Change its shirt colors**: the colors on offer, up to 20, with the same contrast warnings as publishing, and which one leads. Saving updates the design's colors and background (the lead), and its shop products switch to the new colors at once with the same print file (`sales.relistColors`); a paused product keeps the colors for when it's back on sale. When the lead changes, a new model photo can be shot on it (the owner's are free of the day's photo shoots; a creator's count against theirs).

## When the freeze lifts

1. Deploy from this folder in the usual order (`docs/deployment-cloudflare.md`; `.tmp/deploy-prod.sh` backs up production first).
2. Register the new rules on Monad: `bunx convex run --prod --identity <owner> chainAdmin:registerEconomicConfig`, then check /admin/chain shows v4 confirmed.
3. Paste the updated Terms (cultremix.com/policies/terms, "Earnings") into Shopify, Settings, Policies, Terms of service.
4. Look over Admin, Brands and one design's **Change its shirt colors** on production.
