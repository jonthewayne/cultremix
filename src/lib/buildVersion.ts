import type { AnyRouter } from "@tanstack/react-router";

// After a deploy, a tab opened before it still runs the build it loaded: its next page can ask for
// code files the new build doesn't have (the page breaks), and its live queries call functions that
// may have changed. So an open tab notices a new build and moves onto it at the next click, and a
// missing code file loads the page fresh. vite.config.ts sets the build ID to the git commit.
export const BUILD_ID: string = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev";

const RELOAD_KEY = "cr-build-reload";
// One reload a minute at most, so a page that keeps failing for another reason can't loop.
const RELOAD_GAP_MS = 60_000;
const CHECK_EVERY_MS = 5 * 60_000;

// What browsers say when a page asks for a code file that's gone: Chrome, Firefox, Safari, and
// Vite's own CSS preload.
const CHUNK_ERRORS = [
  /dynamically imported module/iu,
  /Importing a module script failed/iu,
  /Unable to preload CSS/iu,
];

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERRORS.some((pattern) => pattern.test(message));
}

export function mayReload(lastReloadAt: number | null, now: number) {
  return lastReloadAt === null || now - lastReloadAt >= RELOAD_GAP_MS;
}

// Loads href (or this page) fresh, unless that already happened in the last minute. Says whether
// it did.
export function reloadOnce(href?: string): boolean {
  try {
    const saved = Number(sessionStorage.getItem(RELOAD_KEY));
    if (!mayReload(Number.isFinite(saved) && saved > 0 ? saved : null, Date.now())) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No session storage (a locked-down browser): reload anyway.
  }
  if (href) window.location.assign(href);
  else window.location.reload();
  return true;
}

// Whether the site now serves a different build than this page's (src/routes/version[.]json.tsx).
export async function newerBuildLive(): Promise<boolean> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return false;
    const { build } = (await response.json()) as { build?: unknown };
    return typeof build === "string" && build !== BUILD_ID;
  } catch {
    return false;
  }
}

let watching = false;

// From src/router.tsx, in the browser: checks for a new build when the tab comes back into view and
// every five minutes; once there is one, the next click to another page loads it fresh. A code file
// that fails to load mid-click loads where the click was going; on a hover's preload it marks the
// tab stale, so the click that follows loads fresh.
export function watchForNewBuild(router: AnyRouter) {
  if (typeof window === "undefined" || watching) return;
  watching = true;
  let stale = false;
  let headedTo: string | null = null;
  const check = async () => {
    if (!stale && (await newerBuildLive())) stale = true;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.setInterval(() => void check(), CHECK_EVERY_MS);
  router.subscribe("onBeforeNavigate", (event) => {
    headedTo = event.toLocation.href;
    if (stale && event.pathChanged) reloadOnce(event.toLocation.href);
  });
  router.subscribe("onResolved", () => {
    headedTo = null;
  });
  window.addEventListener("vite:preloadError", () => {
    stale = true;
    if (headedTo) reloadOnce(headedTo);
  });
}
