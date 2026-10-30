# Product and architecture decisions

This is the durable record of agreed product behavior and the architectural constraints it creates. Read it before changing economics, brand agreements, remixing, or lineage. Implementation plans belong in `docs/plans/`; this file records what they must deliver and why. Add dated decisions here, and explicitly supersede an entry when the direction changes.

## 2026-10-29: Official description of CultRemix

**Status: agreed.** Jon set the official wording for what CultRemix is and why it exists. It lives in [positioning.md](positioning.md). Use it for the site, pitches, applications, and bios, and cut shorter versions from it rather than writing new ones.

## 2026-10-15: Recover protected costs before sharing earnings

**Status: agreed; implementation pending.** The current dev economics v4 still calculates shares from the discounted item price before costs. Its admin margin table can show a loss on expensive products. That is evidence of an unsafe deal or price, rather than permission to sell at a loss. This decision supersedes the price-based sharing assumptions in the October 14 after-judging plan.

For new sales under the future rules:

1. Start with the item price after discounts, excluding tax and shipping collected.
2. Recover protected costs: production and printing, allocated payment processing fees, any shipping shortfall, and a small operating allowance.
3. Apply creator, brand, and affiliate percentages to the amount remaining after those costs.
4. CultRemix retains the balance, in addition to the operating allowance already reserved.

Protected costs are non-negotiable. A brand cannot reduce them by adjusting its deal. If a price or discount cannot cover them, require a higher price or prevent the sale; merely clamping the distributable amount to zero would still allow CultRemix to lose money. Shipping collected is not a royalty base, and covered shipping must not be deducted twice. Tax collected is not distributable income.

The exact operating allowance, fee allocation across multi-item orders, and treatment of production-cost changes still need implementation choices. Do not treat the illustrative $14 below as a real catalog cost. Distinguish estimated costs shown before checkout from the cost basis saved for a sale. The admin display and backend earnings calculation must use the same rules, with costs and rounding auditable on the saved order. Preserve the terms and version of orders already sold; this decision does not retroactively recalculate their earnings.

Percentages of the remainder pay different dollar amounts than the same percentages of retail price. Update the admin, brand and creator explanations, policies, versioned rules, and earnings calculation together. Recording v4 on Monad alone does not implement this decision. Choose and register the appropriate new rules version only after implementation and verification, and only after Jon lifts the production freeze.

## 2026-10-15: A brand controls the creator portion of its allocation

**Status: agreed.** Dev v4 already has a combined brand-and-creator allocation and a brand-controlled creator share. Applying them after protected costs is pending the decision above.

- CultRemix negotiates and sets the brand's total allocation. Brand status is granted by admins; it is not an automatic member entitlement. A brand cannot increase its own allocation.
- The brand chooses how much of that allocation goes to the creator pool, up to the total allocation.
- **The creator minimum is five percentage points of the amount remaining after protected costs. It comes out of the brand's allocation. It is not 5% of that allocation.**
- Every increase in the creator pool reduces the brand's portion by the same number of percentage points. It does not reduce CultRemix's portion.
- CultRemix controls the platform affiliate rate. Affiliate rewards come from CultRemix's portion, leaving the brand's total allocation and the creator pool intact. If no eligible affiliate applies, CultRemix retains that portion.
- The existing lineage splits divide the creator pool between the people behind a design; the brand's setting determines the size of that pool.

Example only: a $24 item has $14 in protected costs, leaving $10 to share. A negotiated 25% brand-and-creator allocation pays $2.50 in total. With creators set to 10%, creators receive $1 and the brand receives $1.50. An eligible affiliate at 5% receives $0.50 from CultRemix's portion, leaving CultRemix $7 of the remainder. If the brand lowers creators to the 5% minimum, creators receive $0.50 and the brand $2; CultRemix's and the affiliate's amounts stay the same.

Suggested brand-page wording: “Your allocation: 25% of the amount remaining after costs. Give creators 10%. You keep 15%. CultRemix funds referral rewards separately.” Label every percentage with its basis so it cannot be mistaken for a percentage of retail price or of the brand allocation.

## 2026-10-15: Keep individual brand agreements confidential

**Status: agreed direction; public-response and UI changes pending.** General economics rules and individual negotiated deals are different data. The versioned rules JSON describes general defaults, limits, and lineage splits; its hash is recorded on Monad. It does not contain a named brand's individual agreement. The current public `convex/workEconomics.ts` query and `EconomicsPanel` nevertheless expose exact per-brand percentages, so the current application does not meet the desired confidentiality.

- Keep negotiated brand rates, total allocations, and agreement notes in the backend. Super admins can see agreements; each brand can see its own rates and allocation. Internal agreement notes remain admin-only.
- Public pages may show the brand's identity and attribution without returning its negotiated rate or total allocation. Remove confidential fields from public API responses, not just rendered text. Retain this boundary for private-design responses too.
- Creators must be able to understand their own earning terms. Disclosing the creator pool does not require disclosing the brand's allocation or retained share.
- Do not publish individual deals in public rules files or send their terms to the registry. Describe Monad's actual provenance and general-rule records accurately; the current claim that all displayed shares are recorded there needs correction.
- Future blockchain payout design must account for observable transfers and possible inference of amounts. Keeping agreements in the backend does not make public transfers confidential.

## 2026-10-15: A remixable phrase does not confer ownership of matching words

**Status: agreed product policy; implementation audit pending.** A phrase can be a prominent, top-level remixable element. It can offer “Keep this phrase, reimagine the design” without giving its first uploader control over everyone else's use of those words.

- Attribution and earnings follow the work someone builds from. A remix created from an existing work keeps that relationship, even if its appearance changes substantially.
- Matching a phrase alone must never automatically create ancestry, attach royalties, grant exclusivity, or give an earlier uploader control over an independently created design. Being first to upload is not a rights-verification mechanism.
- A deliberate remix that keeps the phrase and fully restyles the design can be a fork. Keeping a phrase does not, on its own, determine the classification.
- Word changes or character swaps that preserve the overall visual approach can remain variations. A variable number of characters, such as elves in a family design, is not by itself a reason for a fork. A full restyle can be a fork even with the same layout.
- Editable phrase and character controls are creative shortcuts, not a straitjacket. Keep a freeform request path for broader changes, while preserving attribution to the source work.
- Claimed brand or trademark restrictions need a separate, reviewed rights agreement. Do not automatically grant those privileges because someone uploads a phrase or is marked as a brand. This is a product decision, not a legal determination about any particular phrase.

Example: an independently created “Grow Slow” design does not owe the first CultRemix member to use those words. Opening that member's design and asking to keep the words while completely reimagining the artwork deliberately builds from that work and can publish as a fork.

## Builder handoff

The entries above record decisions, not proof that the features are implemented. Before calling them complete, verify backend earnings and admin examples agree; brand creator-share changes respect the five-point floor and fixed allocation; affiliate rewards leave that allocation intact; public responses cannot reveal individual deals; and phrase matches alone cannot create ancestry. Exercise the unchanged-style character swap and full-restyle cases when checking variation/fork classification.

Implementation context: [after-judging dev work](plans/2026-10-14-after-judging.md), [architecture](architecture.md), [onchain provenance ADR](adr/0001-onchain-provenance.md), and [testing](testing.md). **Production remains frozen until Jon explicitly lifts the freeze.**
