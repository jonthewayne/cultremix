import { describe, expect, it } from "vitest";
import {
  assertEmailAttemptIdentity,
  publicEmailAttemptStatus,
} from "../../convex/lib/authVerification";
import type { Doc, Id } from "../../convex/_generated/dataModel";

describe("public email verification status", () => {
  it("does not expose a stored magic-link bearer URL", () => {
    const attempt = {
      _id: "attempt-id" as Id<"authVerificationAttempts">,
      _creationTime: 1,
      email: "person@example.test",
      redirect: "/dashboard",
      source: "login",
      status: "pending",
      expiresAtMs: 100,
      magicLinkUrl: "https://app.example.test/api/auth/verify?token=bearer-secret",
      otpCode: "123456",
    } as Doc<"authVerificationAttempts">;
    const result = publicEmailAttemptStatus(attempt);

    expect(result).toMatchObject({
      _id: "attempt-id",
      email: "person@example.test",
      status: "pending",
    });
    expect(result).not.toHaveProperty("magicLinkUrl");
    expect(result).not.toHaveProperty("otpCode");
  });
});

describe("email attempt verification identity", () => {
  it("rejects missing and mismatched identities", () => {
    expect(() => assertEmailAttemptIdentity(undefined, "person@example.test")).toThrow(
      /Not signed in/,
    );
    expect(() =>
      assertEmailAttemptIdentity("other@example.test", "person@example.test"),
    ).toThrow(/does not match/);
  });

  it("matches identity and attempt emails case-insensitively", () => {
    expect(() =>
      assertEmailAttemptIdentity(" Person@Example.Test ", "person@example.test"),
    ).not.toThrow();
  });
});
