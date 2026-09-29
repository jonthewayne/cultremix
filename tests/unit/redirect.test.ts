import { describe, expect, it } from "vitest";
import { sanitizeRedirect } from "../../convex/lib/redirect";

describe("sanitizeRedirect", () => {
  it("accepts relative paths", () => {
    expect(sanitizeRedirect("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirect("/team?tab=invites")).toBe("/team?tab=invites");
  });

  it("rejects open redirects", () => {
    expect(sanitizeRedirect("https://example.com")).toBe("/studio");
    expect(sanitizeRedirect("//example.com")).toBe("/studio");
    expect(sanitizeRedirect("/\\example.com")).toBe("/studio");
  });
});
