// The deploy's data steps (the Ops message's step 5) for scripts/deploy-migrate.ts. Each step calls
// its Convex function through io.call, follows the function's cursor or continuation until it's
// done, and returns one line for the log plus anything that needs a look. They live apart from the
// script so tests can run them against a fake deployment.

export type Call = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type StepIO = {
  call: Call;
  sleep: (ms: number) => Promise<void>;
  // Makes each image step stop after every page, so the runner's continuation is exercised.
  onePageRuns?: boolean;
};

export type StepResult = { line: string; attention?: string };

export type Step = {
  name: string;
  fn: string;
  does: string;
  // What the October 11 rehearsal on a copy of production reported.
  copy: string;
  run: (io: StepIO) => Promise<StepResult>;
};

type Args = Record<string, unknown>;
type Counts = { moved: number; checked: number; failed: number; continued?: boolean };

const MAX_ROUNDS = 10_000;

// Calls fn until nextOf says it's finished, passing each result to add. A place to continue from
// that comes back twice means the function isn't moving forward, so that stops the step.
async function follow<TResult>(
  io: StepIO,
  fn: string,
  first: Args,
  nextOf: (result: TResult) => Args | null,
  add: (result: TResult) => void,
) {
  const seen = new Set<string>();
  let args = first;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const result = (await io.call(fn, args)) as TResult;
    add(result);
    const next = nextOf(result);
    if (!next) return;
    const place = JSON.stringify(next);
    if (seen.has(place)) throw new Error(fn + " returned the same place to continue from twice, so it isn't moving forward.");
    seen.add(place);
    args = { ...first, ...next };
  }
  throw new Error(fn + " was still going after " + MAX_ROUNDS + " runs.");
}

function imageArgs(io: StepIO): Args {
  return io.onePageRuns ? { returnNext: true, budgetMs: 0 } : { returnNext: true };
}

// Runs a sizing action from the start until it's done, adding up its counts.
async function sizingRun(io: StepIO, fn: string, countKey: "moved" | "made") {
  const total = { done: 0, checked: 0, failed: 0, onItsOwn: false, runs: 0 };
  await follow<Counts & { made?: number; next?: Args }>(
    io,
    fn,
    imageArgs(io),
    (result) => result.next ?? null,
    (result) => {
      total.runs++;
      total.done += (countKey === "moved" ? result.moved : result.made) ?? 0;
      total.checked += result.checked;
      total.failed += result.failed;
      // A deployment without returnNext continues in runs of its own that this can't see.
      if (result.continued) total.onItsOwn = true;
    },
  );
  return total;
}

// "over 12 runs" when the runner had to continue an action, so a log shows it did.
function runsNote(runs: number) {
  return runs > 1 ? " over " + runs + " runs" : "";
}

const ON_ITS_OWN = "It continues in runs of its own; wait for its \"done\" line in bunx convex logs before trusting the next steps.";

function plural(n: number, one: string, many = one + "s") {
  return n + " " + (n === 1 ? one : many);
}

function stillHave(n: number) {
  return n === 1 ? " still has " : " still have ";
}

export const STEPS: Array<Step> = [
  {
    name: "seed",
    fn: "seed:environment",
    does: "adds any missing switch and counter; existing settings stay as they are",
    copy: "added the switches production lacked and the creator number counter; kept the settings, the image model switch, and the CR family counter",
    async run({ call }) {
      const result = (await call("seed:environment", {})) as { created: Array<string>; kept: Array<string> };
      const added = result.created.length ? "added " + result.created.join(", ") : "nothing to add";
      return { line: added + "; kept " + plural(result.kept.length, "existing setting") };
    },
  },
  {
    name: "organize",
    fn: "sizing:organize",
    does: "moves every image out of Convex storage into R2's folders, without the image model's metadata",
    copy: "moved 141, failed 0, in 84 s; a second run moved 0",
    async run(io) {
      const first = await sizingRun(io, "sizing:organize", "moved");
      let line = "moved " + first.done + ", failed " + first.failed + runsNote(first.runs);
      if (first.onItsOwn) return { line, attention: ON_ITS_OWN };
      if (first.done === 0 && first.failed === 0) return { line: line + " (nothing left to move)" };
      // A second pass retries failures and confirms nothing is left behind.
      const again = await sizingRun(io, "sizing:organize", "moved");
      line += "; a second pass moved " + again.done + ", failed " + again.failed + runsNote(again.runs);
      if (again.failed > 0) {
        return {
          line,
          attention:
            plural(again.failed, "image") +
            " couldn't move. Pages keep loading them from Convex storage; the Convex logs say why. Run it again with --only organize.",
        };
      }
      return { line };
    },
  },
  {
    name: "sizes",
    fn: "sizing:backfill",
    does: "makes a thumbnail and medium for any image without them",
    copy: "checked 120, made 0, failed 0",
    async run(io) {
      const total = await sizingRun(io, "sizing:backfill", "made");
      const line = "checked " + total.checked + ", made " + total.done + ", failed " + total.failed + runsNote(total.runs);
      if (total.onItsOwn) return { line, attention: ON_ITS_OWN };
      if (total.failed > 0) {
        return {
          line,
          attention:
            plural(total.failed, "image") + stillHave(total.failed) + "no thumbnail and medium; the Convex logs say why. Run it again with --only sizes.",
        };
      }
      return { line };
    },
  },
  {
    name: "notes",
    fn: "imageNotes:backfillWorks",
    does: "writes notes for each published design, reading its lettering with the request it was made from",
    copy: "written 11 of 11, in 73 s",
    async run({ call }) {
      type Notes = { checked: number; written: number; failed: number; skipped: number };
      const first = (await call("imageNotes:backfillWorks", {})) as Notes;
      let line = "written " + first.written + " of " + first.checked;
      let last = first;
      // A design whose reading failed has no notes yet; one more pass usually gets it.
      if (first.failed > 0) {
        last = (await call("imageNotes:backfillWorks", {})) as Notes;
        line += "; " + first.failed + " failed, and a second pass wrote " + last.written + " of " + last.checked;
      }
      if (last.skipped > 0) {
        return {
          line,
          attention:
            "AI_GATEWAY_API_KEY isn't set on this deployment, so " +
            plural(last.skipped, "design was", "designs were") +
            " skipped. Set it, then run again with --from notes.",
        };
      }
      if (last.failed > 0) {
        return {
          line,
          attention:
            plural(last.failed, "published design") +
            stillHave(last.failed) +
            "no notes; a design's page offers no remixable words until it has them. Run it again with --only notes.",
        };
      }
      return { line };
    },
  },
  {
    name: "reread",
    fn: "images:reanalyzeAll",
    does: "re-reads every member image's notes with the current notes prompt, a second apart",
    copy: "scheduled 0 (production had no member images yet)",
    async run({ call, sleep }) {
      let scheduled = 0;
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (;;) {
        const page = (await call("images:reanalyzeAll", cursor ? { cursor } : {})) as { scheduled: number; cursor: string | null };
        scheduled += page.scheduled;
        if (!page.cursor) break;
        if (seen.has(page.cursor)) throw new Error("images:reanalyzeAll returned the same cursor twice, so it isn't moving forward.");
        seen.add(page.cursor);
        cursor = page.cursor;
        // Each page schedules its re-reads a second apart from now; waiting keeps the next page's
        // from landing on top of them.
        await sleep(page.scheduled * 1000);
      }
      if (scheduled === 0) return { line: "nothing to re-read" };
      return { line: "scheduled " + scheduled + " re-reads; they finish over about " + Math.ceil(scheduled / 60) + " min, and a failed one keeps its earlier notes" };
    },
  },
  {
    name: "words",
    fn: "remixFields:backfill",
    does: "proposes remixable words for any published design the notes step didn't",
    copy: "checked 11, saved 0 (normal: saving a design's notes already proposes them)",
    async run({ call }) {
      const result = (await call("remixFields:backfill", {})) as { checked: number; saved: number; done: boolean };
      const line = "checked " + result.checked + ", saved " + result.saved;
      return { line: result.done ? line : line + "; later pages follow on their own within seconds" };
    },
  },
  {
    name: "parts",
    fn: "remixPartsActions:backfillWorks",
    does: "proposes remixable characters, people, and groups for any design the notes step didn't",
    copy: "checked 0, saved 0 (normal for the same reason)",
    async run({ call }) {
      const result = (await call("remixPartsActions:backfillWorks", {})) as { checked: number; saved: number };
      return { line: "checked " + result.checked + ", saved " + result.saved };
    },
  },
  {
    name: "activity",
    fn: "activity:backfill",
    does: "fills profiles and the Following feed for designs published before them",
    copy: "scanned 11",
    async run({ call }) {
      const result = (await call("activity:backfill", {})) as { scanned: number; isDone: boolean };
      const line = "scanned " + result.scanned;
      return { line: result.isDone ? line : line + "; later pages follow on their own within seconds" };
    },
  },
  {
    name: "lineage",
    fn: "lineage:backfillEffectiveParents",
    does: "gives earlier remixes their effective parent, so their originals count them",
    copy: "updated 5",
    async run(io) {
      let updated = 0;
      await follow<{ updated: number; cursor: string | null }>(
        io,
        "lineage:backfillEffectiveParents",
        {},
        (page) => (page.cursor ? { cursor: page.cursor } : null),
        (page) => {
          updated += page.updated;
        },
      );
      return { line: "updated " + updated };
    },
  },
  {
    name: "trending",
    fn: "trending:rebuild",
    does: "fills the Trending tab from the last week's hearts, remixes, and Backs",
    copy: "0 hearts, 0 remixes, 0 Backs (nothing in the week before)",
    async run({ call }) {
      const result = (await call("trending:rebuild", {})) as { hearts: number; remixes: number; backs: number };
      return { line: plural(result.hearts, "heart") + ", " + plural(result.remixes, "remix", "remixes") + ", " + plural(result.backs, "Back") };
    },
  },
];

function valueOf(argv: Array<string>, flag: string) {
  const index = argv.findIndex((arg) => arg === flag || arg.startsWith(flag + "="));
  if (index < 0) return undefined;
  const arg = argv[index];
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(flag + " needs a step name. " + namesLine());
  return value;
}

function namesLine() {
  return "Steps: " + STEPS.map((step) => step.name).join(", ") + ".";
}

function namesIn(value: string) {
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!STEPS.some((step) => step.name === name)) throw new Error("There's no step called " + name + ". " + namesLine());
  }
  return names;
}

// --from <step> starts there, --only <a,b> runs just those, --skip <a,b> leaves those out.
export function pickSteps(argv: Array<string>): Array<Step> {
  const from = valueOf(argv, "--from");
  const only = valueOf(argv, "--only");
  const skip = valueOf(argv, "--skip");
  if (from && only) throw new Error("Use --from or --only, not both.");
  let steps = STEPS;
  if (from) steps = steps.slice(STEPS.findIndex((step) => step.name === namesIn(from)[0]));
  if (only) {
    const names = namesIn(only);
    steps = steps.filter((step) => names.includes(step.name));
  }
  if (skip) {
    const names = namesIn(skip);
    steps = steps.filter((step) => !names.includes(step.name));
  }
  if (steps.length === 0) throw new Error("That leaves no steps to run. " + namesLine());
  return steps;
}

export function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + " s";
  return Math.floor(seconds / 60) + " min " + (seconds % 60) + " s";
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Runs the steps in order and stops at the first that fails, saying where to start again.
export async function runSteps(steps: Array<Step>, io: StepIO, log: (line: string) => void, now: () => number = Date.now) {
  const attention: Array<string> = [];
  for (const step of steps) {
    const position = STEPS.indexOf(step) + 1;
    log("");
    log("Step " + position + " of " + STEPS.length + ", " + step.name + " (" + step.fn + "): " + step.does);
    const started = now();
    try {
      const result = await step.run(io);
      log("  " + result.line + ", in " + duration(now() - started));
      log("  The copy of production: " + step.copy);
      if (result.attention) {
        log("  Needs a look: " + result.attention);
        attention.push(step.name + ": " + result.attention);
      }
    } catch (error) {
      log("  Failed after " + duration(now() - started) + ": " + messageOf(error));
      log("");
      log(
        "Stopped at " +
          step.name +
          "; the steps before it are done. Fix the cause, then run again with --from " +
          step.name +
          ". Every step is safe to run again.",
      );
      return { ok: false, failedAt: step.name, attention };
    }
  }
  return { ok: true, attention };
}
