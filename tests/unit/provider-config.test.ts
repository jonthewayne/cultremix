import { describe, expect, it } from "vitest";
import {
  shouldUseConsoleEmailProvider,
  shouldUseConsoleSmsProvider,
} from "../../convex/lib/providerConfig";

describe("delivery provider selection", () => {
  it("defaults to console email and uses Resend only when selected", () => {
    expect(shouldUseConsoleEmailProvider(undefined)).toBe(true);
    expect(shouldUseConsoleEmailProvider("console")).toBe(true);
    expect(shouldUseConsoleEmailProvider("resend")).toBe(false);
  });

  it("defaults to console SMS and uses Telnyx only when selected", () => {
    expect(shouldUseConsoleSmsProvider(undefined)).toBe(true);
    expect(shouldUseConsoleSmsProvider("console")).toBe(true);
    expect(shouldUseConsoleSmsProvider("telnyx")).toBe(false);
  });
});
