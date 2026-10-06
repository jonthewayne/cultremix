import { describe, expect, it } from "vitest";
import { REMIX_JUDGE_SYSTEM, parseRemixVerdict } from "../../convex/lib/remixJudge";
import { remixChangedOnlyWords } from "../../convex/lib/lineage";

describe("the remix comparison's answer", () => {
  it("reads the verdict, the three aspects, and a one-sentence reason", () => {
    expect(
      parseRemixVerdict(
        'Sure: {"subject": "same", "layout": "same", "style": "changed", "verdict": "fork", "reason": "The same raccoon,   redrawn as a woodblock print"}',
      ),
    ).toEqual({ verdict: "fork", reason: "The same raccoon, redrawn as a woodblock print.", subject: "same", layout: "same", style: "changed" });
  });

  it("refuses answers without a usable verdict", () => {
    expect(parseRemixVerdict("It's a variation.")).toBeNull();
    expect(parseRemixVerdict('{"verdict": "maybe", "reason": "x"}')).toBeNull();
    expect(parseRemixVerdict('{"verdict": "variation"')).toBeNull();
  });

  it("keeps a missing reason empty and drops unknown aspect values", () => {
    expect(parseRemixVerdict('{"verdict": "variation", "subject": "kind of"}')).toEqual({
      verdict: "variation",
      reason: "",
      subject: undefined,
      layout: undefined,
      style: undefined,
    });
  });

  it("tells the model that words and swapped subjects never make a fork, a full restyle does, and to lean to variation", () => {
    expect(REMIX_JUDGE_SYSTEM).toContain("Changed words never make a fork, and neither do swapped subjects");
    expect(REMIX_JUDGE_SYSTEM).toContain("redrawn in a clearly different style or medium");
    expect(REMIX_JUDGE_SYSTEM).toContain("When it's close, answer variation.");
  });
});

describe("which remixes are compared", () => {
  const art = "works/101/001/original.png";
  it("skips a remix that changed only its words on the parent's art", () => {
    expect(remixChangedOnlyWords({ instruction: "", presets: [], inspirationKey: art, images: [{ key: art }] }, art)).toBe(true);
  });
  it("compares anything more: a request, style words, more images, a style, or other art", () => {
    const base = { instruction: "", presets: [] as Array<string>, inspirationKey: art, images: [{ key: art }] };
    expect(remixChangedOnlyWords({ ...base, instruction: "add stars" }, art)).toBe(false);
    expect(remixChangedOnlyWords({ ...base, presets: ["Neon"] }, art)).toBe(false);
    expect(remixChangedOnlyWords({ ...base, images: [{ key: art }, { key: "x.png" }] }, art)).toBe(false);
    expect(remixChangedOnlyWords({ ...base, styles: [{ weight: 40 }] }, art)).toBe(false);
    expect(remixChangedOnlyWords({ ...base, styles: [{ weight: 0 }] }, art)).toBe(true);
    expect(remixChangedOnlyWords({ ...base, inspirationKey: "other.png", images: [{ key: "other.png" }] }, art)).toBe(false);
  });
});
