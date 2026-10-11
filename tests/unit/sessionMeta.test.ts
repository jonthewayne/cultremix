import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_META, pageHasSession, resumeWithoutAuthAfter } from "../../src/lib/sessionMeta";

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

describe("resumeWithoutAuthAfter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fakeClient = () => {
    const calls: Array<string> = [];
    const client = {
      setAuth: async (fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>) => {
        calls.push(String(await fetchToken({ forceRefreshToken: false })));
      },
    };
    return { client, calls };
  };

  it("leaves Better Auth's token in place when it arrives in time", async () => {
    const { client, calls } = fakeClient();
    resumeWithoutAuthAfter(client, 10_000);
    client.setAuth(async () => "member-token");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toEqual(["member-token"]);
  });

  it("resumes signed out when no token arrives", async () => {
    const { client, calls } = fakeClient();
    resumeWithoutAuthAfter(client, 10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["null"]);
    // A token that turns up later still takes over.
    client.setAuth(async () => "late-token");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["null", "late-token"]);
  });
});
