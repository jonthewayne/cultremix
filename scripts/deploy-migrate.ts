#!/usr/bin/env bun
// Step 5 of a production deploy as one command: seeds missing settings, then moves and fills the
// data earlier code left behind, in the order the Ops message lists. It follows every cursor and
// continuation itself and prints each result beside what the October 11 rehearsal on a copy of
// production reported. Every step is safe to run again.
//
//   bun run deploy:migrate                                     # dev (.env.local)
//   CONVEX_DEPLOY_KEY=<staging key> bun run deploy:migrate     # staging
//   bun run deploy:migrate -- --prod                           # production (asks first)
//
//   --from <step>      start at that step (after fixing whatever stopped an earlier run)
//   --only <a,b>       run just those steps        --skip <a,b>   leave those out
//   --one-page-runs    stop each image run after one page, to check the runner's continuation
//   --yes              skip the production question
import { confirmTarget, convexRun, targetFrom } from "./lib/convex-run";
import { duration, pickSteps, runSteps } from "./lib/deployMigrate";
import type { Step } from "./lib/deployMigrate";

const argv = process.argv.slice(2);
let steps: Array<Step>;
try {
  steps = pickSteps(argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const target = targetFrom(argv);
console.log("Steps: " + steps.map((step) => step.name).join(", "));
confirmTarget(target, argv, "Running " + (steps.length === 1 ? "1 data step" : steps.length + " data steps"));

const started = Date.now();
const result = await runSteps(
  steps,
  {
    call: (fn, args) => convexRun(target, fn, args),
    sleep: (ms) => Bun.sleep(ms),
    onePageRuns: argv.includes("--one-page-runs"),
  },
  (line) => console.log(line),
);
if (!result.ok) process.exit(1);

console.log("");
console.log("Done in " + duration(Date.now() - started) + ".");
if (result.attention.length > 0) {
  console.log("Needs a look:");
  for (const line of result.attention) console.log("  - " + line);
}
if (target.prod && steps.some((step) => step.name === "notes")) {
  console.log(
    [
      "",
      "Next: open CR 106-001's work page. Under Remix this, \"A remix can change\" should read I LIVE MY,",
      "LIFE A, QUARTER-, MILE AT A, TIME. If a word is missing, run",
      "  bunx convex run --prod images:rereadWorkNotes '{\"cr\":\"106-001\"}'",
      "and look again a minute later.",
    ].join("\n"),
  );
}
