import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { PaginationStatus } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { MenuItem } from "~/components/studio/StudioSessions";
import type { Spot } from "~/components/studio/useViewerRoute";
import type { NavDesign, Scope } from "~/lib/viewerNav";
import type { Tile } from "~/components/studio/design";
import { Art } from "~/components/cr/Art";
import { COMPARE_MIN } from "~/lib/compare";
import { designItems } from "~/components/studio/design";
import { DesignMenu } from "~/components/studio/StudioSessions";
import { inkOn } from "~/lib/imagePrep";
import { preloadImage } from "~/lib/imagePreload";
import { isTouchDevice, prefetchImage } from "~/lib/saveImage";
import { cn } from "~/lib/utils";
import {
  SCOPES,
  SCOPE_LABELS,
  afterLeaving,
  leavesScope,
  nextId,
  position,
  preloadIds,
  previousId,
  scopeIds,
  sessionDesigns,
  switchTarget,
  viewerShortcut,
} from "~/lib/viewerNav";
import { useReturnFocus } from "~/hooks/use-return-focus";

// The large viewer: one design at a time over its own background color, paging through the
// session's favorites, its batch, or the whole session. Arrows, keys, and swipes move; the
// neighbors are loaded ahead so the next design is already drawn when it arrives.

type Batch = FunctionReturnType<typeof api.studio.sessionBatches>["page"][number];

const toNav = (tile: Tile): NavDesign => ({
  id: tile.generationId,
  batchId: tile.batchId,
  favorite: tile.favorite,
  rejected: tile.rejected === true,
});
const finished = (tile: Tile) => tile.status === "succeeded" && Boolean(tile.url);

export function Viewer({
  sessionId,
  spot,
  batches,
  batchesStatus,
  onMoreBatches,
  favorites,
  favoritesStatus,
  onMoreFavorites,
  showRejected,
  onShowRejected,
  onMove,
  onClose,
  onFavorite,
  onReject,
  onBranch,
  onStartFrom,
  onRemixable,
  onStyle,
  onPublish,
  picks,
  onPick,
  onCompare,
}: {
  sessionId: string;
  spot: Spot;
  batches: Array<Batch>;
  batchesStatus: PaginationStatus;
  onMoreBatches: () => void;
  favorites: Array<Tile>;
  favoritesStatus: PaginationStatus;
  onMoreFavorites: () => void;
  showRejected: boolean;
  onShowRejected: (show: boolean) => void;
  onMove: (spot: Spot) => void;
  onClose: () => void;
  onFavorite: (tile: Tile, favorite: boolean) => void;
  onReject: (tile: Tile, rejected: boolean) => void;
  // Adds the design to the studio's images.
  onBranch: (tile: Tile) => void;
  // Starts a fresh prompt in this session with the design as image 1 (B).
  onStartFrom: (tile: Tile) => void;
  // "Make it remixable" for the design.
  onRemixable: (tile: Tile) => void;
  onStyle: (tile: Tile) => void;
  // Missing while publishing is switched off.
  onPublish?: (tile: Tile) => void;
  // Designs picked for Compare; C or "+ Compare" picks this one.
  picks: Array<string>;
  onPick: (tile: Tile) => void;
  onCompare: () => void;
}) {
  const id = spot.view;
  const loadedBatch = batches.find((batch) => batch.tiles.some((tile) => tile.generationId === id));
  const loadedTile =
    loadedBatch?.tiles.find((tile) => tile.generationId === id) ?? favorites.find((tile) => tile.generationId === id);
  // A link to a design whose batch hasn't paged in yet: fetch just that batch.
  const needBatch = !loadedTile || (spot.scope === "batch" && !loadedBatch);
  const linked = useQuery(convexQuery(api.studio.designBatch, needBatch ? { sessionId, generationId: id } : "skip")).data;
  const batch: Batch | null | undefined = loadedBatch ?? (needBatch ? linked : undefined);

  const tiles = useMemo(() => {
    const map = new Map<string, Tile>();
    for (const tile of linked?.tiles ?? []) map.set(tile.generationId, tile);
    for (const tile of favorites) map.set(tile.generationId, tile);
    for (const b of batches) for (const tile of b.tiles) map.set(tile.generationId, tile);
    return map;
  }, [batches, favorites, linked]);
  const tile = tiles.get(id);

  const sources = useMemo(
    () => ({
      favorites: favorites.filter(finished).map(toNav),
      batch: batch ? sessionDesigns([batch]) : [],
      session: sessionDesigns(batches),
    }),
    [favorites, batch, batches],
  );
  const idsFor = (scope: Scope) => {
    const ids = scopeIds(scope, sources, showRejected);
    if (ids.includes(id) || scope === "favorites") return ids;
    // A dismissed design opened directly stays in view, in its place, until the member moves on.
    const hidden = new Set(sources[scope].filter((design) => design.rejected && design.id !== id).map((design) => design.id));
    return scopeIds(scope, sources, true).filter((other) => !hidden.has(other));
  };
  const ids = idsFor(spot.scope);
  const idsKey = ids.join(",");
  const { index, total } = position(ids, id);
  const scopeStatus = spot.scope === "favorites" ? favoritesStatus : spot.scope === "session" ? batchesStatus : "Exhausted";
  const loadMoreScope = spot.scope === "favorites" ? onMoreFavorites : onMoreBatches;
  const more = scopeStatus === "CanLoadMore" || scopeStatus === "LoadingMore";

  // Page in more of the scope near its end, or until the design from a link turns up.
  useEffect(() => {
    if (scopeStatus !== "CanLoadMore") return;
    if (index === 0 || index > total - 3) loadMoreScope();
  }, [scopeStatus, index, total, loadMoreScope]);

  // Load the neighbors ahead: the medium copies two each side, then the originals one each side.
  useEffect(() => {
    const ordered = idsKey ? idsKey.split(",") : [];
    preloadImage(tiles.get(id)?.url);
    for (const near of preloadIds(ordered, id, 2)) {
      const neighbor = tiles.get(near);
      preloadImage(neighbor?.mediumUrl ?? neighbor?.url);
    }
    for (const near of preloadIds(ordered, id, 1)) preloadImage(tiles.get(near)?.url);
  }, [idsKey, id, tiles]);
  // Phones only share a file during the tap, so have the original ready for Save image.
  useEffect(() => {
    if (isTouchDevice()) prefetchImage(tile?.url);
  }, [tile?.url]);

  const [checker, setChecker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which way the last move went, so the next design slides in from that side.
  const [direction, setDirection] = useState(0);

  const go = (target: string | null, scope: Scope = spot.scope) => {
    if (!target) return;
    const from = ids.indexOf(id);
    const to = ids.indexOf(target);
    setDirection(scope === spot.scope && from >= 0 && to >= 0 ? Math.sign(to - from) : 0);
    onMove({ view: target, scope });
  };
  const next = nextId(ids, id);
  const previous = previousId(ids, id);
  // When the current design is about to leave the list, land on its neighbor (or close).
  const leave = () => {
    const target = afterLeaving(ids, id);
    if (target) go(target);
    else onClose();
  };
  const favorite = () => {
    if (!tile || !finished(tile)) return;
    const on = !tile.favorite;
    if (!on && leavesScope(spot.scope, "unfavorite", showRejected)) leave();
    onFavorite(tile, on);
  };
  const reject = () => {
    if (!tile) return;
    const rejected = !tile.rejected;
    if (rejected && leavesScope(spot.scope, "reject", showRejected)) leave();
    onReject(tile, rejected);
  };
  const switchScope = (scope: Scope) => {
    if (scope === spot.scope) return;
    const target = switchTarget(idsFor(scope), id);
    if (target) go(target, scope);
  };

  // Keys: arrows, Escape, and F X B P T. The latest handlers are read through a ref.
  const pick = () => tile && finished(tile) && onPick(tile);
  const handlers = useRef({
    next: () => {},
    previous: () => {},
    close: onClose,
    favorite,
    reject,
    branch: () => {},
    publish: () => {},
    transparency: () => {},
    compare: () => {},
  });
  handlers.current = {
    next: () => go(next),
    previous: () => go(previous),
    close: onClose,
    favorite,
    reject,
    branch: () => tile?.key && onStartFrom(tile),
    publish: () => tile && !tile.publishedCr && !tile.keptId && onPublish?.(tile),
    transparency: () => setChecker((on) => !on),
    compare: pick,
  };
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (menuOpenRef.current || event.defaultPrevented) return;
      const action = viewerShortcut(event);
      if (!action) return;
      event.preventDefault();
      handlers.current[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The page underneath stays put while the viewer is open.
  const dialog = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const background = tile?.backgroundColor ?? "#ffffff";
  const ink = checker ? "#000000" : inkOn(background);
  const surface = checker ? "#ffffff" : background;
  const filled = { background: ink, color: surface };
  const button = "flex h-11 items-center justify-center rounded-xl px-3 text-sm font-bold transition-transform active:scale-95";
  const outlined = cn(button, "border-2 border-current");

  const menu: Array<MenuItem> = tile
    ? [
        { label: checker ? "Show the background color" : "Show transparency", onSelect: () => setChecker(!checker) },
        { label: showRejected ? "Hide dismissed" : "Show dismissed", onSelect: () => onShowRejected(!showRejected) },
        ...designItems(tile, {
          onPublish: onPublish ? () => onPublish(tile) : undefined,
          onStartFrom: () => onStartFrom(tile),
          onRemixable: () => onRemixable(tile),
          onInspire: () => onBranch(tile),
          onStyle: () => onStyle(tile),
        }).filter((item) => item.label !== "Publish"),
      ]
    : [];

  const heart = tile && (
    <button
      type="button"
      onClick={favorite}
      className={cn(button, "text-3xl leading-none")}
      aria-label={tile.favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={tile.favorite}
    >
      {tile.favorite ? "♥" : "♡"}
    </button>
  );
  const dismiss = tile && (
    <button type="button" onClick={reject} className={outlined}>
      {tile.rejected ? "Bring back" : "Dismiss"}
    </button>
  );
  const publish =
    tile &&
    (tile.publishedCr ? (
      <Link to="/cr/$cr" params={{ cr: tile.publishedCr }} className={cn(button, "font-cr")} style={filled}>
        CR {tile.publishedCr}
      </Link>
    ) : tile.keptId ? (
      <Link to="/keep/$workId" params={{ workId: tile.keptId }} className={button} style={filled}>
        Kept
      </Link>
    ) : onPublish ? (
      <button type="button" onClick={() => onPublish(tile)} className={button} style={filled}>
        Publish
      </button>
    ) : null);
  const more_ = tile && <DesignMenu items={menu} onOpenChange={setMenuOpen} />;
  const picked = picks.includes(id);
  const compare = tile && finished(tile) && (
    <div className="flex items-center gap-2">
      <button type="button" onClick={pick} aria-pressed={picked} className={cn(outlined, "h-9 md:h-11")}>
        {picked ? "✓ Compare" : "+ Compare"}
      </button>
      {picks.length >= COMPARE_MIN && (
        <button type="button" onClick={onCompare} className={cn(button, "h-9 md:h-11")} style={filled}>
          Compare {picks.length}
        </button>
      )}
    </div>
  );
  const scopes = (
    <div role="tablist" aria-label="Page through" className="flex rounded-xl border-2 border-current p-0.5 text-sm font-bold">
      {SCOPES.map((scope) => {
        const active = scope === spot.scope;
        const empty = scope === "favorites" && sources.favorites.every((design) => design.rejected || !design.favorite);
        return (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={empty && !active}
            onClick={() => switchScope(scope)}
            className="h-9 flex-1 whitespace-nowrap rounded-lg px-3 transition-colors disabled:opacity-40"
            style={active ? filled : undefined}
          >
            {SCOPE_LABELS[scope]}
          </button>
        );
      })}
    </div>
  );

  return (
    <m.div
      ref={dialog}
      tabIndex={-1}
      className={cn("fixed inset-0 z-50 flex flex-col outline-none", checker && "checker")}
      style={checker ? { color: ink } : { background, color: ink }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      role="dialog"
      aria-modal="true"
      aria-label="Design viewer"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)] md:px-8 md:pt-4">
        <span className="font-cr text-3xl tabular-nums md:text-4xl" aria-live="polite">
          {index > 0 ? index : "–"} / {total}
          {more ? "+" : ""}
        </span>
        {tile?.rejected && <span className="rounded-lg border-2 border-current px-2 py-0.5 text-xs font-bold uppercase tracking-wider">Dismissed</span>}
        <div className="hidden md:block">{scopes}</div>
        <div className="ml-auto md:hidden">{compare}</div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {compare}
          {heart}
          {dismiss}
          {tile?.key && (
            <button type="button" onClick={() => onStartFrom(tile)} className={outlined}>
              Start from this
            </button>
          )}
          {publish}
          {more_}
          <button type="button" onClick={onClose} className={cn(button, "underline underline-offset-4")}>
            Close
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 md:px-20">
        {tile && finished(tile) ? (
          <m.div
            key={id}
            className="flex h-full w-full touch-none items-center justify-center"
            initial={{ x: direction * 48 }}
            animate={{ x: 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            drag
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.5}
            onDragEnd={(_, info) => {
              const { offset, velocity } = info;
              if (Math.abs(offset.y) > Math.abs(offset.x)) {
                if (offset.y > 110 || velocity.y > 600) onClose();
                return;
              }
              if (offset.x < -60 || velocity.x < -500) go(next);
              else if (offset.x > 60 || velocity.x > 500) go(previous);
            }}
          >
            <Art
              instant
              url={tile.mediumUrl ?? tile.url}
              fullUrl={tile.url}
              alt="Design"
              className={cn(
                "pointer-events-none h-full max-h-full w-auto max-w-full select-none object-contain",
                tile.rejected && "opacity-40",
              )}
            />
          </m.div>
        ) : needBatch && linked === null ? (
          <div className="text-center">
            <p className="text-2xl font-black">This design isn’t here.</p>
            <button type="button" onClick={onClose} className={cn(outlined, "mx-auto mt-4")}>
              Back to the studio
            </button>
          </div>
        ) : (
          <m.span
            className="h-3 w-3"
            style={{ background: ink }}
            animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        )}
        <button
          type="button"
          onClick={() => go(previous)}
          disabled={!previous}
          className="absolute left-1 top-1/2 hidden -translate-y-1/2 p-3 text-5xl font-black transition-opacity disabled:opacity-0 md:left-6 md:block"
          aria-label="Previous"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => go(next)}
          disabled={!next}
          className="absolute right-1 top-1/2 hidden -translate-y-1/2 p-3 text-5xl font-black transition-opacity disabled:opacity-0 md:right-6 md:block"
          aria-label="Next"
        >
          →
        </button>
      </div>

      <p className="hidden pb-4 pt-2 text-center text-xs font-medium md:block [@media(pointer:coarse)]:hidden">
        ← → move · F favorite · X dismiss · C compare · B start from this · P publish · T transparency · Esc close
      </p>

      {/* Phones: everything at the bottom, in reach of a thumb. Swipe sideways to move, down to close. */}
      <div className="flex flex-col gap-2 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 md:hidden">
        {scopes}
        <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-2">
          {heart}
          {dismiss}
          {publish}
          <div className="flex h-11 w-11 items-center justify-center">{more_}</div>
          <button type="button" onClick={onClose} className={cn(button, "underline underline-offset-4")}>
            Close
          </button>
        </div>
      </div>
    </m.div>
  );
}
