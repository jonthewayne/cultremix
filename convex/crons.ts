import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Launch metrics: recount yesterday and today (convex/metrics.ts).
crons.hourly("count launch metrics", { minuteUTC: 7 }, internal.metrics.rollupRecent, {});

export default crons;
