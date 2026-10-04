// Password sign-in exists only for accounts an admin provisions (judges; KTD-15).
// Nobody can create a password account or reset one through the auth endpoints:
// `disableSignUp` refuses `/sign-up/email`, and the paths below answer 404.
// Email codes, magic links, and phone codes use their own plugins and are untouched.

export const PASSWORD_MIN_LENGTH = 12;

export const emailAndPasswordOptions = {
  enabled: true,
  disableSignUp: true,
  minPasswordLength: PASSWORD_MIN_LENGTH,
  maxPasswordLength: 128,
} as const;

export const PASSWORD_DISABLED_PATHS = [
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/change-password",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
  "/phone-number/request-password-reset",
  "/phone-number/reset-password",
] as const;

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// Four groups of five, e.g. "kq7mz-3hxpa-w9ret-n2c8d": about 99 bits, easy to read aloud.
export function generateJudgePassword(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
  return [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join("")).join("-");
}
