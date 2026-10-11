import { describe, expect, it } from "vitest";
import { alertKey, orderAlertEmailContent, stuckReason } from "../../convex/lib/orderAlert";

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
});
