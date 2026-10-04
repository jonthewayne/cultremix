import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Wallets for users who don't have one yet, with backoff after failures (convex/wallets.ts).
crons.interval("wallet reconciliation", { minutes: 5 }, internal.wallets.reconcileWallets, {});

// Chain writes: a safety net that restarts the relayer tick if it stopped with work left
// (convex/chain.ts). The tick reschedules itself while anything is in flight.
crons.interval("chain write tick", { minutes: 1 }, internal.chain.kick, {});

export default crons;
