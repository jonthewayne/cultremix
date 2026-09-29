import { parsePhoneNumberFromString } from "libphonenumber-js";
import type {CountryCode} from "libphonenumber-js";

export const DEFAULT_PHONE_TEMP_EMAIL_DOMAIN = "phone.local.test";

export function normalizePhone(
  input: string,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!input.trim()) return null;
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function normalizePhoneWithCode(
  countryCode: string,
  phoneNumber: string,
): string | null {
  const code = countryCode.trim().replace(/^\+/, "");
  const number = phoneNumber.trim();
  if (!code || !number) return null;
  const parsed = parsePhoneNumberFromString(`+${code}${number}`);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

export function getPhoneTempEmailDomain(): string {
  return process.env.PHONE_TEMP_EMAIL_DOMAIN ?? DEFAULT_PHONE_TEMP_EMAIL_DOMAIN;
}

export function phoneTempEmail(phone: string): string {
  return `${phone}@${getPhoneTempEmailDomain()}`;
}

export function isPhoneTempEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${getPhoneTempEmailDomain()}`);
}
