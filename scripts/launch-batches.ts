#!/usr/bin/env bun
// Starts the launch set (docs/hackathon/launch-set.md) in a member's studio, so publishing it is
// only picking the best of four for each. Originals go in the owner's studio unless --as names
// someone: one batch per design, each in its own session named for the design. --remixes starts
// the doc's remixes instead, as the second account named by --as, once the originals are
// published: each opens Remix this on its original and changes a word box or asks in Anything else
// to change, the way a judge would. Batches are a few seconds apart, about 13¢ of gateway credit
// each (a little more with the original's art); the day's image budget still applies.
//
//   bun run launch:batches -- --list                     the originals, without starting anything
//   bun run launch:batches                               dev, as the owner
//   bun run launch:batches -- --prod                     production (asks first)
//   bun run launch:batches -- --prod --remixes --as <second account>
//   --only <a,b>       some designs, by title (for --remixes, by original)
//   --gap <seconds>    time between starts (default 6)
import { readFileSync } from "node:fs";
import { nearestGarmentColor } from "../convex/lib/garments";
import { DEFAULT_BG } from "../src/lib/imagePrep";
import { confirmTarget, convexRun, targetFrom } from "./lib/convex-run";
import { launchOriginals, launchRemixes, pickDesigns, remixSessionTitle } from "./lib/launchSet";
import type { Palette } from "../convex/lib/garments";
import type { LaunchRemix } from "./lib/launchSet";

type Refusal = "NO_CREDITS" | "GENERATION_OFF" | "BUDGET";
type Generated = { batchId: string; sessionId: string } | { refused: Refusal };

const REFUSALS: Record<Refusal, string> = {
  NO_CREDITS: "is out of credits (Admin, Members: Give credits)",
  GENERATION_OFF: "can't make designs: the studio is switched off (Admin, Switches)",
  BUDGET: "can't make designs: today's image budget is spent (Admin, Settings)",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function flag(argv: Array<string>, name: string) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(name + " needs a value.");
  return value;
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).split("\n").slice(-2).join(" ");
}

const argv = process.argv.slice(2);
const remixMode = argv.includes("--remixes");
const doc = readFileSync(new URL("../docs/hackathon/launch-set.md", import.meta.url), "utf8");
const only = flag(argv, "--only");
let originals: ReturnType<typeof launchOriginals> = [];
let remixes: Array<LaunchRemix> = [];
try {
  if (remixMode) {
    remixes = launchRemixes(doc);
    if (only) {
      const kept = new Set(pickDesigns(remixes.map((r) => ({ title: r.original, request: "" })), only).map((d) => d.title));
      remixes = remixes.filter((r) => kept.has(r.original));
    }
  } else {
    originals = pickDesigns(launchOriginals(doc), only);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (argv.includes("--list")) {
  if (remixMode) for (const r of remixes) console.log(remixSessionTitle(r) + " (" + r.expect + ")");
  else for (const design of originals) console.log(design.title + ": " + design.request);
  process.exit(0);
}
const gapSeconds = Number(flag(argv, "--gap") ?? 6);
if (!Number.isFinite(gapSeconds) || gapSeconds < 0) fail("--gap takes a number of seconds.");

const target = targetFrom(argv);
const asName = flag(argv, "--as");
if (remixMode && !asName) fail("--remixes needs --as <username>: a second account, so the remixes come from someone else, as a judge's would.");
const member = await convexRun<{ authId: string; username: string | null } | null>(target, "seed:memberIdentity", asName ? { username: asName } : {});
if (!member) fail(asName ? "No member is called " + asName + " on " + target.label + "." : "There's no owner on " + target.label + " yet.");
const who = member.username ? "@" + member.username : "the owner";
const identity = { subject: member.authId, issuer: "cultremix-launch-batches" };

// The shirt the studio starts on, from this deployment's colors on offer.
const palette = (await convexRun<{ colors: Palette }>(target, "merch:palette", {})).colors;
const shirt = (hex: string) => nearestGarmentColor(hex, palette.length > 0 ? palette : undefined).hex;

const count = remixMode ? remixes.length : originals.length;
confirmTarget(target, argv, "Starting " + count + " launch-set " + (remixMode ? "remixes" : "batches") + " in " + who + "'s studio");

// One batch: the studio's own generate as the member, then the session's name. False when the
// member can't make designs right now, which stops the run.
async function start(title: string, args: Record<string, unknown>) {
  const result = await convexRun<Generated>(target, "studio:generate", args, { identity });
  if ("refused" in result) {
    console.log("  " + title + ": not started. " + who + " " + REFUSALS[result.refused] + ".");
    return false;
  }
  await convexRun(target, "studio:renameSession", { sessionId: result.sessionId, title }, { identity });
  console.log("  " + title + ": started (session " + result.sessionId + ")");
  return true;
}

// A remix, as Remix this starts it: a fresh session on the original, its art as image 1, and either
// a word box changed or a request. Null when it can't go (its original isn't published yet, or
// has no such word box).
async function remixArgs(remix: LaunchRemix): Promise<Record<string, unknown> | null> {
  const original = await convexRun<{ workId: string; cr: string } | null>(target, "seed:publishedByTitle", { title: remix.original });
  if (!original) {
    console.log("  " + remixSessionTitle(remix) + ": skipped. Nothing called " + remix.original + " is published yet; publish the originals first.");
    return null;
  }
  let words: Array<{ fieldId: string; text: string }> | undefined;
  if (remix.change.kind === "words") {
    const from = remix.change.from;
    const { fields } = await convexRun<{ fields: Array<{ id: string; text: string }> }>(target, "remixFields:forWork", { workId: original.workId });
    const field = fields.find((f) => f.text.trim().toLowerCase() === from.toLowerCase());
    if (!field) {
      const boxes = fields.map((f) => f.text).join(", ") || "none yet (its words are read a few seconds after publishing)";
      console.log("  " + remixSessionTitle(remix) + ": skipped. CR " + original.cr + " has no word box " + from + " (its boxes: " + boxes + ").");
      return null;
    }
    words = [{ fieldId: field.id, text: remix.change.to }];
  }
  const opened = await convexRun<{ sessionId: string; artKey?: string; backgroundColor: string }>(
    target,
    "studio:startRemix",
    { cr: original.cr, fresh: true },
    { identity },
  );
  if (!opened.artKey) {
    console.log("  " + remixSessionTitle(remix) + ": skipped. CR " + original.cr + "'s art isn't ready yet.");
    return null;
  }
  const imageId = await convexRun<string>(target, "images:adopt", { key: opened.artKey }, { identity });
  return {
    sessionId: opened.sessionId,
    instruction: remix.change.kind === "request" ? remix.change.text : "",
    backgroundColor: shirt(opened.backgroundColor),
    images: [imageId],
    styles: [],
    ...(words ? { words } : {}),
  };
}

let started = 0;
if (remixMode) {
  for (const [index, remix] of remixes.entries()) {
    if (index > 0) await Bun.sleep(gapSeconds * 1000);
    let args: Record<string, unknown> | null;
    try {
      args = await remixArgs(remix);
    } catch (error) {
      console.log("  " + remixSessionTitle(remix) + ": skipped. " + errorText(error));
      continue;
    }
    if (!args) continue;
    if (!(await start(remixSessionTitle(remix), args))) break;
    started += 1;
  }
} else {
  for (const [index, design] of originals.entries()) {
    if (index > 0) await Bun.sleep(gapSeconds * 1000);
    const args = { newSession: true, instruction: design.request, backgroundColor: shirt(DEFAULT_BG), images: [], styles: [] };
    if (!(await start(design.title, args))) break;
    started += 1;
  }
}
console.log("");
console.log("Started " + started + " of " + count + ". Their designs arrive in about a minute.");
if (started > 0 && remixMode) {
  console.log("Next, signed in as " + who + ": publish the best of each from its session. What each should become is in docs/hackathon/launch-set.md (a word box remix is always a variation; for the rest, the publish dialog suggests one).");
} else if (started > 0) {
  console.log("Next, signed in as " + who + ": open the studio, where each design has its own session named for it. Publish the best of each with its title, in this order, so the originals get the lowest numbers; then the remixes (--remixes --as <second account>).");
}
