// Username rules shared by the onboarding form and `identity.completeOnboarding`.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/u;

const RESERVED = new Set([
  "admin",
  "api",
  "auth",
  "cr",
  "cultremix",
  "health",
  "help",
  "login",
  "onboarding",
  "root",
  "settings",
  "shop",
  "studio",
  "support",
  "system",
]);

export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; message: string };

export function validateUsername(raw: string): UsernameCheck {
  const username = raw.trim().replace(/^@/u, "");
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, message: "Use 3 to 20 letters, numbers, or underscores." };
  }
  if (RESERVED.has(username.toLowerCase())) {
    return { ok: false, message: "That name is reserved. Try another." };
  }
  return { ok: true, username };
}
