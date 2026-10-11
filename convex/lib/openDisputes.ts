import { disputeEffect } from "./disputes";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Whether an order has a payment dispute still open (convex/disputes.ts, INV-23). Earnings that
// matured before the dispute opened stay Available in the ledger, since the store winning changes
// nothing, but they wait with the rest until it's over: payouts skip them (convex/payouts.ts), and
// the member's Earnings page shows them on hold (earnings.mine). Cached per order for one query.
export function openDisputeCheck(ctx: QueryCtx) {
  const seen = new Map<Id<"orders">, Promise<boolean>>();
  return (orderId: Id<"orders">): Promise<boolean> => {
    let open = seen.get(orderId);
    if (!open) {
      open = (async () => {
        const order = await ctx.db.get("orders", orderId);
        if (!order) return false;
        const disputes = await ctx.db
          .query("disputes")
          .withIndex("by_shopifyOrder", (q) => q.eq("shopifyOrderId", order.shopifyOrderId))
          .take(20);
        return disputes.some((dispute) => disputeEffect(dispute.kind, dispute.status) === "hold");
      })();
      seen.set(orderId, open);
    }
    return open;
  };
}
