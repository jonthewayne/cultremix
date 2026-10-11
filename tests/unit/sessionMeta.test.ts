import { describe, expect, it } from "vitest";
import { SESSION_META, pageHasSession } from "../../src/lib/sessionMeta";

// src/router.tsx waits for the member's token only when the server marked the page as signed in.
describe("pageHasSession", () => {
  const page = (selectors: Array<string>) => ({
    querySelector: (selector: string) => (selectors.includes(selector) ? ({} as Element) : null),
  });

  it("is true only for a page the server marked as signed in", () => {
    expect(pageHasSession(page([`meta[name="${SESSION_META}"]`]))).toBe(true);
    expect(pageHasSession(page([]))).toBe(false);
  });

  it("is false on the server, where there's no document", () => {
    expect(pageHasSession(undefined)).toBe(false);
  });
});
