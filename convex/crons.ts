import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Launch metrics: recount yesterday and today (convex/metrics.ts).
crons.hourly("count launch metrics", { minuteUTC: 7 }, internal.metrics.rollupRecent, {});
// ---- Shop (Shopify orders, earnings, Printful) ----
crons.interval("shopify order reconcile", { minutes: 15 }, internal.orders.reconcile, {});
crons.interval("shopify product retry", { minutes: 15 }, internal.shopify.retryDueProducts, {});
crons.interval("printful reconcile", { minutes: 30 }, internal.fulfillment.reconcile, {});
crons.interval("earnings maturity", { hours: 1 }, internal.earnings.matureDue, {});
crons.daily("webhook payload purge", { hourUTC: 9, minuteUTC: 15 }, internal.orders.purgeExpiredPayloads, {});
// ---- end Shop ----

// The daily image budget: settle or release reservations left open by actions that died
// (convex/budget.ts sweep).
crons.interval("sweep paid calls", { minutes: 10 }, internal.budget.sweep, {});

// Trending: days that leave the 7-day window come off works' scores (convex/trending.ts).
crons.hourly("expire trending attention", { minuteUTC: 3 }, internal.trending.expire, {});

export default crons;
