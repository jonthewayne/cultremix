import { describe, expect, it } from "vitest";
import { waitlistEmailContent } from "../../convex/lib/waitlistEmail";

describe("the early-access email", () => {
  it("names the design and links to it, once", () => {
    const email = waitlistEmailContent({ designs: [{ title: "Grow Slow", cr: "101-001" }], siteUrl: "https://cultremix.com/" });
    expect(email.subject).toBe("You can buy Grow Slow (CR 101-001) now");
    expect(email.text).toContain("You asked to hear when you could buy Grow Slow (CR 101-001). It's ready now.");
    expect(email.text).toContain("Grow Slow (CR 101-001): https://cultremix.com/cr/101-001");
    expect(email.text).toContain("This is the one email you asked for.");
    expect(email.html).toContain('href="https://cultremix.com/cr/101-001"');
  });

  it("lists several designs in one email, and escapes titles in the HTML", () => {
    const email = waitlistEmailContent({
      designs: [{ title: "Rock & <Roll>", cr: "101-001" }, { cr: "102-001" }],
      siteUrl: "https://cultremix.com",
    });
    expect(email.subject).toBe("Designs you asked about can be bought now");
    expect(email.text).toContain("could buy Rock & <Roll> (CR 101-001) and CR 102-001. They're ready now.");
    expect(email.html).toContain("Rock &amp; &lt;Roll&gt; (CR 101-001)");
    expect(email.html).not.toContain("<Roll>");
  });
});
