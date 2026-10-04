import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { PaginationStatus } from "convex/react";
import type { Tile } from "~/components/studio/design";
import { Art } from "~/components/cr/Art";
import { LoadMore } from "~/components/studio/LoadMore";

// The session's favorites along the bottom of the screen, in the order they were hearted. Always
// in reach while the session is open; a tap opens the viewer on the favorites.

export function FavoritesTray({
  favorites,
  status,
  onMore,
  onOpen,
}: {
  favorites: Array<Tile>;
  status: PaginationStatus;
  onMore: () => void;
  onOpen: (tile: Tile) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const count = useRef(favorites.length);
  // A new heart lands at the end of the tray: bring it into view.
  useEffect(() => {
    const grew = favorites.length > count.current;
    count.current = favorites.length;
    if (grew && status !== "LoadingMore") strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: "smooth" });
  }, [favorites.length, status]);

  const more = status === "CanLoadMore" || status === "LoadingMore";
  return (
    <motion.aside
      aria-label="Favorites"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-foreground bg-background/95 pb-[env(safe-area-inset-bottom)] text-foreground backdrop-blur"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="flex items-center gap-3 py-2 pl-4 md:pl-10">
        <button
          type="button"
          onClick={() => favorites[0] && onOpen(favorites[0])}
          className="flex shrink-0 flex-col items-start leading-none"
          aria-label="View favorites"
        >
          <span className="text-2xl font-black">♥ {favorites.length}{more ? "+" : ""}</span>
          <span className="mt-1 hidden text-xs font-bold uppercase tracking-wider text-muted-foreground sm:block">Favorites</span>
        </button>
        <div ref={strip} className="flex min-w-0 flex-1 snap-x items-center gap-2 overflow-x-auto overscroll-x-contain py-1 pr-4 [scrollbar-width:none] md:pr-10">
          <AnimatePresence initial={false}>
            {favorites.map((tile) => (
              <motion.button
                key={tile.generationId}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.2 }}
                onClick={() => onOpen(tile)}
                className="flex h-14 w-14 shrink-0 snap-start items-center justify-center overflow-hidden rounded-xl p-1 ring-foreground transition-shadow hover:ring-2 md:h-16 md:w-16"
                style={{ background: tile.backgroundColor }}
                aria-label="View this favorite"
              >
                <Art url={tile.thumbUrl ?? tile.mediumUrl ?? tile.url} alt="Favorite design" className="max-h-full max-w-full object-contain" />
              </motion.button>
            ))}
          </AnimatePresence>
          <LoadMore status={status} onMore={onMore} label="More" className="shrink-0" />
        </div>
      </div>
    </motion.aside>
  );
}
