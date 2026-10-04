import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Launch metrics: recount yesterday and today (convex/metrics.ts).
crons.hourly("count launch metrics", { minuteUTC: 7 }, internal.metrics.rollupRecent, {});

// The daily image budget: settle or release reservations left open by actions that died
// (convex/budget.ts sweep).
crons.interval("sweep paid calls", { minutes: 10 }, internal.budget.sweep, {});

export default crons;
