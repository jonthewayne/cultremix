#!/usr/bin/env bun
// Sets up a fresh environment: app settings, every feature flag at its default, and the
// CR family and creator number counters. It only adds what's missing, so running it again
// changes nothing, and it never copies data from another environment.
//
//   bun run seed:environment                                        # dev (.env.local)
//   CONVEX_DEPLOY_KEY=<staging key> bun run seed:environment        # staging
//   bun run seed:environment -- --prod                              # production (asks first)
import { confirmTarget, convexRun, targetFrom } from "./lib/convex-run";

const argv = process.argv.slice(2);
const target = targetFrom(argv);
confirmTarget(target, argv, "Seeding defaults");

const result = await convexRun<{ created: Array<string>; kept: Array<string> }>(target, "seed:environment", {});
if (result.created.length === 0) console.log("Already set up. Nothing changed.");
else console.log(`Added: ${result.created.join(", ")}`);
if (result.kept.length > 0) console.log(`Kept as they were: ${result.kept.join(", ")}`);
console.log(
  [
    "",
    "Next:",
    "  1. Set DEPLOYMENT_ENV on this Convex deployment (staging or prod) so the right label shows.",
    "  2. Sign in with the owner email once to claim Creator № 1.",
    "  3. Check the switches at /admin before inviting anyone.",
  ].join("\n"),
);
