import { describe, expect, it } from "vitest";
import { STEPS, duration, pickSteps, runSteps } from "../../scripts/lib/deployMigrate";
import type { Step, StepIO } from "../../scripts/lib/deployMigrate";

// A fake deployment: each function answers from its own queue of results, in order.
function deployment(answers: Record<string, Array<unknown>>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const waits: Array<number> = [];
  const io: StepIO = {
    call: (fn, args) => {
      calls.push({ fn, args });
      const queue = answers[fn] as Array<unknown> | undefined;
      const next = queue?.shift();
      if (next === undefined) return Promise.reject(new Error("No answer left for " + fn));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
  return { io, calls, waits };
}

function step(name: string): Step {
  const found = STEPS.find((s) => s.name === name);
  if (!found) throw new Error(name);
  return found;
}

describe("deploy data steps", () => {
  it("follows organize from where each run stopped, then checks once more", async () => {
    const { io, calls } = deployment({
      "sizing:organize": [
        { moved: 100, checked: 2, failed: 0, continued: false, next: { phase: "designs", cursor: "c1" } },
        { moved: 41, checked: 1, failed: 0, continued: false },
        { moved: 0, checked: 0, failed: 0, continued: false },
      ],
    });
    const result = await step("organize").run(io);
    expect(result).toEqual({ line: "moved 141, failed 0 over 2 runs; a second pass moved 0, failed 0" });
    expect(calls.map((c) => c.args)).toEqual([
      { returnNext: true },
      { returnNext: true, phase: "designs", cursor: "c1" },
      { returnNext: true },
    ]);
  });

  it("skips the second organize pass when nothing moved, and flags images that still can't move", async () => {
    const idle = deployment({ "sizing:organize": [{ moved: 0, checked: 3, failed: 0, continued: false }] });
    expect(await step("organize").run(idle.io)).toEqual({ line: "moved 0, failed 0 (nothing left to move)" });
    expect(idle.calls).toHaveLength(1);

    const stuck = deployment({
      "sizing:organize": [
        { moved: 5, checked: 0, failed: 2, continued: false },
        { moved: 0, checked: 0, failed: 2, continued: false },
      ],
    });
    const result = await step("organize").run(stuck.io);
    expect(result.line).toBe("moved 5, failed 2; a second pass moved 0, failed 2");
    expect(result.attention).toMatch(/^2 images couldn't move/);
  });

  it("passes a zero budget for one-page runs and adds up the size backfill", async () => {
    const { io, calls } = deployment({
      "sizing:backfill": [
        { checked: 40, made: 1, failed: 0, continued: false, next: { table: 0, cursor: "a" } },
        { checked: 12, made: 0, failed: 1, continued: false, next: { table: 1, cursor: null } },
        { checked: 7, made: 0, failed: 0, continued: false },
      ],
    });
    const result = await step("sizes").run({ ...io, onePageRuns: true });
    expect(result.line).toBe("checked 59, made 1, failed 1 over 3 runs");
    expect(result.attention).toMatch(/^1 image still has no thumbnail/);
    expect(calls[1].args).toEqual({ returnNext: true, budgetMs: 0, table: 0, cursor: "a" });
    expect(calls[2].args).toEqual({ returnNext: true, budgetMs: 0, table: 1, cursor: null });
  });

  it("stops a step whose continuation doesn't move forward", async () => {
    const same = { moved: 0, checked: 0, failed: 0, continued: false, next: { phase: "works", cursor: "x" } };
    const { io } = deployment({ "sizing:organize": [same, same, same] });
    await expect(step("organize").run(io)).rejects.toThrow(/same place to continue from twice/);
  });

  it("says when a run continued on its own instead of returning where it stopped", async () => {
    const { io } = deployment({ "sizing:backfill": [{ checked: 40, made: 40, failed: 0, continued: true }] });
    expect((await step("sizes").run(io)).attention).toMatch(/continues in runs of its own/);
  });

  it("waits between pages of re-reads so they stay a second apart", async () => {
    const { io, calls, waits } = deployment({
      "images:reanalyzeAll": [
        { scheduled: 200, cursor: "p2" },
        { scheduled: 3, cursor: null },
      ],
    });
    expect((await step("reread").run(io)).line).toMatch(/^scheduled 203 re-reads/);
    expect(waits).toEqual([200_000]);
    expect(calls.map((c) => c.args)).toEqual([{}, { cursor: "p2" }]);
  });

  it("gives work notes a second pass after a failure and names what's still missing", async () => {
    const retried = deployment({
      "imageNotes:backfillWorks": [
        { checked: 11, written: 10, failed: 1, skipped: 0 },
        { checked: 1, written: 1, failed: 0, skipped: 0 },
      ],
    });
    expect(await step("notes").run(retried.io)).toEqual({ line: "written 10 of 11; 1 failed, and a second pass wrote 1 of 1" });

    const noKey = deployment({ "imageNotes:backfillWorks": [{ checked: 2, written: 0, failed: 0, skipped: 2 }] });
    expect((await step("notes").run(noKey.io)).attention).toMatch(/AI_GATEWAY_API_KEY/);
  });

  it("follows the lineage cursor and adds up what it updated", async () => {
    const { io } = deployment({
      "lineage:backfillEffectiveParents": [
        { updated: 3, cursor: "n1" },
        { updated: 2, cursor: null },
      ],
    });
    expect(await step("lineage").run(io)).toEqual({ line: "updated 5" });
  });

  it("stops at the first failing step and says where to start again", async () => {
    const { io, calls } = deployment({
      "seed:environment": [{ created: [], kept: ["appSettings.main"] }],
      "sizing:organize": [new Error("R2 isn't configured on this deployment.")],
    });
    const lines: Array<string> = [];
    const result = await runSteps(STEPS, io, (line) => lines.push(line));
    expect(result).toEqual({ ok: false, failedAt: "organize", attention: [] });
    expect(calls.map((c) => c.fn)).toEqual(["seed:environment", "sizing:organize"]);
    expect(lines.join("\n")).toMatch(/nothing to add; kept 1 existing setting/);
    expect(lines.join("\n")).toMatch(/run again with --from organize/);
  });

  it("picks steps with --from, --only, and --skip, and names the steps when one is unknown", () => {
    const names = (argv: Array<string>) => pickSteps(argv).map((s) => s.name);
    expect(names([])).toEqual(STEPS.map((s) => s.name));
    expect(names(["--prod", "--from", "notes"])).toEqual(["notes", "reread", "words", "parts", "activity", "lineage", "trending"]);
    expect(names(["--from=lineage"])).toEqual(["lineage", "trending"]);
    expect(names(["--only", "notes,trending"])).toEqual(["notes", "trending"]);
    expect(names(["--skip", "reread"])).not.toContain("reread");
    expect(() => pickSteps(["--only", "nots"])).toThrow(/no step called nots\. Steps: seed, organize/);
    expect(() => pickSteps(["--from"])).toThrow(/needs a step name/);
    expect(() => pickSteps(["--from", "seed", "--only", "seed"])).toThrow(/not both/);
  });

  it("writes durations people can read", () => {
    expect(duration(84_400)).toBe("1 min 24 s");
    expect(duration(2_000)).toBe("2 s");
  });
});
