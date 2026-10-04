import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Size } from "~/lib/compare";
import type { Tile } from "~/components/studio/design";
import { Art } from "~/components/cr/Art";
import { clampPair, pairHolding, phonePairs, sharedScale } from "~/lib/compare";
import { isTouchDevice } from "~/lib/saveImage";
import { cn } from "~/lib/utils";
import { viewerShortcut } from "~/lib/viewerNav";

// Two to four designs side by side, each over its own background color and all drawn at the same
// scale, so a bigger design looks bigger. Phones show two at a time, stacked, and swipe between
// pairs. Each one opens in the viewer or comes out of the comparison.

const WIDE = "(min-width: 768px)";
// Room left around the largest design in its panel.
const MARGIN = 24;

// The original's size: from the server, or read from the image when an older design lacks it.
function useSizes(tiles: Array<Tile>): Array<Size | undefined> {
  const [read, setRead] = useState<Record<string, Size>>({});
  const missing = tiles.filter((tile) => !(tile.width && tile.height) && tile.url && !read[tile.generationId]);
  const missingKey = missing.map((tile) => `${tile.generationId} ${tile.url}`).join("|");
  useEffect(() => {
    let live = true;
    for (const tile of missing) {
      const { generationId, url } = tile;
      if (!url) continue;
      // The dev stand-in is drawn at 1024×1536.
      if (url.startsWith("fake:")) {
        setRead((sizes) => ({ ...sizes, [generationId]: { width: 1024, height: 1536 } }));
        continue;
      }
      const image = new Image();
      image.onload = () => {
        if (live) setRead((sizes) => ({ ...sizes, [generationId]: { width: image.naturalWidth, height: image.naturalHeight } }));
      };
      image.src = url;
    }
    return () => {
      live = false;
    };
    // missingKey stands for the list.
  }, [missingKey]);
  return tiles.map((tile) =>
    tile.width && tile.height ? { width: tile.width, height: tile.height } : read[tile.generationId],
  );
}

// The size of a panel on screen (they're all the same size; the ones off this pair measure 0).
function usePanelBox() {
  const panels = useRef(new Set<HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const measure = useCallback(() => {
    for (const panel of panels.current) {
      if (panel.clientWidth > 0 && panel.clientHeight > 0) {
        const next = { width: panel.clientWidth - MARGIN * 2, height: panel.clientHeight - MARGIN * 2 };
        setBox((before) => (before.width === next.width && before.height === next.height ? before : next));
        return;
      }
    }
  }, []);
  useEffect(() => {
    observer.current = new ResizeObserver(measure);
    for (const panel of panels.current) observer.current.observe(panel);
    return () => observer.current?.disconnect();
  }, [measure]);
  const panelRef = useCallback(
    (panel: HTMLElement | null) => {
      if (!panel) return;
      panels.current.add(panel);
      observer.current?.observe(panel);
      measure();
      return () => {
        panels.current.delete(panel);
        observer.current?.unobserve(panel);
      };
    },
    [measure],
  );
  return { box, panelRef };
}

export function Compare({
  tiles,
  missing,
  active,
  onRemove,
  onOpen,
  onClose,
}: {
  // The designs found, in order.
  tiles: Array<Tile>;
  // Whether some asked for aren't here (another session's, or gone).
  missing: boolean;
  // False while the viewer is open over it (its keys belong to the viewer then).
  active: boolean;
  onRemove: (tile: Tile) => void;
  onOpen: (tile: Tile) => void;
  onClose: () => void;
}) {
  const [checker, setChecker] = useState(false);
  const [pair, setPair] = useState(0);
  const [direction, setDirection] = useState(0);
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(isTouchDevice()), []);

  const pairs = phonePairs(tiles.length);
  const current = clampPair(pair, tiles.length);
  const inPair = new Set(pairs[current] ?? []);
  const sizes = useSizes(tiles);
  const { box, panelRef } = usePanelBox();
  const scale = sharedScale(sizes, box);

  const goPair = (to: number) => {
    if (to < 0 || to >= pairs.length || to === current) return;
    setDirection(Math.sign(to - current));
    setPair(to);
  };
  const remove = (tile: Tile, index: number) => {
    // Stay on the pair the removed design's neighbor moves into.
    setDirection(0);
    setPair(pairHolding(tiles.length - 1, Math.min(index, tiles.length - 2)));
    onRemove(tile);
  };

  const handlers = useRef({ next: () => {}, previous: () => {}, close: onClose, transparency: () => {} });
  handlers.current = {
    next: () => goPair(current + 1),
    previous: () => goPair(current - 1),
    close: onClose,
    transparency: () => setChecker((on) => !on),
  };
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!activeRef.current || event.defaultPrevented) return;
      const action = viewerShortcut(event);
      if (action === "close" || action === "transparency") {
        event.preventDefault();
        handlers.current[action]();
      } else if ((action === "next" || action === "previous") && !window.matchMedia(WIDE).matches) {
        // Wide screens show every design at once; arrows step through pairs on narrow ones.
        event.preventDefault();
        handlers.current[action]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const button = "flex h-11 items-center justify-center rounded-xl px-3 text-sm font-bold transition-transform active:scale-95";
  const outlined = cn(button, "border-2 border-current");
  const canRemove = tiles.length > 2;

  return (
    <motion.div
      ref={dialog}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      role="dialog"
      aria-modal="true"
      aria-label="Compare designs"
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)] md:px-8 md:pt-4">
        <h2 className="text-3xl font-black leading-none tracking-tight md:text-4xl">Compare</h2>
        <span className="font-cr text-2xl tabular-nums text-muted-foreground md:text-3xl">{tiles.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setChecker(!checker)} aria-pressed={checker} className={cn(outlined, checker && "bg-foreground text-background")}>
            Transparency
          </button>
          <button type="button" onClick={onClose} className={cn(button, "underline underline-offset-4")}>
            Close
          </button>
        </div>
      </div>
      {missing && (
        <p className="px-4 text-sm font-semibold text-muted-foreground md:px-8">
          {tiles.length === 0 ? "These designs aren’t here anymore." : "Some of these designs aren’t here anymore."}
        </p>
      )}

      <motion.div
        key={current}
        className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-2 pt-2 md:flex-row md:gap-4 md:px-8 md:pb-4"
        initial={{ x: direction * 48, opacity: direction ? 0.6 : 1 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        drag={touch && pairs.length > 1 ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -500) goPair(current + 1);
          else if (info.offset.x > 60 || info.velocity.x > 500) goPair(current - 1);
        }}
      >
        {tiles.map((tile, i) => {
          const size = sizes[i];
          const drawn = size && scale > 0 ? { width: size.width * scale, height: size.height * scale } : undefined;
          return (
            <section
              key={tile.generationId}
              aria-label={`Design ${i + 1}`}
              className={cn("min-h-0 min-w-0 flex-1 flex-col gap-2", inPair.has(i) ? "flex" : "hidden md:flex")}
            >
              <div
                ref={panelRef}
                className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl", checker && "checker")}
                style={checker ? undefined : { background: tile.backgroundColor }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(tile)}
                  className={cn("flex items-center justify-center", !drawn && "h-full w-full p-6")}
                  style={drawn}
                  aria-label={`Open design ${i + 1} in the viewer`}
                >
                  <Art
                    instant
                    url={tile.mediumUrl ?? tile.url}
                    fullUrl={tile.url}
                    alt={`Design ${i + 1}`}
                    className={cn("pointer-events-none h-full w-full select-none object-contain", tile.rejected && "opacity-40")}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-cr text-2xl leading-none tabular-nums">{i + 1}</span>
                {tile.favorite && (
                  <span className="text-xl leading-none" aria-label="Favorite">
                    ♥
                  </span>
                )}
                {tile.publishedCr && <span className="font-cr text-lg leading-none">CR {tile.publishedCr}</span>}
                {tile.rejected && <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Dismissed</span>}
                <div className="ml-auto flex items-center gap-2">
                  {canRemove && (
                    <button type="button" onClick={() => remove(tile, i)} className={cn(button, "h-9 underline underline-offset-4")}>
                      Remove
                    </button>
                  )}
                  <button type="button" onClick={() => onOpen(tile)} className={cn(outlined, "h-9")}>
                    Open
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </motion.div>

      <p className="hidden pb-4 text-center text-xs font-semibold text-muted-foreground md:block [@media(pointer:coarse)]:hidden">
        Same scale, each on its own background · T transparency · Esc close
      </p>

      {/* Phones: two at a time. Swipe or tap the arrows for the next pair. */}
      {pairs.length > 1 && (
        <div className="flex items-center justify-center gap-6 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-1 md:hidden">
          <button
            type="button"
            onClick={() => goPair(current - 1)}
            disabled={current === 0}
            className="p-2 text-3xl font-black transition-opacity disabled:opacity-20"
            aria-label="Previous pair"
          >
            ←
          </button>
          <span className="font-cr text-xl tabular-nums" aria-live="polite">
            {(pairs[current] ?? [0, 1]).map((index) => index + 1).join("+")} / {tiles.length}
          </span>
          <button
            type="button"
            onClick={() => goPair(current + 1)}
            disabled={current === pairs.length - 1}
            className="p-2 text-3xl font-black transition-opacity disabled:opacity-20"
            aria-label="Next pair"
          >
            →
          </button>
        </div>
      )}
    </motion.div>
  );
}
