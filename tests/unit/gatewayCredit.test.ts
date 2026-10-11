import { describe, expect, it } from "vitest";
import { creditLevel, creditWorsened } from "../../shared/config/gatewayCredit";
import { isOutOfCreditError, publicTileError } from "../../convex/lib/imageErrors";

describe("the image credit", () => {
  it("is low under $10 and out at 50¢ or less, and only a drop is news", () => {
    expect([creditLevel(1383), creditLevel(999), creditLevel(50), creditLevel(-58)]).toEqual(["ok", "low", "out", "out"]);
    expect(creditWorsened(undefined, "low")).toBe(true);
    expect(creditWorsened("low", "out")).toBe(true);
    expect(creditWorsened("low", "low")).toBe(false);
    expect(creditWorsened("out", "low")).toBe(false);
  });

  it("tells a designer plainly when the gateway refused for lack of credit, and nothing else", () => {
    for (const error of ["Insufficient funds in your credit balance", "AI Gateway: 402 Payment Required", "insufficient credits"]) {
      expect(isOutOfCreditError(error)).toBe(true);
      expect(publicTileError(error)).toBe("The studio can't make designs right now. Try again in a little while.");
    }
    expect(isOutOfCreditError("Timed out.")).toBe(false);
    expect(publicTileError("rate limited")).toBe("The image service had a problem.");
  });
});
