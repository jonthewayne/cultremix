# Creator payouts — withdraw what you're owed

Status: planned, not started. After judging; the first earnings become payable in mid-November 2026.
Decided by Jon, 2026-10-13. Related: docs/hackathon/whats-left.md ("Creators are paid to a wallet they own"), docs/plans/2026-10-13-feat-live-sessions.md.

## Decisions

1. **No Circle.** Member wallets stay CultRemix's managed wallets (`MANAGED_WALLET_SECRET`), used only to sign Monad records. They never hold money. Circle comes back only if members someday need to hold or spend money inside CultRemix.
2. **Creators withdraw.** CultRemix tracks what it owes each creator (the earnings ledger); a creator presses **Withdraw** and chooses how to be paid. Money goes from CultRemix to an account the creator owns.
3. **Two kinds of method.** USDC on Monad to an address the creator gives us (Coinbase, Coinbase Wallet, any Monad wallet), and a bank or debit-card deposit through a payments provider (Stripe Connect first; Moov push-to-card or PayPal later if they're better for creators).
4. **Jon approves payouts** to start. Automatic payouts can come once volume and fraud checks justify them.
5. A lawyer and an accountant confirm the approach (money transmission, tax forms) before the first crypto payout.

## What exists (October 10–13)

- Earnings per sale, held 30 days after shipping, with refunds, disputes, and missing creator access holding them (`convex/earnings.ts`).
- `payouts.balances` (Admin, Payouts): each creator's payable balance, real orders only, above the $50 minimum (`MIN_PAYOUT_CENTS`).
- `payouts.markPaid`: the owner records a payment made outside the app (method `usdc`, `bank`, or `other`, plus a reference), and exactly the rows it covered become Paid.
- `/me/earnings`: a creator's earnings and past payouts.

So the ledger is done. What's missing is the creator's side (choosing a method, asking to be paid) and sending the money from the app.

## What to build

### 1. Payout settings (creator)

On `/me/earnings`, **How you get paid**:

- **USDC on Monad:** paste an address. Shown with the network in large type ("USDC on the Monad network. Sending to another network loses the money."). The address must be a valid EVM address and not a known CultRemix address (the relayer, the registry, the creator's own managed wallet). Saving it emails the creator and starts a **48-hour hold**: no payout goes to a new or changed address until it ends, so a stolen account can't redirect money quickly.
- **Bank or debit card:** **Connect** opens the provider's own onboarding (identity, tax form, bank or card); CultRemix stores only the provider's account ID and status.
- **Tax details:** US creators give a W-9 (through the provider for bank payouts; a CultRemix form for USDC-only creators) before their first payout. Non-US creators give a W-8BEN. Payouts wait until it's on file.

### 2. Withdraw (creator)

When the payable balance is at least $50 and a method is ready, **Withdraw** creates a payout request for the whole payable balance, locking those earnings rows so they can't be requested twice. One open request per creator. The creator sees it as Requested, then Sent with its reference (a Monadscan link for USDC).

### 3. Send (Jon, Admin, Payouts)

Admin, Payouts lists open requests with each creator's method, address or provider account, and the amount.

- **Bank or card:** **Send** calls the provider's payout API; the request becomes Sent with the transfer ID, and a webhook marks it Paid or Failed.
- **USDC:** CultRemix pays from a **treasury wallet** whose key is not on any server. Admin builds the batch (address and amount per creator, total USDC needed) and shows it for Jon to send from the treasury (a hardware wallet or Coinbase account), then Jon pastes each transaction hash. A later step can verify the hash on Monad automatically (the right token, amount, and recipient) before marking it Paid.
- **Fail or cancel:** releases the rows back to Available.

This replaces `markPaid`'s free-form entry for requested payouts; `markPaid` stays for corrections.

### 4. Records and notices

- The creator gets a notification and an email when a payout is sent.
- A yearly per-creator total (dollars, and USDC at its dollar value when sent) for 1099s.
- Admin, Overview's Ready to sell gains a row for the treasury's USDC balance against open requests.

## Data (additive)

- `payoutAccounts`: user, method (`usdc` | `provider`), `usdcAddress`, `addressSetAt`, `holdUntil`, `providerAccountId`, `providerStatus`, `taxFormStatus`, `country`.
- `payoutRequests`: user, `amountCents`, method, destination snapshot (address or provider account), status (`requested` | `sending` | `sent` | `paid` | `failed` | `canceled`), `reference`, `requestedAt`, `sentAt`, `paidAt`, `failureReason`.
- `earnings`: add optional `payoutRequestId` (the lock). The existing `payouts` table stays the record of what was paid.

## Tests

Locking (two requests can't cover the same rows; a refund during a request comes off the next one); the 48-hour hold after an address change; tax-form gating; only the owner (later an ops role) can send; failed and canceled requests release rows; simulated earnings never pay; disputes still hold; USDC hash verification rejects the wrong token, amount, recipient, or network.

## Open questions

- Which provider for bank and card: Stripe Connect (Express accounts), PayPal Payouts, or Moov. Compare fees per payout, instant-to-card cost, countries, and whether it collects tax forms.
- Who pays fees: CultRemix, or the creator (shown before Withdraw)?
- Payout schedule: on request with Jon's approval, or a monthly run.
- Countries supported at first (US only is simplest).
