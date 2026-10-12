import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";

// Errors browsers hit (convex/clientErrors.ts).

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const REPORT = {
  message: "TypeError: x is undefined",
  path: "/studio?s=abc",
  stack: "at a (app.js:1:1)",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  source: "window" as const,
};

describe("browser errors", () => {
  it("count the same error on a page, show it to admins, and tell the owner and ops once about a burst", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "owner", email: "owner@example.com", username: "owner", usernameLower: "owner", platformRole: "super_admin_owner" });
      await ctx.db.insert("users", { authId: "support", username: "support", usernameLower: "support", platformRole: "super_admin_support" });
      await ctx.db.insert("users", { authId: "member", username: "member", usernameLower: "member" });
    });
    await t.mutation(api.clientErrors.report, REPORT);
    await t.mutation(api.clientErrors.report, { ...REPORT, path: "/studio?s=other" });
    await t.mutation(api.clientErrors.report, { ...REPORT, message: "ResizeObserver loop limit exceeded" });
    const seen = await t.withIdentity({ subject: "support" }).query(api.clientErrors.recent, {});
    expect(seen.canManage).toBe(false);
    expect(seen.errors).toEqual([
      expect.objectContaining({ message: "TypeError: x is undefined", path: "/studio", count: 2, browser: "Safari on iPhone", signedIn: false }),
    ]);
    await expect(t.withIdentity({ subject: "member" }).query(api.clientErrors.recent, {})).rejects.toThrow();
    await expect(t.withIdentity({ subject: "support" }).mutation(api.clientErrors.clear, {})).rejects.toThrow();

    // Ten of one error in an hour: one bell notification, however many more come.
    for (let i = 0; i < 12; i++) await t.mutation(api.clientErrors.report, { ...REPORT, message: "Boom" });
    const bell = await t.withIdentity({ subject: "owner" }).query(api.notifications.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(bell.page.filter((item) => item.kind === "ops_alert")).toEqual([
      expect.objectContaining({ alert: expect.stringMatching(/^Browsers hit the same error 10 times in an hour on \/studio: Boom/u) }),
    ]);

    // The owner clears the list; rows last seen over 14 days ago go on their own.
    expect(await t.withIdentity({ subject: "owner" }).mutation(api.clientErrors.clear, {})).toBe(2);
    await t.mutation(api.clientErrors.report, REPORT);
    vi.advanceTimersByTime(15 * 24 * 60 * 60 * 1000);
    expect(await t.mutation(internal.clientErrors.cleanup, {})).toBe(1);
  });

  it("take at most 100 reports every 10 minutes from everyone together", async () => {
    const t = newTest();
    for (let i = 0; i < 105; i++) await t.mutation(api.clientErrors.report, { ...REPORT, message: "Error " + i });
    expect(await t.run((ctx) => ctx.db.query("clientErrors").collect())).toHaveLength(100);
  });
});
