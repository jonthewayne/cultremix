import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ---- Shop (Shopify orders, earnings, Printful) ----
crons.interval("shopify order reconcile", { minutes: 15 }, internal.orders.reconcile, {});
crons.interval("shopify product retry", { minutes: 15 }, internal.shopify.retryDueProducts, {});
crons.interval("printful reconcile", { minutes: 30 }, internal.fulfillment.reconcile, {});
crons.interval("earnings maturity", { hours: 1 }, internal.earnings.matureDue, {});
crons.daily("webhook payload purge", { hourUTC: 9, minuteUTC: 15 }, internal.orders.purgeExpiredPayloads, {});
// ---- end Shop ----

export default crons;
