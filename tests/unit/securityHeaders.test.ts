import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, securityHeadersFor } from "../../src/start";

describe("security headers", () => {
  it("forbid framing and sniffing everywhere, and pin HTTPS only on cultremix.com", () => {
    const prod = securityHeadersFor("https://cultremix.com/cr/101-001");
    expect(prod["X-Frame-Options"]).toBe("DENY");
    expect(prod["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(prod["X-Content-Type-Options"]).toBe("nosniff");
    expect(prod["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(securityHeadersFor("https://www.cultremix.com/")["Strict-Transport-Security"]).toBeDefined();
    // A dev host keeps plain HTTP possible.
    expect(securityHeadersFor("https://mighteous.tailb6e2ea.ts.net:3000/")).toEqual(SECURITY_HEADERS);
    expect(securityHeadersFor("http://localhost:3000/")["Strict-Transport-Security"]).toBeUndefined();
    // The policy never limits scripts, styles, images, or connections (Convex, R2, Shopify).
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(/script-src|style-src|img-src|connect-src|default-src/u);
  });
});
