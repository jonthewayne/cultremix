import { useEffect, useRef, useState } from "react";
import type { PaginationStatus } from "convex/react";
import { cn } from "~/lib/utils";

// Every list in the studio pages the same way: Convex's usePaginatedQuery, the next page loading
// as the end of the list scrolls near, and a Load more button for when that doesn't fire.

export const PAGE = { sessions: 12, batches: 6, images: 24, favorites: 48 } as const;

export function LoadMore({
  status,
  onMore,
  label = "Load more",
  className,
}: {
  status: PaginationStatus;
  onMore: () => void;
  label?: string;
  className?: string;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const more = useRef(onMore);
  more.current = onMore;
  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    // The viewport, clipped by any scrolling dialog the list sits in.
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  // Also runs when a page arrives with the end still in sight (a short or filtered page).
  useEffect(() => {
    if (near && status === "CanLoadMore") more.current();
  }, [near, status]);
  if (status === "Exhausted" || status === "LoadingFirstPage") return null;
  return (
    <div ref={setNode} className={cn("flex justify-center", className)}>
      <button
        type="button"
        onClick={onMore}
        disabled={status === "LoadingMore"}
        className="rounded-xl border-2 border-black px-4 py-2 text-sm font-bold transition-colors hover:bg-black hover:text-white disabled:opacity-40"
      >
        {status === "LoadingMore" ? "Loading…" : label}
      </button>
    </div>
  );
}

// A soft grey block standing in for something still loading.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-2xl bg-neutral-100", className)} />;
}
