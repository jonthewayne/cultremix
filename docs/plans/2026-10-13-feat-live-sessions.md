# Live studio sessions — watch, chat, suggest, and get credit

Status: planned, not started. Build after the Monad submission (due 2026-10-13, 20:59 PDT).
Requested by Jon, 2026-10-11 and 2026-10-13. Related backlog: phrases as tracked content, creator codes, Weekly Drop featuring (listed at the end).

## Why

Remix Nights and other streams happen on YouTube, Twitch, TikTok, and Instagram at once. Restream can combine some platforms' chat, but not TikTok's or Instagram's, so there's no single place where every viewer can talk. cultremix.com becomes that place: a live session page where anyone can watch the studio and signed-in members chat, suggest phrases, and vote. Every participant is a member we can credit, reward, and turn into a creator, and every session leaves a replay that shows how designs were made.

## What a viewer sees

1. A stream shows a QR code and cultremix.com/live (with the streamer's creator code once codes exist).
2. cultremix.com shows a **Live now** banner while any session is live; tapping it opens the session.
3. The session page: the studio's batches appear as they're made, the design the streamer picks is highlighted, and publishing shows the full-screen CR reveal. A sidebar holds the chat, the phrase queue, and **Published from this session**.
4. Watching needs no account. Chatting, suggesting a phrase, and voting need sign-in (the email code), then a quick username step. Members keep their place on the page after signing in.
5. When a viewer's phrase is used and published, the work says "Words by @viewer", and they get a notification with a link to the shirt.

## Session states

A studio session stays private by default (today's behavior). Its owner can change its state:

| State | Who can see it | Who can add to it |
|---|---|---|
| **Private** (default) | owner only | owner |
| **Live** | anyone with the link; listed in the Live now banner | owner makes designs; signed-in members chat, suggest, vote |
| **Ended** | anyone with the link; listed on the owner's profile under Sessions | nobody: chat, suggestions, and votes are closed; the owner can still publish designs made during the live window |

- **Go live** asks for a session title and an optional end time (default 3 hours). A live session ends when its owner presses **End session** or when its end time passes (a cron closes it). Ending is permanent for new activity; the history stays viewable.
- An owner can **Unpublish the replay**, which hides an ended session from the public again (published works stay published).
- Going live needs a username and, at first, creator access or an admin-granted **Can go live** flag, so the feature can be opened gradually.
- Only one live session per member at a time.

## What's public and what isn't

Public on a live or ended session: the session title, the owner, the batches' finished designs, which design was picked, works published from it, the chat, suggestions, and vote counts.

Still private, exactly as today: the prompt CultRemix builds, notes read from uploaded or style images, uploaded images themselves unless the owner shows them, kept (private) works, and costs. The session page reads only from public, allowlisted queries, the same rule the work pages follow.

## Chat and phrase suggestions

- **Chat:** plain text, 300 characters, newest at the bottom, live through Convex subscriptions. Links aren't clickable. Rate limit per member (for example 1 message per 3 seconds, 20 per minute).
- **Suggest a phrase:** a separate box; a suggestion is up to 80 characters, one active suggestion per member at a time (editable), at most 10 per member per session.
- **Votes:** one vote per member per suggestion; the queue sorts by votes, then age. The owner sees the queue and can **Use this**, which fills the studio's words (or the remix's word box) and marks the suggestion used.
- **Phrase credit:** when a used suggestion's words appear in a published work, the work records the suggester as its words author and shows "Words by @name". The owner can remove that credit if the phrase wasn't really used.

## Moderation

The owner and admins can: delete a message or suggestion (it shows as removed), time out a member for the session (10 minutes or the rest of the session), and block a member from all of the owner's sessions. Admins can end any session and take down its replay. Messages from blocked or timed-out members are refused on the server. Reports reach Admin through the existing takedown path. The site-wide rules (/policies) apply to chat.

## Published from this session

A list at the top of the sidebar (and at the top of an ended session's page): every original, variation, and fork published from the session, newest first, with CR numbers and thumbnails, linking to their work pages. Each work page links back to its session ("Made live in Remix Night #12"), when the session is public.

## Does phrase credit pay?

**At launch: recognition only.** "Words by @name" on the work, a notification, a profile shelf of their phrases, and eligibility for weekly prizes (judged by skill, with official rules and no purchase necessary). No share of sales.

Paying phrase authors is possible later but deliberately separate, because the 15% creator pool is split by the public rules file /economics/v1.json, whose SHA-256 is shown on every work page and registered on Monad. Adding a phrase author as a recipient means:

1. A new rules version (/economics/v2.json) with a phrase-author share taken out of the existing pool (for example 2 of the 15 points), and its own Monad registration.
2. Works keep the rules version they were published under; only works published after v2 use it.
3. A phrase author needs creator access to be paid, like everyone else (plan amendment A1): otherwise their share is held until they get it, which also nudges viewers to become creators.

Decide this with the phrases-as-content work below, once there's data on how often viewer phrases sell.

**How hard (checked 2026-10-13): about 1–2 days on top of phrases as content.** The economics were built for new versions: the split comes from a versioned config (`convex/lib/economicsConfigs.ts`), the registry's `registerEconomicConfig` accepts version 2 without a contract change or redeploy, each order line freezes its config version and recipients at sale time, and earnings, holds, refunds, disputes, and payouts already work on any recipient. The work: a fourth role, `phrase_author`, in `recipientShares` and the schema's role validator; `ECONOMIC_CONFIG_V2`, where a work **without** a phrase author splits exactly as under v1 (so switching to v2 cuts no one's share on existing works); `/economics/v2.json` and its Monad registration; Economics panel and earnings labels; tests. Suggested terms: 10% of the pool (1.5% of a sale), taken from the work's own creator's part so family roots and upstream creators keep theirs; a phrase author needs creator access to be paid (held until then). The real work is attribution, in phrases as content: credit only explicit use (a picked suggestion or a saved phrase, never automatic text matching); the creator can remove a credit before publishing, and admins can correct it later; the credit follows the phrase (a fork that keeps the phrase keeps its author; a variation with a new phrase credits the new phrase's author).

## Data (additive; nothing existing changes)

- `creativeSessions`: add `visibility` (`private` | `live` | `ended`), `liveStartedAt`, `liveEndsAt`, `endedAt`, `replayHidden`, `liveNumber` (per owner, for "Remix Night #12"); index by visibility and start time for the banner.
- `sessionMessages`: session, author, text, createdAt, removedAt, removedBy. Index by session and time.
- `phraseSuggestions`: session, author, text, normalized text, votes, status (`open` | `used` | `removed`), usedInWorkId. Index by session and votes.
- `phraseVotes`: suggestion, voter (unique pair).
- `sessionBans`: owner, member, until (null = all sessions).
- `works`: add optional `sessionId` (when its session is public) and `wordsAuthorId`.
- Users: optional `canGoLive`.

## Pages and pieces

- `/live`: the live sessions now (usually one), or the latest replays when none is live.
- `/s/<sessionId>` (or a short slug): the session page, live or ended.
- Studio: a **Go live** / **End session** control and the owner's queue panel (suggestions, Use this, moderation).
- Home and header: the **Live now** banner.
- Profile: a Sessions shelf with replays.
- Work page: "Words by @name" and "Made live in …".
- Admin: live sessions, end or hide, and Can go live grants.
- Later: `/live/<sessionId>/overlay`, a transparent page for OBS with the QR code, the top suggestion, and the CR reveal.

## Build order

1. **States and the read-only page.** Visibility, Go live and End session, the public session page, Published from this session, the Live now banner, the end-time cron. Usable on stream right away with a QR code in OBS.
2. **Chat** with sign-in, rate limits, and moderation.
3. **Suggestions and votes**, Use this, and "Words by @name".
4. **Replays on profiles**, "Made live in …" on work pages, the Admin view.
5. **The OBS overlay.**

Each step ships alone. Tests: convex-local tests for every permission (who can read a private, live, or ended session; who can post; bans and time-outs; the end-time cron; the public allowlist leaking no prompts or notes), and the signed-in e2e for going live, chatting from a second account, using a suggestion, publishing, and ending.

## Open questions

- Should viewers be able to remix a design live from the session (a "Remix this" during the stream), or only suggest words?
- Default live length (3 hours?) and whether an owner can extend it.
- Who can go live at launch: Jon only, creators, or anyone with a username?
- Prize rules and amounts for weekly viewer prizes.

## Related backlog (separate plans)

- **Phrases as tracked content:** a phrase is its own record with an author and every design that uses it. Same phrase, new look is a fork (today's rule: a design is its look and layout); same look, new phrase is a variation.
- **Scrapbook:** save phrases and images from anywhere (private or public) and turn them into designs.
- **Creator codes and links:** a discount for the person joining, attribution and a recurring cut for the referring creator.
- **Founding Creators:** creator numbers 2–1000 reserved for founders, regular creators from 1001.
- **Weekly Drop:** featuring, the homepage, and the weekly drop are one thing, granted by Jon; a submissions feed to review on stream; weekly prizes for best original and best remix.
- **Sign in with ChatGPT** (V1 R30–R32).
- **Creator payouts** (`docs/plans/2026-10-13-feat-creator-payouts.md`, decided 2026-10-13): no Circle; member wallets stay managed and signing-only; creators press Withdraw and are paid USDC on Monad to an address they own, or by bank or debit card through a payments provider, with Jon approving payouts at first.
