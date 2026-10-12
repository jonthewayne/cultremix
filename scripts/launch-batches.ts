#!/usr/bin/env bun
// Starts the launch set's originals (docs/hackathon/launch-set.md) in a member's studio, the owner's
// unless --as names someone: one batch per design, each in its own session named for the design, a
// few seconds apart. Publishing the set is then opening the studio and picking the best of four for
// each, with no requests to type or wait on. Each batch costs about 13¢ of gateway credit; the
// owner's credits are unlimited, and the day's image budget still applies.
//
//   bun run launch:batches -- --list                     the designs, without starting anything
//   bun run launch:batches                               dev, as the owner
//   bun run launch:batches -- --prod                     production (asks first)
//   --as <username>    someone other than the owner
//   --only <a,b>       some designs, by title ("Grow Slow,Night Shift")
//   --gap <seconds>    time between starts (default 6)
import { readFileSync } from "node:fs";
import { nearestGarmentColor } from "../convex/lib/garments";
import { DEFAULT_BG } from "../src/lib/imagePrep";
import { confirmTarget, convexRun, targetFrom } from "./lib/convex-run";
import { launchOriginals, pickDesigns } from "./lib/launchSet";
import type { Palette } from "../convex/lib/garments";

type Generated = { batchId: string; sessionId: string } | { refused: "NO_CREDITS" | "GENERATION_OFF" | "BUDGET" };

const REFUSALS = {
  NO_CREDITS: "is out of credits (Admin, Members: Give credits)",
  GENERATION_OFF: "can't make designs: the studio is switched off (Admin, Switches)",
  BUDGET: "can't make designs: today's image budget is spent (Admin, Settings)",
} as const;

function flag(argv: Array<string>, name: string) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(name + " needs a value.");
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
let designs;
try {
  designs = pickDesigns(launchOriginals(readFileSync(new URL("../docs/hackathon/launch-set.md", import.meta.url), "utf8")), flag(argv, "--only"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (argv.includes("--list")) {
  for (const design of designs) console.log(design.title + ": " + design.request);
  process.exit(0);
}
const gapSeconds = Number(flag(argv, "--gap") ?? 6);
if (!Number.isFinite(gapSeconds) || gapSeconds < 0) fail("--gap takes a number of seconds.");

const target = targetFrom(argv);
const asName = flag(argv, "--as");
const member = await convexRun<{ authId: string; username: string | null } | null>(target, "seed:memberIdentity", asName ? { username: asName } : {});
if (!member) fail(asName ? "No member is called " + asName + " on " + target.label + "." : "There's no owner on " + target.label + " yet.");
const who = member.username ? "@" + member.username : "the owner";
const identity = { subject: member.authId, issuer: "cultremix-launch-batches" };

// The shirt the studio starts on, from this deployment's colors on offer.
const palette = (await convexRun<{ colors: Palette }>(target, "merch:palette", {})).colors;
const backgroundColor = nearestGarmentColor(DEFAULT_BG, palette.length > 0 ? palette : undefined).hex;

confirmTarget(target, argv, "Starting " + designs.length + " launch-set batches in " + who + "'s studio");
let started = 0;
for (const [index, design] of designs.entries()) {
  if (index > 0) await Bun.sleep(gapSeconds * 1000);
  const result = await convexRun<Generated>(
    target,
    "studio:generate",
    { newSession: true, instruction: design.request, backgroundColor, images: [], styles: [] },
    { identity },
  );
  if ("refused" in result) {
    console.log("  " + design.title + ": not started. " + who + " " + REFUSALS[result.refused] + ".");
    break;
  }
  await convexRun(target, "studio:renameSession", { sessionId: result.sessionId, title: design.title }, { identity });
  started += 1;
  console.log("  " + design.title + ": started (session " + result.sessionId + ")");
}
console.log("");
console.log("Started " + started + " of " + designs.length + ". Their designs arrive in about a minute, about 13¢ of gateway credit each.");
if (started > 0) {
  console.log(
    "Next, signed in as " + who + ": open the studio, where each design has its own session named for it. Publish the best of each with its title, in this order, so the originals get the lowest numbers; then the remixes in docs/hackathon/launch-set.md.",
  );
}
