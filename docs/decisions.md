# Product and architecture decisions

This is the durable record of agreed product behavior and the architectural constraints it creates. Read it before changing economics, brand agreements, remixing, or lineage. Implementation plans belong in `docs/plans/`; this file records what they must deliver and why. Add dated decisions here, and explicitly supersede an entry when the direction changes.

## 2026-10-29: Official description of CultRemix

**Status: agreed.** Jon set the official wording for what CultRemix is and why it exists. It lives in [positioning.md](positioning.md). Use it for the site, pitches, applications, and bios, and cut shorter versions from it rather than writing new ones.

## 2026-10-15: Recover protected costs before sharing earnings

**Status: agreed and built (November 16, 2026) as economics v6; see "As built" below.** Economics v4 calculates shares from the discounted item price before costs. Its admin margin table can show a loss on expensive products. That is evidence of an unsafe deal or price, rather than permission to sell at a loss. This decision supersedes the price-based sharing assumptions in the October 14 after-judging plan.

For new sales under the future rules:

1. Start with the item price after discounts, excluding tax and shipping collected.
2. Recover protected costs: production and printing, allocated payment processing fees, any shipping shortfall, and a small operating allowance.
3. Apply creator, brand, and affiliate percentages to the amount remaining after those costs.
4. CultRemix retains the balance, in addition to the operating allowance already reserved.

Protected costs are non-negotiable. A brand cannot reduce them by adjusting its deal. If a price or discount cannot cover them, require a higher price or prevent the sale; merely clamping the distributable amount to zero would still allow CultRemix to lose money. Shipping collected is not a royalty base, and covered shipping must not be deducted twice. Tax collected is not distributable income.

The exact operating allowance, fee allocation across multi-item orders, and treatment of production-cost changes still need implementation choices. Do not treat the illustrative $14 below as a real catalog cost. Distinguish estimated costs shown before checkout from the cost basis saved for a sale. The admin display and backend earnings calculation must use the same rules, with costs and rounding auditable on the saved order. Preserve the terms and version of orders already sold; this decision does not retroactively recalculate their earnings.

Percentages of the remainder pay different dollar amounts than the same percentages of retail price. Update the admin, brand and creator explanations, policies, versioned rules, and earnings calculation together. Recording v4 on Monad alone does not implement this decision. Choose and register the appropriate new rules version only after implementation and verification.

**As built (November 16, 2026, economics v6).** v6 is v5's artist credits plus costs first; v5 never reached production, so production goes from v4 to v6. v6 is the current rules on every deployment; `ECONOMICS_VERSION` can pin a deployment to another published version. The implementation choices the decision left open:

- **Production cost** is Printful's catalog price for the sold variant, plus each placement beyond the first (a back print, a chest mark with it). Every product's prices are saved (`merchProducts` variants' `costCents`) and refreshed daily, at each deploy (`deploy:migrate`'s costs step), and when an admin adds a product. When the exact variant has no saved price, the product's highest stands in, so the estimate errs high.
- **Card fee:** 2.9% + 30¢ of everything the buyer paid, spread over the order's lines by their price.
- **Shipping shortfall:** Printful's shipping ($5.35 for the first item, $2.60 for each more) beyond what the buyer paid for shipping, spread over lines by units. With today's flat $5.95, a one-item order has none.
- **Operating allowance:** $1 per unit, in the published rules (`operatingAllowanceCents`).
- **Below cost:** a line whose price after discounts doesn't cover its costs shares nothing and isn't sent to print on its own: the order waits in Admin, Orders for the owner to refund it or make it by hand. A line whose cost isn't saved shares nothing, and the owner and ops get an order notification. Prices can't be set below cost (front, back, back with a chest mark, each size group) or before Printful's prices are saved: Admin, Products refuses one and names the least that works, and flags any product a later Printful price change pushed under.
- **Refunds:** a refund comes out of what was left after costs first, since the costs were spent either way; refunding $15 of a line that left $14 to share takes back its whole pool.
- **Multi-line orders:** the card fee and shipping shortfall are worked out across every line of the order, including lines Shopify adds later.
- **Auditable:** each order line saves its production, fee, shipping, and allowance cents and what was left to share (`orderItems.costs`). Admin, Brands' money table uses the same math (`convex/lib/saleCosts.ts`).
- Shares, the brand allocation, the five-point creator minimum, the affiliate's 5%, and artist credits are all percentages of what's left. Earlier lines keep their version.

## 2026-10-15: A brand controls the creator portion of its allocation

**Status: agreed and built.** v4 has the combined brand-and-creator allocation and the brand-controlled creator share; v6 applies them to the amount after protected costs, and the brand page states each percentage's basis.

- CultRemix negotiates and sets the brand's total allocation. Brand status is granted by admins; it is not an automatic member entitlement. A brand cannot increase its own allocation.
- The brand chooses how much of that allocation goes to the creator pool, up to the total allocation.
- **The creator minimum is five percentage points of the amount remaining after protected costs. It comes out of the brand's allocation. It is not 5% of that allocation.**
- Every increase in the creator pool reduces the brand's portion by the same number of percentage points. It does not reduce CultRemix's portion.
- CultRemix controls the platform affiliate rate. Affiliate rewards come from CultRemix's portion, leaving the brand's total allocation and the creator pool intact. If no eligible affiliate applies, CultRemix retains that portion.
- The existing lineage splits divide the creator pool between the people behind a design; the brand's setting determines the size of that pool.

Example only: a $24 item has $14 in protected costs, leaving $10 to share. A negotiated 25% brand-and-creator allocation pays $2.50 in total. With creators set to 10%, creators receive $1 and the brand receives $1.50. An eligible affiliate at 5% receives $0.50 from CultRemix's portion, leaving CultRemix $7 of the remainder. If the brand lowers creators to the 5% minimum, creators receive $0.50 and the brand $2; CultRemix's and the affiliate's amounts stay the same.

Suggested brand-page wording: “Your allocation: 25% of the amount remaining after costs. Give creators 10%. You keep 15%. CultRemix funds referral rewards separately.” Label every percentage with its basis so it cannot be mistaken for a percentage of retail price or of the brand allocation.

## 2026-10-15: Keep individual brand agreements confidential

**Status: agreed and built (November 16, 2026): public responses carry no brand rate or allocation, and Monad's wording says what it records.** General economics rules and individual negotiated deals are different data. The versioned rules JSON describes general defaults, limits, and lineage splits; its hash is recorded on Monad. It does not contain a named brand's individual agreement. The current public `convex/workEconomics.ts` query and `EconomicsPanel` nevertheless expose exact per-brand percentages, so the current application does not meet the desired confidentiality.

- Keep negotiated brand rates, total allocations, and agreement notes in the backend. Super admins can see agreements; each brand can see its own rates and allocation. Internal agreement notes remain admin-only.
- Public pages may show the brand's identity and attribution without returning its negotiated rate or total allocation. Remove confidential fields from public API responses, not just rendered text. Retain this boundary for private-design responses too.
- Creators must be able to understand their own earning terms. Disclosing the creator pool does not require disclosing the brand's allocation or retained share.
- Do not publish individual deals in public rules files or send their terms to the registry. Describe Monad's actual provenance and general-rule records accurately; the current claim that all displayed shares are recorded there needs correction.
- Future blockchain payout design must account for observable transfers and possible inference of amounts. Keeping agreements in the backend does not make public transfers confidential.

## 2026-10-15: A remixable phrase does not confer ownership of matching words

**Status: agreed product policy; audited November 16, 2026: a design's parent is set only by an explicit remix (the studio session's remixOfWorkId) or a staff lineage correction, never by matching words.** A phrase can be a prominent, top-level remixable element. It can offer “Keep this phrase, reimagine the design” without giving its first uploader control over everyone else's use of those words.

- Attribution and earnings follow the work someone builds from. A remix created from an existing work keeps that relationship, even if its appearance changes substantially.
- Matching a phrase alone must never automatically create ancestry, attach royalties, grant exclusivity, or give an earlier uploader control over an independently created design. Being first to upload is not a rights-verification mechanism.
- A deliberate remix that keeps the phrase and fully restyles the design can be a fork. Keeping a phrase does not, on its own, determine the classification.
- Word changes or character swaps that preserve the overall visual approach can remain variations. A variable number of characters, such as elves in a family design, is not by itself a reason for a fork. A full restyle can be a fork even with the same layout.
- Editable phrase and character controls are creative shortcuts, not a straitjacket. Keep a freeform request path for broader changes, while preserving attribution to the source work.
- Claimed brand or trademark restrictions need a separate, reviewed rights agreement. Do not automatically grant those privileges because someone uploads a phrase or is marked as a brand. This is a product decision, not a legal determination about any particular phrase.

Example: an independently created “Grow Slow” design does not owe the first CultRemix member to use those words. Opening that member's design and asking to keep the words while completely reimagining the artwork deliberately builds from that work and can publish as a fork.

## 2026-11-15: A remix that changes kept words becomes a fork

**Status: decided by Jon and built on dev.** The remix boxes only change words the creator made remixable, but the request box can ask for anything, including the creator's kept words. CultRemix doesn't block that. A remix whose lettering no longer shows a kept word publishes only as a fork: a new family that still credits the original, where the remixer may take the design anywhere. Kept words are checked by reading the remix's lettering back beside the remix comparison; misspellings, restyled or rewrapped lettering, and added words still count as kept. A public variation waits for that reading when the original keeps words; a private remix doesn't. Details in [prompt protection](image-generation/prompt-protection.md).

## 2026-11-12: Credit and a reserved share for outside artists (updated 2026-11-16)

**Status: agreed by Jon and built (November 16, 2026). It's part of economics v6, with costs-first sharing, the current rules on every deployment.** A creator sometimes builds a design on an outside artist's work or distinctive style. CultRemix can credit that artist and set part of each sale aside for them before they've heard of CultRemix, held until they claim it. The credit is goodwill. It doesn't mean the artist owns a style, and it doesn't make copying acceptable.

**Who credits an artist.**

- **The creator, while publishing.** An optional question: "Is this inspired by a known artist with a distinctive style you'd like to credit?" They can name up to three artists, each with a name and a link to their work. Skipping it is fine.
- **Staff, afterward.** When a design clearly comes from a particular artist, an admin can add or correct the credit through the lineage-correction path.
- **Never automatically.** Studio image notes may later *suggest* a credit, but a person decides.

The work page shows "Inspired by Jane Doe (unclaimed)." Remixes of that work inherit the credit, because they build from it.

**Where the money comes from.** The credit always comes from the creator's share, whoever adds it. It reduces the part of the creator pool that belongs to the creator of the credited work; the family root's and upstream creators' parts stay whole. CultRemix's share and brand allocations don't change. Proposed size: one fifth of that creator's part, split evenly among up to three credited artists.

Examples on $10 remaining after protected costs, with the standard 15% creator pool ($1.50):

| Work | Without a credit | With one credited artist |
| --- | --- | --- |
| An original that credits an artist | creator $1.50 | creator $1.20, artist $0.30 |
| A variation of that original (inherits the credit) | root $0.75, variation creator $0.75 | root $0.60, artist $0.15, variation creator $0.75 |
| A variation whose own creator adds a credit | root $0.75, variation creator $0.75 | root $0.75, variation creator $0.60, artist $0.15 |

With two or three artists, each artist gets an equal part of the same one fifth. These figures are examples. The final numbers ship in the same rules version as costs-first sharing.

**Holding and claiming.**

- **Holding.** Earnings go into the existing ledger and stay held while the artist is unclaimed.
- **Claiming.** Each credited artist has a claim page showing their credited designs and the amount held. To claim, the artist proves they control the linked account or site, either by posting a code there or emailing from the site's domain. An admin approves the claim. After that, the artist gets an account and is paid through creator payouts. A claimed artist can change how they're named or decline the credit; if they decline, their share goes back to the creator.
- **Unclaimed money.** A lawyer and an accountant need to decide how long unclaimed money is held and where it goes afterward before this launches, because it may count as unclaimed property.

**When an artist objects.** A style can't be owned, and CultRemix doesn't take designs down just because an artist dislikes the influence. Staff make a judgment call:

- **Inspired by the style:** the design stays up. The artist can keep the credit, rename it, or decline it.
- **Too close to the artist's style or work:** staff suspend the design and ask its creator to remix it further until it's distinct. The creator's own design keeps its place in its family; the change shows in its history.
- **A copy of a specific artwork, or a trademark:** that's a different question from style. A valid copyright or trademark notice goes through the existing takedown path, and staff follow the law.

**As built (dev, November 16).** The publish sheet asks "Inspired by an artist?" (optional, up to three, a name and a link each). Admin, **Artists** has waiting claims, a design's credits by CR number, and every artist with what's held. Each design page shows "Inspired by Jane Doe (unclaimed)" (with "via CR …" when the credit comes from an earlier design in the lineage), and its economics panel lists the artist's share. /artist/<slug> lists the designs that credit them and what's set aside, and is where they claim it. An unclaimed artist's shares are paid to a hidden payee account and held there; approving a claim gives the claimant creator access, moves everything held to their account, and redirects later syncs of those orders too. Splitting among artists rounds to whole hundredths of the pool, so three artists get 600 basis points each and the creator keeps the 200 left over. Code: `convex/artists.ts`, `convex/lib/artistCredits.ts`, v5 in `convex/lib/economics.ts`; tests in `tests/unit/artistCredits.test.ts` and `tests/convex-local/artists.test.ts`. Since built (November 16): the Monad record of credits, claim notifications, and the Terms' wording (see below).

**Review fixes (November 16, cross-model review with Fable 5.2).**

- **An artist is their link.** The link decides who an artist is, and the name is only how they're shown. "J. Doe" and "Jane Doe" with the same link are one artist, a renamed page keeps its credits, and a declined artist stays declined when credited again. Query parameters that name a page count (two YouTube videos are two artists); tracking parameters don't. A shared site's front page ("instagram.com") is refused as an artist link.
- **Claiming moves money in batches.** Approval schedules `artists.moveHeld`, which moves a few orders at a time and then releases holds page by page, so a popular artist's claim never hits Convex's transaction limits.
- **A claimant already paid on a line.** When the artist is also the design's creator, or one person claims two artist pages credited on the same line, their shares fold into one: the line's recipient adds the basis points and roles, and the held sale becomes a "claim" adjustment on the member's own sale, in that sale's state, so nothing already paid is rewritten. Cancellations, disputes, and refunds reverse the folded total.
- **Pages appear when they should.** An unclaimed artist page shows once a published design credits it. A member can have five claims open; a claim started and not sent for a week stops counting.
- **Brand rates stay private.** The public economics panel names a family's brand and the creators' share its agreement sets, but its response no longer carries the brand's rate.
- **Which rules are live.** Until costs-first sharing was built, production stayed on v4 so artist credits couldn't reach it alone. Since November 16, v6 (costs first, with artist credits) is the current rules everywhere; `ECONOMICS_VERSION` can pin a deployment to another published version, and a deployment pinned to one without artist shares hides the credit question, credits, and artist pages.
- **Claims get a closer look.** The admin claim row warns when the proof link is on another site, or on the same site but not the artist's credited page (a comment or a lookalike account), and when the claimant credited the artist themselves. Staff can rename or hide an artist; a hidden artist has no page and no share, and only staff change it, apart from an artist's own decline. A member can name ten new artists a day.
- **Built after the review (November 16):**
  - **A review window instead of moving money back.** Approving a claim gives the member the page, and for 14 days nothing moves and the page can't be renamed or declined: sales keep holding the artist's share, and an admin can undo the claim (Admin, Artists, **Undo the claim**) with nothing to reverse. When the window ends, the member gets creator access and everything held moves to them. After that, a wrong claim is corrected by hand.
  - **Notifications.** The claimant hears when a claim is approved, rejected, undone, and when the money moves.
  - **On Monad.** The registry has no credit field, so a public design's credits go through its lineage correction call with the lineage unchanged: each record takes its place in the registry's sequence when it's sent, waits behind any open correction of the same work, and carries the lineage the registry holds then. The reason names each artist only by a SHA-256 of their CultRemix artist ID keyed with `ARTIST_HASH_SECRET` ("Artist credit: 3f9a…"; without the secret no record is made), Monad keeps its keccak256, and the design's Lineage section lists it under "Artist credits on Monad", apart from corrections. A change before it's sent replaces the waiting record. A private keep's credits are recorded when it's shared.
  - **Terms.** The Earnings policy says a credit is recognition and not a license, that a style can't be owned, how the share is held and claimed, and that unclaimed amounts are handled as the law requires.
  - **Lineage corrections.** Sales and credits follow a confirmed correction (`effectiveKind`, `effectiveParentWorkId`), as the work page does.
  - **Prompt leaks.** The lettering check also reads requests in Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Korean, and Russian, reads every design when the request screen couldn't answer, and sees letter-spaced or mirrored lettering.
  - **Kept words.** The original's own lettering is read beside the remix's, so a word the reader can't make out even on the original isn't counted as missing; a boxes-only remix skips the full comparison; and a comparison runs again when the original's creator keeps other words later.
- **Still open:** how long unclaimed money is held and where it goes (a lawyer and an accountant decide before checkout opens), and registering v5 and v6 on Monad (the registry takes versions in order, so v5 goes first; Admin, Chain).

**Rules and Monad.** This adds an "artist" role to the economics rules, so it ships as a new rules version, ideally together with costs-first sharing. Monad records the credit under a hashed artist ID and never stores the artist's private details. The Terms should explain that a credit is recognition, not a license.

## Builder handoff

The entries above record decisions, not proof that the features are implemented. Before calling them complete, verify backend earnings and admin examples agree; brand creator-share changes respect the five-point floor and fixed allocation; affiliate rewards leave that allocation intact; public responses cannot reveal individual deals; and phrase matches alone cannot create ancestry. Exercise the unchanged-style character swap and full-restyle cases when checking variation/fork classification.

Implementation context: [after-judging dev work](plans/2026-10-14-after-judging.md), [architecture](architecture.md), [onchain provenance ADR](adr/0001-onchain-provenance.md), and [testing](testing.md). Jon lifted the judging freeze on November 11, 2026; these decisions still have to be implemented before the waiting economics work goes to production.
