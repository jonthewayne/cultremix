import { describe, expect, it } from "vitest";
import { callFailure, dayUtc } from "../../convex/lib/paidAttempts";
import {
  gatewayCostCents,
  gridWorstCaseCents,
  photoWorstCaseCents,
  qualityOf,
  singleWorstCaseCents,
  topazWorstCaseCents,
} from "../../convex/lib/pricing";

describe("worst-case prices", () => {
  it("bounds every measured call with room to spare", () => {
    // README "What a call costs": high grid 9.9 / 11.1 cents, medium grid 2.5 / 3.8, single 1.07 / 2.31.
    expect(gridWorstCaseCents(0)).toBe(17);
    expect(gridWorstCaseCents(12)).toBe(38);
    expect(gridWorstCaseCents(0, "medium")).toBe(8);
    expect(singleWorstCaseCents(0)).toBe(6);
    expect(singleWorstCaseCents(1)).toBe(7);
    expect(photoWorstCaseCents()).toBe(4);
    expect(gridWorstCaseCents(1)).toBeGreaterThan(11.1);
    expect(singleWorstCaseCents(1)).toBeGreaterThan(2.31);
  });

  it("grows with each attached image", () => {
    for (let n = 0; n < 12; n++) expect(gridWorstCaseCents(n + 1)).toBeGreaterThanOrEqual(gridWorstCaseCents(n));
  });

  it("prices a Topaz upscale by started 24 megapixels of output", () => {
    expect(topazWorstCaseCents(960, 960)).toBe(8);
    expect(topazWorstCaseCents(1024, 1536)).toBe(16);
    expect(topazWorstCaseCents(10, 10)).toBe(8);
  });

  it("reads quality settings, pricing anything unknown as high", () => {
    expect(qualityOf(undefined, "high")).toBe("high");
    expect(qualityOf("", "medium")).toBe("medium");
    expect(qualityOf("low", "high")).toBe("low");
    expect(qualityOf("medium", "high")).toBe("medium");
    expect(qualityOf("auto", "medium")).toBe("high");
  });
});

describe("gatewayCostCents", () => {
  it("reads the gateway's dollar amount as cents", () => {
    expect(gatewayCostCents({ gateway: { cost: "0.0252" } })).toBe(2.52);
    expect(gatewayCostCents({ gateway: { cost: 0.099 } })).toBe(9.9);
    expect(gatewayCostCents({ gateway: JSON.stringify({ cost: "0.1107", generationId: "gen_1" }) })).toBe(11.07);
    expect(gatewayCostCents({ gateway: { cost: "0" } })).toBe(0);
  });

  it("returns nothing when there's nothing usable", () => {
    for (const metadata of [
      undefined,
      null,
      "0.02",
      {},
      { openai: { cost: "0.02" } },
      { gateway: {} },
      { gateway: { cost: "" } },
      { gateway: { cost: "n/a" } },
      { gateway: { cost: "-0.01" } },
      { gateway: "{not json" },
    ]) {
      expect(gatewayCostCents(metadata)).toBeUndefined();
    }
  });
});

describe("callFailure", () => {
  const apiError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { name: "AI_APICallError", statusCode });

  it("releases on a definitive refusal", () => {
    expect(callFailure(apiError(400))).toEqual({ spend: { kind: "release", reason: "refused 400" }, ambiguous: false });
    expect(callFailure(Object.assign(new Error("wrapped"), { cause: { status: 429 } })).spend.kind).toBe("release");
    expect(callFailure(new Error("Your request was rejected by the safety system."))).toEqual({
      spend: { kind: "release", reason: "content filter" },
      ambiguous: false,
    });
  });

  it("settles, with an unknown outcome, when the call may have run", () => {
    expect(callFailure(apiError(502))).toEqual({ spend: { kind: "settle", reason: "failed 502" }, ambiguous: true });
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    expect(callFailure(timeout)).toEqual({ spend: { kind: "settle", reason: "timed out" }, ambiguous: true });
    expect(callFailure(new Error("socket hang up"))).toEqual({ spend: { kind: "settle", reason: "no answer" }, ambiguous: true });
  });

  it("settles, plainly failed, when the call answered without an image", () => {
    const empty = Object.assign(new Error("No image generated."), { name: "AI_NoImageGeneratedError" });
    expect(callFailure(empty)).toEqual({ spend: { kind: "settle", reason: "no image" }, ambiguous: false });
  });
});

describe("dayUtc", () => {
  it("splits days at midnight UTC", () => {
    expect(dayUtc(Date.parse("2026-10-04T23:59:59.999Z"))).toBe("2026-10-04");
    expect(dayUtc(Date.parse("2026-10-05T00:00:00Z"))).toBe("2026-10-05");
  });
});
