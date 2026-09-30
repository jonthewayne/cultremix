import { describe, expect, it } from "vitest";
import { authEmailContent } from "../../convex/lib/authEmail";

describe("sign-in code email", () => {
  it("puts the code in the subject, the HTML, and the plain text", () => {
    const email = authEmailContent({ appName: "CultRemix", otp: "482913" });
    expect(email.subject).toBe("482913 is your CultRemix code");
    expect(email.html).toContain(">482913<");
    expect(email.text).toContain("Your CultRemix sign-in code: 482913");
    expect(email.html).not.toContain("one click");
  });

  it("escapes the magic link and includes it only when present", () => {
    const email = authEmailContent({
      appName: "CultRemix",
      otp: "000111",
      magicLinkUrl: 'https://cultremix.com/auth?x="1"&y=2',
    });
    expect(email.html).toContain("https://cultremix.com/auth?x=&quot;1&quot;&amp;y=2");
    expect(email.text).toContain("Or sign in with one click: https://cultremix.com/auth?x=\"1\"&y=2");
  });
});
