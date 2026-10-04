import { gidTail } from "../../../shared/config/shopify";
import type { ShopifyAdmin } from "./adminClient";
import { ORDERS_UPDATED_QUERY } from "./orderQuery";

// The 15-minute Shopify reconciliation (V1 plan, order ingestion): lists orders updated since the
// cursor so a missed webhook still reaches the same hydration path.

export const RECONCILE_MAX_PAGES = 4;
// The first run (no cursor yet) looks back this far.
export const RECONCILE_FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Overlap with the last run, so an order updated during it is not skipped.
export const RECONCILE_OVERLAP_MS = 5 * 60 * 1000;

export async function listUpdatedOrders(
  admin: Pick<ShopifyAdmin, "graphql">,
  sinceMs: number,
): Promise<{ orders: Array<{ shopifyOrderId: string; updatedAt: number }>; complete: boolean }> {
  const query = `updated_at:>='${new Date(sinceMs).toISOString()}'`;
  const orders: Array<{ shopifyOrderId: string; updatedAt: number }> = [];
  let after: string | null = null;
  for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
    const data: {
      orders: { nodes: Array<{ id: string; updatedAt: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await admin.graphql(ORDERS_UPDATED_QUERY, { query, after });
    for (const node of data.orders.nodes) {
      orders.push({ shopifyOrderId: gidTail(node.id), updatedAt: Date.parse(node.updatedAt) || sinceMs });
    }
    if (!data.orders.pageInfo.hasNextPage) return { orders, complete: true };
    after = data.orders.pageInfo.endCursor;
  }
  return { orders, complete: false };
}
