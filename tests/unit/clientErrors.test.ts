import { describe, expect, it } from "vitest";
import { BURST_COUNT, BURST_WINDOW_MS, browserName, cleanMessage, cleanPath, cleanReport, nextWindow } from "../../convex/lib/clientErrors";
import { describeError } from "../../src/lib/clientErrors";

// Browser errors as convex/clientErrors.ts keeps them (convex/lib/clientErrors.ts).
describe("browser errors", () => {
  it("keep the page's path without its query, with long IDs folded", () => {
    expect(cleanPath("/keep/md77tmn25z13jdzxqd33crnd5x8g31zb?x=1#top")).toBe("/keep/:id");
    expect(cleanPath("/cr/101-001")).toBe("/cr/101-001");
    expect(cleanPath("/studio?s=ks73twq5c69m4a33vspqeg05qn8g2nz3")).toBe("/studio");
    expect(cleanPath("")).toBe("/");
  });

  it("drop Convex's request ID and squash the message to one line", () => {
    expect(cleanMessage("[CONVEX M(studio:generate)] [Request ID: 7f3a9c] Server Error\n  Uncaught ConvexError: nope")).toBe(
      "[CONVEX M(studio:generate)] Server Error Uncaught ConvexError: nope",
    );
    expect(cleanMessage("x".repeat(400))).toHaveLength(300);
  });

  it("leave out noise: extensions, network blips, and ResizeObserver", () => {
    const at = { path: "/" };
    expect(cleanReport({ ...at, message: "ResizeObserver loop completed with undelivered notifications." })).toBeNull();
    expect(cleanReport({ ...at, message: "Script error." })).toBeNull();
    expect(cleanReport({ ...at, message: "TypeError: Failed to fetch" })).toBeNull();
    expect(cleanReport({ ...at, message: "TypeError: Load failed" })).toBeNull();
    expect(cleanReport({ ...at, message: "Boom", stack: "at x (chrome-extension://abc/content.js:1:2)" })).toBeNull();
    expect(cleanReport({ ...at, message: "   " })).toBeNull();
    expect(cleanReport({ message: "TypeError: x is undefined", path: "/studio?s=abc", stack: "at a (app.js:1:1)", userAgent: "UA" })).toEqual({
      key: "TypeError: x is undefined|/studio",
      message: "TypeError: x is undefined",
      path: "/studio",
      stack: "at a (app.js:1:1)",
      userAgent: "UA",
    });
  });

  it("count a burst within an hour of its first", () => {
    let window: { start: number; count: number } | undefined;
    let bursts = 0;
    for (let i = 0; i < BURST_COUNT + 3; i++) {
      const next = nextWindow(window, 1000 + i);
      if (next.burst) bursts++;
      window = next;
    }
    expect(bursts).toBe(1);
    // An hour later it starts over.
    expect(nextWindow(window, 1000 + BURST_WINDOW_MS)).toEqual({ start: 1000 + BURST_WINDOW_MS, count: 1, burst: false });
  });

  it("name the browser plainly", () => {
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36")).toBe("Chrome on Mac");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36 Edg/151.0")).toBe("Edge on Windows");
    expect(browserName("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(browserName(undefined)).toBe("an unknown browser");
  });

  it("describe whatever was thrown", () => {
    expect(describeError(new TypeError("x is undefined")).message).toBe("TypeError: x is undefined");
    expect(describeError(new Error("plain"))).toMatchObject({ message: "plain" });
    expect(describeError("a string")).toEqual({ message: "a string" });
    expect(describeError({ code: 1 })).toEqual({ message: '{"code":1}' });
  });
});
