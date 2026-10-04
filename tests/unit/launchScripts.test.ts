import { describe, expect, it } from "vitest";
import { parseJudgeSpecs } from "../../scripts/lib/judge-list";
import { parseRunOutput } from "../../scripts/lib/convex-run";

describe("judge lists", () => {
  it("reads spaces, colons, commas, comments, and @ usernames", () => {
    expect(
      parseJudgeSpecs([
        "# Monad judges",
        "Judge1@Example.com monad_judge_1",
        "",
        "judge2@example.com:@monad_judge_2  # second",
        "judge3@example.com, monad_judge_3",
      ]),
    ).toEqual([
      { email: "judge1@example.com", username: "monad_judge_1" },
      { email: "judge2@example.com", username: "monad_judge_2" },
      { email: "judge3@example.com", username: "monad_judge_3" },
    ]);
  });

  it("refuses lines it can't read and repeated emails", () => {
    expect(() => parseJudgeSpecs(["judge@example.com"])).toThrow(/Line 1/);
    expect(() => parseJudgeSpecs(["monad_judge judge@example.com extra"])).toThrow(/Line 1/);
    expect(() => parseJudgeSpecs(["a@example.com one", "A@example.com two"])).toThrow(/twice/);
  });
});

describe("convex run output", () => {
  it("reads the JSON result after any log lines", () => {
    expect(parseRunOutput("[CONVEX A(x)] log\nsomething\n{\n  \"created\": []\n}\n")).toEqual({ created: [] });
    expect(() => parseRunOutput("no result")).toThrow(/Couldn't read/);
  });
});
