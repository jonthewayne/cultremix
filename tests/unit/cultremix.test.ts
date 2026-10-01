import { describe, expect, it } from "vitest";
import { validateUsername } from "../../convex/lib/username";
import { colorName } from "../../convex/lib/colors";
import { formatCr, parseCr } from "../../convex/lib/r2";

describe("CR numbers", () => {
  it("formats family and expression as 101-001", () => {
    expect(formatCr(101, 1)).toBe("101-001");
    expect(formatCr(101, 2)).toBe("101-002");
    expect(formatCr(1234, 56)).toBe("1234-056");
  });

  it("parses URL and display forms, and rejects anything else", () => {
    expect(parseCr("101-001")).toEqual({ family: 101, expression: 1 });
    expect(parseCr("CR 101-002")).toEqual({ family: 101, expression: 2 });
    expect(parseCr("cr101-010")).toEqual({ family: 101, expression: 10 });
    expect(parseCr("101")).toBeNull();
    expect(parseCr("abc-001")).toBeNull();
  });
});

describe("usernames", () => {
  it("accepts 3 to 20 letters, numbers, or underscores and strips a leading @", () => {
    expect(validateUsername("@jon_w")).toEqual({ ok: true, username: "jon_w" });
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("has space").ok).toBe(false);
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });

  it("refuses names that collide with routes", () => {
    expect(validateUsername("Studio").ok).toBe(false);
    expect(validateUsername("admin").ok).toBe(false);
  });
});

describe("shirt color names", () => {
  it("names the nearest shirt color for the photo prompt", () => {
    expect(colorName("#f4f1ea")).toBe("off-white");
    expect(colorName("#143cc8")).toBe("royal blue");
    expect(colorName("#111111")).toBe("black");
    expect(colorName("not a color")).toBe("off-white");
  });
});
