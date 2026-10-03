import { useEffect, useRef } from "react";
import type { PagedStatus } from "~/hooks/use-paged-query";
import { cn } from "~/lib/utils";

// Loads the next page as the list's end scrolls near; the button is there for when it doesn't.
export function LoadMore({
  status,
  loadMore,
  className,
}: {
  status: PagedStatus;
  loadMore: () => void;
  className?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || status !== "CanLoadMore" || typeof IntersectionObserver === "undefined") return;
    // Observing fires once straight away, so a short page that leaves the end in view keeps going.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [status, loadMore]);

  if (status === "Exhausted" || status === "LoadingFirstPage") return null;
  return (
    <div ref={sentinel} className={cn("flex justify-center", className)}>
      <button
        type="button"
        onClick={loadMore}
        disabled={status !== "CanLoadMore"}
        className="h-12 rounded-2xl border-2 border-black px-7 font-black transition-colors hover:bg-black hover:text-white disabled:border-neutral-300 disabled:text-neutral-400 disabled:hover:bg-transparent"
      >
        {status === "LoadingMore" ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
