import { describe, expect, it } from "vitest";
import { saleEmailContent } from "../../convex/lib/saleEmail";

describe("the sale email", () => {
  it("names the design, the share, and when it's paid, with links to Earnings and Settings", () => {
    const email = saleEmailContent({
      lines: [{ title: "Slow Roll", cr: "106-001", cents: 540, units: 1 }],
      siteUrl: "https://cultremix.com/",
    });
    expect(email.subject).toBe("Someone bought Slow Roll (CR 106-001)");
    expect(email.text).toContain("Someone bought Slow Roll (CR 106-001). You earn $5.40.");
    expect(email.text).toContain("payable 30 days after the order ships");
    expect(email.text).toContain("https://cultremix.com/me/earnings");
    expect(email.text).toContain("Turn them off in Settings: https://cultremix.com/settings");
    expect(email.html).toContain('href="https://cultremix.com/me/earnings"');
  });

  it("names the original for a remix, counts shirts, and totals several designs", () => {
    const email = saleEmailContent({
      lines: [
        { cr: "108-002", cents: 540, units: 2, from: { title: "Far Out", cr: "108-001" } },
        { title: "Grow Slow", cr: "101-001", cents: 270, units: 1 },
      ],
      siteUrl: "https://cultremix.com",
    });
    expect(email.subject).toBe("Someone bought designs you share in");
    expect(email.text).toContain("Someone bought 2 of CR 108-002, a remix of your Far Out (CR 108-001). You earn $5.40.");
    expect(email.text).toContain("In all, you earn $8.10 from this order.");
  });

  it("escapes titles in the HTML", () => {
    const email = saleEmailContent({ lines: [{ title: "<b>Hi</b> & bye", cr: "101-001", cents: 100, units: 1 }], siteUrl: "https://x.test" });
    expect(email.html).toContain("&lt;b&gt;Hi&lt;/b&gt; &amp; bye");
    expect(email.html).not.toContain("<b>Hi</b>");
  });
});

