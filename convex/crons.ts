import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Wallets for users who don't have one yet, with backoff after failures (convex/wallets.ts).
crons.interval("wallet reconciliation", { minutes: 5 }, internal.wallets.reconcileWallets, {});

export default crons;
