// Email rules for the early-access list (convex/waitlist.ts). Shared with the browser, so nothing
// here may import server code.

export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

export type EmailResult = { ok: true; emailLower: string } | { ok: false; message: string };

export function normalizeWaitlistEmail(raw: string): EmailResult {
  const emailLower = raw.trim().toLowerCase();
  if (!emailLower) return { ok: false, message: "Add your email." };
  if (emailLower.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(emailLower)) {
    return { ok: false, message: "That email doesn’t look right." };
  }
  return { ok: true, emailLower };
}
