import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Scope } from "~/lib/viewerNav";
import { parseScope } from "~/lib/viewerNav";

// Where the viewer is: open on a design, paging through a scope. It lives in the URL
// (?view=<design>&scope=<scope>) so a reload or a shared link opens the same design, but paging
// moves local state first and writes the URL a moment later: every router navigation checks the
// sign-in with the server, and paging shouldn't wait on that.

export type Spot = { view: string; scope: Scope };

const WRITE_DELAY = 250;

const spotOf = (view: string | undefined, scope: string | undefined): Spot | null =>
  view ? { view, scope: parseScope(scope) ?? "session" } : null;

// Router search values are plain strings, or JSON-quoted when they'd otherwise read as JSON.
export function searchValue(params: URLSearchParams, name: string): string | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function useViewerRoute(search: { s?: string; view?: string; scope?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const [spot, setSpot] = useState<Spot | null>(() => spotOf(search.view, search.scope));
  // Whether this page pushed the history entry the viewer is on (so closing can step back).
  const pushed = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Another session (or a blank studio) starts from what its URL says.
  const initial = useRef({ view: search.view, scope: search.scope });
  initial.current = { view: search.view, scope: search.scope };
  useEffect(() => {
    window.clearTimeout(timer.current);
    pushed.current = false;
    setSpot(spotOf(initial.current.view, initial.current.scope));
  }, [search.s]);

  // Back and forward move the viewer too; our own pushes and replaces are already in state.
  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE") return;
        window.clearTimeout(timer.current);
        pushed.current = false;
        const params = new URLSearchParams(location.search);
        setSpot(spotOf(searchValue(params, "view"), searchValue(params, "scope")));
      }),
    [router],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const write = useCallback(
    (next: Spot | null, replace: boolean) =>
      void navigate({
        to: "/studio",
        search: (prev) => ({ ...prev, view: next?.view, scope: next?.scope }),
        replace,
        resetScroll: false,
      }),
    [navigate],
  );

  const open = useCallback(
    (next: Spot) => {
      window.clearTimeout(timer.current);
      setSpot(next);
      pushed.current = true;
      write(next, false);
    },
    [write],
  );
  const move = useCallback(
    (next: Spot) => {
      setSpot(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => write(next, true), WRITE_DELAY);
    },
    [write],
  );
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setSpot(null);
    if (pushed.current) {
      pushed.current = false;
      router.history.back();
    } else {
      write(null, true);
    }
  }, [router, write]);

  // Put the viewer away without touching the address: the next navigation (Compare opening)
  // writes it, and Back returns to this design.
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    pushed.current = false;
    setSpot(null);
  }, []);

  return { spot, open, move, close, hide };
}
