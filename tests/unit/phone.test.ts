import { describe, expect, it } from "vitest";
import {
  isPhoneTempEmail,
  normalizePhone,
  normalizePhoneWithCode,
  phoneTempEmail,
} from "../../convex/lib/phone";

describe("phone helpers", () => {
  it("normalizes US phone numbers to E.164", () => {
    expect(normalizePhone("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhoneWithCode("1", "4155552671")).toBe("+14155552671");
    expect(normalizePhone("1-415-555-2671")).toBe("+14155552671");
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("rejects invalid phone numbers", () => {
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhoneWithCode("", "4155552671")).toBeNull();
    expect(normalizePhoneWithCode("1", "")).toBeNull();
  });

  it("normalizes valid international numbers", () => {
    expect(normalizePhone("+442071234567")).toBe("+442071234567");
    expect(normalizePhoneWithCode("44", "2071234567")).toBe("+442071234567");
  });

  it("centralizes temp email detection", () => {
    expect(phoneTempEmail("+14155552671")).toBe("+14155552671@phone.local.test");
    expect(isPhoneTempEmail("+14155552671@phone.local.test")).toBe(true);
    expect(isPhoneTempEmail("+14155552671@PHONE.LOCAL.TEST")).toBe(true);
    expect(isPhoneTempEmail("user@example.com")).toBe(false);
    expect(isPhoneTempEmail("user@notphone.local.test")).toBe(false);
    expect(isPhoneTempEmail(undefined)).toBe(false);
  });
});
