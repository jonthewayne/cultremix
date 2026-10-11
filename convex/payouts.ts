import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getViewerUser, isOwner } from "./identity";
import { openDisputeCheck } from "./lib/openDisputes";

// Paying creators (from mid-November 2026). A creator's payable balance is the sum of their
// Available earnings, real orders only: matured sales plus any refunds taken after a sale matured
// (negative rows). The owner sends the money however it's decided (USDC on Monad to the creator's
// wallet, or a bank transfer), then records it here: the payout notes the amount, method, and
// reference, and exactly the rows it covered become Paid. A refund after that comes off the next
// payout. Test earnings (dev and staging orders) are never paid, and earnings on an order with an
// open payment dispute wait until it's over (lib/openDisputes.ts): a chargeback the buyer wins takes
// them back.

export const MIN_PAYOUT_CENTS = 5000;
const SCAN = 5000;

const methodValidator = v.union(v.literal("usdc"), v.literal("bank"), v.literal("other"));

async function requireOwner(ctx: QueryCtx) {
  const viewer = await getViewerUser(ctx);
  if (!viewer || !isOwner(viewer)) throw new ConvexError({ code: "FORBIDDEN", message: "Owner only." });
  return viewer;
}

async function payableRows(ctx: QueryCtx, recipientId: Id<"users">) {
  const rows = await ctx.db
    .query("earnings")
    .withIndex("by_recipient_state", (q) => q.eq("recipientId", recipientId).eq("state", "available"))
    .take(SCAN);
  const disputed = openDisputeCheck(ctx);
  const payable = [];
  for (const row of rows) if (!row.simulated && !(await disputed(row.orderId))) payable.push(row);
  return payable;
}

const balanceValidator = v.object({
  recipientId: v.id("users"),
  username: v.optional(v.string()),
  email: v.optional(v.string()),
  creatorNumber: v.optional(v.number()),
  walletAddress: v.optional(v.string()),
  // Payable now.
  availableCents: v.number(),
  // Matured, but on orders with an open payment dispute.
  disputedCents: v.number(),
  pendingCents: v.number(),
  paidCents: v.number(),
  rows: v.number(),
});

// Everyone with real earnings, largest payable balance first.
export const balances = query({
  args: {},
  returns: v.object({ minimumCents: v.number(), creators: v.array(balanceValidator) }),
  handler: async (ctx) => {
    await requireOwner(ctx);
    const byRecipient = new Map<Id<"users">, { available: number; disputed: number; pending: number; paid: number; rows: number }>();
    const disputed = openDisputeCheck(ctx);
    for (const state of ["available", "pending", "held", "paid"] as const) {
      const rows = await ctx.db
        .query("earnings")
        .withIndex("by_state_maturesAt", (q) => q.eq("state", state))
        .take(SCAN);
      for (const row of rows) {
        if (row.simulated) continue;
        const entry = byRecipient.get(row.recipientId) ?? { available: 0, disputed: 0, pending: 0, paid: 0, rows: 0 };
        if (state === "available" && (await disputed(row.orderId))) entry.disputed += row.amountCents;
        else if (state === "available") {
          entry.available += row.amountCents;
          entry.rows += 1;
        } else if (state === "paid") entry.paid += row.amountCents;
        else entry.pending += row.amountCents;
        byRecipient.set(row.recipientId, entry);
      }
    }
    const creators = [];
    for (const [recipientId, entry] of byRecipient) {
      const user: Doc<"users"> | null = await ctx.db.get("users", recipientId);
      creators.push({
        recipientId,
        ...(user?.username ? { username: user.username } : {}),
        ...(user?.email ? { email: user.email } : {}),
        ...(user?.creatorNumber !== undefined ? { creatorNumber: user.creatorNumber } : {}),
        ...(user?.walletAddress ? { walletAddress: user.walletAddress } : {}),
        availableCents: entry.available,
        disputedCents: entry.disputed,
        pendingCents: entry.pending,
        paidCents: entry.paid,
        rows: entry.rows,
      });
    }
    creators.sort((a, b) => b.availableCents - a.availableCents || b.disputedCents - a.disputedCents || b.pendingCents - a.pendingCents);
    return { minimumCents: MIN_PAYOUT_CENTS, creators };
  },
});

// Records money sent. expectedCents is the balance the owner saw: if it changed since (a sale
// matured, a refund came in), nothing is recorded and the page shows the new balance.
export const markPaid = mutation({
  args: { recipientId: v.id("users"), expectedCents: v.number(), method: methodValidator, reference: v.string() },
  returns: v.object({ payoutId: v.id("payouts"), amountCents: v.number(), rows: v.number() }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const reference = args.reference.trim().slice(0, 200);
    if (!reference) throw new ConvexError({ code: "INVALID_INPUT", message: "Add the transaction hash or transfer reference." });
    const rows = await payableRows(ctx, args.recipientId);
    const amountCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    if (amountCents !== args.expectedCents) {
      throw new ConvexError({ code: "CHANGED", message: "This balance changed since the page loaded. Check the new amount." });
    }
    if (amountCents <= 0) throw new ConvexError({ code: "NOTHING_DUE", message: "Nothing is payable to this creator." });
    const now = Date.now();
    const payoutId = await ctx.db.insert("payouts", {
      recipientId: args.recipientId,
      amountCents,
      rows: rows.length,
      method: args.method,
      reference,
      paidBy: owner._id,
      paidAt: now,
    });
    for (const row of rows) await ctx.db.patch("earnings", row._id, { state: "paid", payoutId, updatedAt: now });
    return { payoutId, amountCents, rows: rows.length };
  },
});

const payoutView = v.object({
  id: v.id("payouts"),
  username: v.optional(v.string()),
  amountCents: v.number(),
  method: methodValidator,
  reference: v.string(),
  paidAt: v.number(),
});

// The latest payouts, for the owner.
export const history = query({
  args: {},
  returns: v.array(payoutView),
  handler: async (ctx) => {
    await requireOwner(ctx);
    const payouts = await ctx.db.query("payouts").withIndex("by_paidAt").order("desc").take(50);
    const out = [];
    for (const payout of payouts) {
      const user = await ctx.db.get("users", payout.recipientId);
      out.push({
        id: payout._id,
        ...(user?.username ? { username: user.username } : {}),
        amountCents: payout.amountCents,
        method: payout.method,
        reference: payout.reference,
        paidAt: payout.paidAt,
      });
    }
    return out;
  },
});

// A member's own payouts, for /me/earnings.
export const mine = query({
  args: {},
  returns: v.array(v.object({ amountCents: v.number(), method: methodValidator, reference: v.string(), paidAt: v.number() })),
  handler: async (ctx) => {
    const viewer = await getViewerUser(ctx);
    if (!viewer) return [];
    const payouts = await ctx.db
      .query("payouts")
      .withIndex("by_recipient_paidAt", (q) => q.eq("recipientId", viewer._id))
      .order("desc")
      .take(24);
    return payouts.map(({ amountCents, method, reference, paidAt }) => ({ amountCents, method, reference, paidAt }));
  },
});

