import { describe, expect, it } from "vitest";
import { RATE_LIMIT_WAIT_MS, isRateLimited, onceMoreIfRateLimited } from "../../convex/lib/rateLimitRetry";

// An error shaped like the AI SDK's APICallError.
function apiError(statusCode: number, message: string, headers?: Record<string, string>) {
  return Object.assign(new Error(message), { statusCode, responseHeaders: headers });
}

function flaky(failures: Array<unknown>) {
  let calls = 0;
  const call = async () => {
    const failure = failures[calls];
    calls += 1;
    if (failure) throw failure;
    return "image";
  };
  return { call, calls: () => calls };
}

describe("one more try for a rate-limited image call", () => {
  it("tries a 429 once more after a pause, honoring Retry-After within limits", async () => {
    const waits: Array<number> = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    const plain = flaky([apiError(429, "Too Many Requests")]);
    expect(await onceMoreIfRateLimited(plain.call, wait)).toBe("image");
    expect(plain.calls()).toBe(2);
    const told = flaky([apiError(429, "Too Many Requests", { "retry-after": "5" })]);
    await onceMoreIfRateLimited(told.call, wait);
    const huge = flaky([apiError(429, "Too Many Requests", { "retry-after": "600" })]);
    await onceMoreIfRateLimited(huge.call, wait);
    expect(waits).toEqual([RATE_LIMIT_WAIT_MS, 5_000, 20_000]);
  });

  it("gives up after the second 429", async () => {
    const twice = flaky([apiError(429, "slow down"), apiError(429, "slow down")]);
    await expect(onceMoreIfRateLimited(twice.call, async () => {})).rejects.toThrow("slow down");
    expect(twice.calls()).toBe(2);
  });

  it("never tries again after anything else, which may have been billed", async () => {
    for (const failure of [apiError(500, "boom"), apiError(400, "bad request"), Object.assign(new Error("timed out"), { name: "TimeoutError" })]) {
      const once = flaky([failure]);
      await expect(onceMoreIfRateLimited(once.call, async () => {})).rejects.toBe(failure);
      expect(once.calls()).toBe(1);
    }
  });

  it("treats a 429 about quota or credit as out of credit, not a rate limit", () => {
    expect(isRateLimited(apiError(429, "You exceeded your current quota"))).toBe(false);
    expect(isRateLimited(apiError(429, "Insufficient credits"))).toBe(false);
    expect(isRateLimited(Object.assign(new Error("outer"), { cause: { statusCode: 429 } }))).toBe(true);
  });
});
