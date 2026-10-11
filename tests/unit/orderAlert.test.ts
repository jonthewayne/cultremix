import { describe, expect, it } from "vitest";
import { NOT_CONFIGURED, alertKey, lateTrouble, orderAlertEmailContent, stuckReason } from "../../convex/lib/orderAlert";

describe("order alerts", () => {
  it("say what's wrong, from the order's own reason or what its state means", () => {
    expect(stuckReason("needs_attention", "CR 101-001 was taken down.")).toBe("CR 101-001 was taken down.");
    expect(stuckReason("on_hold", undefined)).toMatch(/^Printful put it on hold/u);
    expect(stuckReason("manual_required", "  ")).toBe("It needs to be made in Printful by hand.");
    // A new reason is a new alert; the same one isn't.
    expect(alertKey("needs_attention", "a")).not.toBe(alertKey("needs_attention", "b"));
    expect(alertKey("on_hold", undefined)).toBe(alertKey("on_hold", ""));
  });

  it("email the owner with a link to Admin, Orders, escaping the reason", () => {
    const email = orderAlertEmailContent({ orderName: "#1001", reason: "Printful said <no>.", siteUrl: "https://cultremix.com/" });
    expect(email.subject).toBe("Order #1001 needs you");
    expect(email.text).toBe("Order #1001 can't go on by itself: Printful said <no>.\n\nAdmin, Orders: https://cultremix.com/admin/orders");
    expect(email.html).toContain("Printful said &lt;no&gt;.");
    expect(email.html).toContain('href="https://cultremix.com/admin/orders"');
  });

  it("call a paid order late an hour after payment, and a production draft an hour past its hold", () => {
    const hour = 60 * 60 * 1000;
    const paid = { fulfillmentState: "waiting", economicEventAt: 0, cancelled: false, isTest: false, simulated: false };
    const on = { prod: true, env: true, flag: true };
    expect(lateTrouble(paid, hour - 1, on)).toBeNull();
    expect(lateTrouble({ ...paid, fulfillmentError: NOT_CONFIGURED }, hour, on)).toMatchObject({ key: "late:unconfigured", reason: expect.stringMatching(/Printful isn't connected/u) });
    expect(lateTrouble({ ...paid, fulfillmentError: "Printful said 503." }, hour, on)).toEqual({
      key: "late:waiting",
      reason: "It was paid over an hour ago and still hasn't reached Printful. The last try said: Printful said 503.",
    });
    // A retry that fails with a new message is the same trouble.
    expect(lateTrouble({ ...paid, fulfillmentError: "Printful said 502." }, 2 * hour, on)?.key).toBe("late:waiting");
    // Unpaid, cancelled, and test orders that aren't simulated never are.
    expect(lateTrouble({ ...paid, economicEventAt: undefined }, 5 * hour, on)).toBeNull();
    expect(lateTrouble({ ...paid, cancelled: true }, 5 * hour, on)).toBeNull();
    expect(lateTrouble({ ...paid, isTest: true }, 5 * hour, on)).toBeNull();
    expect(lateTrouble({ ...paid, isTest: true, simulated: true }, 5 * hour, on)?.key).toBe("late:waiting");

    const draft = { ...paid, fulfillmentState: "draft", holdUntil: hour };
    expect(lateTrouble(draft, 2 * hour - 1, on)).toBeNull();
    expect(lateTrouble(draft, 2 * hour, on)?.key).toBe("late:draft");
    expect(lateTrouble(draft, 2 * hour, { ...on, env: false })?.reason).toMatch(/PRINTFUL_AUTO_CONFIRM/u);
    expect(lateTrouble(draft, 2 * hour, { ...on, flag: false })?.reason).toMatch(/Send paid orders to print is off/u);
    // Dev and staging stop at drafts on purpose.
    expect(lateTrouble(draft, 9 * hour, { prod: false, env: false, flag: true })).toBeNull();
    // Other states are the stuck alert's, or fine.
    expect(lateTrouble({ ...paid, fulfillmentState: "submitted" }, 9 * hour, on)).toBeNull();
  });
});
