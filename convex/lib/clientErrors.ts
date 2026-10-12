// Errors that happen in browsers, as convex/clientErrors.ts keeps them: cleaned so a row says what
// broke and where without anything personal, with noise left out (browser extensions, network blips,
// a harmless ResizeObserver warning). Pure, so the rules are tested without a browser.

export const MESSAGE_MAX = 300;
export const STACK_MAX = 1500;
export const AGENT_MAX = 200;
// A burst worth telling the owner and ops: this many of one error on one page within an hour.
export const BURST_COUNT = 10;
export const BURST_WINDOW_MS = 60 * 60 * 1000;
// How long rows are kept.
export const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const NOISE = [
  /ResizeObserver loop/iu,
  /^Script error\.?$/iu,
  /\b(Failed to fetch|Load failed|NetworkError when attempting to fetch resource|Network request failed)\b/iu,
  /^AbortError\b|signal is aborted/iu,
];
const EXTENSION = /\b(chrome|moz|safari(-web)?)-extension:\/\//iu;

export type RawReport = { message: string; stack?: string; path: string; userAgent?: string };
export type CleanReport = { key: string; message: string; stack?: string; path: string; userAgent?: string };

const squash = (text: string) => text.replace(/\s+/gu, " ").trim();

// A path without its query or hash, with long IDs folded so one error on every kept design is one row:
// "/keep/md77tmn25z13jdzxqd33crnd5x8g31zb?x=1" is "/keep/:id". CR numbers stay, since they're public.
export function cleanPath(path: string) {
  const bare = path.split(/[?#]/u)[0] || "/";
  const segments = bare.split("/").map((segment) => (/^[a-z0-9_-]{20,}$/iu.test(segment) ? ":id" : segment));
  return segments.join("/").slice(0, 200) || "/";
}

// The message as kept: one line, without the request ID Convex adds to each error (it would make
// every occurrence its own row).
export function cleanMessage(message: string) {
  return squash(message.replace(/\[Request ID: [^\]]*\]\s*/gu, "")).slice(0, MESSAGE_MAX);
}

export function cleanReport(raw: RawReport): CleanReport | null {
  const message = cleanMessage(raw.message);
  if (!message || NOISE.some((re) => re.test(message))) return null;
  if (raw.stack && EXTENSION.test(raw.stack)) return null;
  const path = cleanPath(raw.path);
  const stack = raw.stack?.trim().slice(0, STACK_MAX) || undefined;
  const userAgent = raw.userAgent ? squash(raw.userAgent).slice(0, AGENT_MAX) : undefined;
  return { key: (message + "|" + path).slice(0, 520), message, stack, path, userAgent };
}

// One error's count within its current hour: a report an hour or more after the window began starts
// a new one. The BURST_COUNT-th in a window is the burst.
export function nextWindow(window: { start: number; count: number } | undefined, now: number) {
  // The first of a window is never a burst (BURST_COUNT is more than one).
  if (!window || now - window.start >= BURST_WINDOW_MS) return { start: now, count: 1, burst: false };
  const count = window.count + 1;
  return { start: window.start, count, burst: count === BURST_COUNT };
}

// "Safari on iPhone", for Admin.
export function browserName(userAgent: string | undefined) {
  if (!userAgent) return "an unknown browser";
  const ua = userAgent;
  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//u.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//u.test(ua)
        ? "Firefox"
        : /Safari\//u.test(ua)
          ? "Safari"
          : "a browser";
  const device = /iPhone/u.test(ua)
    ? "iPhone"
    : /iPad/u.test(ua)
      ? "iPad"
      : /Android/u.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/u.test(ua)
          ? "Mac"
          : /Windows/u.test(ua)
            ? "Windows"
            : /Linux/u.test(ua)
              ? "Linux"
              : "";
  return device ? browser + " on " + device : browser;
}
