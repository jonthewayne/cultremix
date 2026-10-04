import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchValue } from "~/components/studio/useViewerRoute";
import { canCompare, compareParam, parseCompare } from "~/lib/compare";

// Which designs Compare shows. Like the viewer, it lives in the URL (?compare=<id>,<id>,…) so a
// link reopens it, and local state leads: opening pushes a history entry, removing one replaces
// it, Back/Forward follow, and Close steps back. The viewer can open on top of it.

export function useCompareRoute(search: { s?: string; compare?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const [ids, setIds] = useState<Array<string>>(() => parseCompare(search.compare));
  const pushed = useRef(false);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const initial = useRef(search.compare);
  initial.current = search.compare;
  useEffect(() => {
    pushed.current = false;
    setIds(parseCompare(initial.current));
  }, [search.s]);

  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE") return;
        const next = parseCompare(searchValue(new URLSearchParams(location.search), "compare"));
        // Back from the viewer opened over Compare lands on the same Compare: it can still step back.
        if (next.join(",") !== idsRef.current.join(",")) pushed.current = false;
        setIds(next);
      }),
    [router],
  );

  const write = useCallback(
    (next: Array<string>, replace: boolean) =>
      void navigate({
        to: "/studio",
        // Compare takes the viewer's place; Back from Compare returns to it.
        search: (prev) => ({ ...prev, compare: compareParam(next), view: undefined, scope: undefined }),
        replace,
        resetScroll: false,
      }),
    [navigate],
  );

  const open = useCallback(
    (next: Array<string>) => {
      if (!canCompare(next)) return;
      setIds(next);
      pushed.current = true;
      write(next, false);
    },
    [write],
  );
  const close = useCallback(() => {
    setIds([]);
    if (pushed.current) {
      pushed.current = false;
      router.history.back();
    } else {
      write([], true);
    }
  }, [router, write]);
  // Close Compare (and the viewer over it) in place, for leaving both for the studio itself.
  const dismiss = useCallback(() => {
    setIds([]);
    pushed.current = false;
    write([], true);
  }, [write]);
  const remove = useCallback(
    (id: string) => {
      const next = ids.filter((other) => other !== id);
      if (!canCompare(next)) return close();
      setIds(next);
      write(next, true);
    },
    [ids, close, write],
  );

  return { ids: canCompare(ids) ? ids : null, open, remove, close, dismiss };
}
