import { describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  isRateLimitOperation,
  rateLimitKey,
} from "../../convex/lib/authRateLimit";

describe("rate limit config", () => {
  it("uses separate create and delivery buckets", () => {
    expect(RATE_LIMITS["auth:create_email_attempt"]).toBeDefined();
    expect(RATE_LIMITS["auth:send_email_otp"]).toBeDefined();
    expect(RATE_LIMITS["auth:create_phone_attempt"]).toBeDefined();
    expect(RATE_LIMITS["auth:send_phone_otp"]).toBeDefined();
  });

  it("defines bounded positive limits for each authentication operation", () => {
    for (const config of Object.values(RATE_LIMITS)) {
      expect(config.maxAttempts).toBeGreaterThan(0);
      expect(config.maxAttempts).toBeLessThanOrEqual(100);
      expect(config.windowMs).toBeGreaterThanOrEqual(60_000);
      expect(config.blockMs).toBeGreaterThanOrEqual(config.windowMs);
    }
  });

  it("keeps email and phone delivery and verification limits explicit", () => {
    expect(RATE_LIMITS["auth:send_email_otp"].maxAttempts).toBe(5);
    expect(RATE_LIMITS["auth:verify_email_otp"].maxAttempts).toBe(10);
    expect(RATE_LIMITS["auth:send_phone_otp"].maxAttempts).toBe(5);
    expect(RATE_LIMITS["auth:verify_phone_otp"].maxAttempts).toBe(10);
    expect(RATE_LIMITS["auth:create_phone_attempt"].maxAttempts).toBe(20);
  });

  it("normalizes keys", () => {
    expect(rateLimitKey("auth:send_email_otp", " Test@Example.COM ")).toBe(
      "auth:send_email_otp:test@example.com",
    );
  });

  it("validates known operations", () => {
    expect(isRateLimitOperation("auth:send_magic_link")).toBe(true);
    expect(isRateLimitOperation("auth:missing")).toBe(false);
  });
});
