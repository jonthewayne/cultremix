import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

// The blank studio's list of sessions, a session's editable name, and the ⋯ menu on designs.

function ago(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SessionList({ onOpen }: { onOpen: (sessionId: Id<"creativeSessions">) => void }) {
  const [limit, setLimit] = useState(12);
  const query = useQuery(convexQuery(api.studio.sessions, { limit }));
  const [shown, setShown] = useState(query.data);
  // Keep the cards up while "Show more" loads the longer list.
  useEffect(() => {
    if (query.data) setShown(query.data);
  }, [query.data]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!shown) return <p className="text-neutral-500">Loading your sessions…</p>;
  if (shown.sessions.length === 0) {
    return (
      <p className="max-w-lg text-lg text-neutral-500">
        Your sessions show up here. Each one keeps every batch you make in it, so you can come back to a design and see how it got there.
      </p>
    );
  }
  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-wider">Your sessions</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.sessions.map((card) => (
          <button
            key={card.sessionId}
            type="button"
            onClick={() => onOpen(card.sessionId)}
            className="group overflow-hidden rounded-2xl border-2 border-black text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="grid grid-cols-4 gap-px bg-black">
              {Array.from({ length: 4 }, (_, i) => {
                const thumb = card.thumbs[i];
                return (
                  <div
                    key={i}
                    className="flex aspect-square items-center justify-center overflow-hidden p-1"
                    style={{ background: thumb?.backgroundColor ?? "#f5f5f5" }}
                  >
                    {thumb?.url && <Art url={thumb.url} alt="" className="max-h-full max-w-full object-contain" />}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-2.5">
              <p className="truncate font-bold group-hover:underline">{card.name}</p>
              <p className="text-sm text-neutral-500">
                {card.batches >= 100 ? "100+" : card.batches} {card.batches === 1 ? "batch" : "batches"} · {ago(card.updatedAt, now)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {shown.more && (
        <button
          type="button"
          onClick={() => setLimit(limit + 12)}
          disabled={query.isFetching}
          className="mt-6 rounded-xl border-2 border-black px-4 py-2 text-sm font-bold hover:bg-black hover:text-white disabled:opacity-40"
        >
          {query.isFetching ? "Loading…" : "Show more sessions"}
        </button>
      )}
    </div>
  );
}

export function SessionTitle({
  sessionId,
  name,
  batches,
}: {
  sessionId: Id<"creativeSessions">;
  name: string;
  batches: number;
}) {
  const rename = useMutation(api.studio.renameSession);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = async () => {
    setEditing(false);
    const title = draft.trim();
    if (title === name) return;
    try {
      await rename({ sessionId, title });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="min-w-0">
      <p className="text-sm font-bold uppercase tracking-wider">Session</p>
      {editing ? (
        <input
          ref={input}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="mt-1 w-full border-b-2 border-black bg-transparent text-2xl font-black tracking-tight outline-none md:text-3xl"
          aria-label="Session name"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="group mt-1 flex max-w-full items-baseline gap-2 text-left"
          title="Rename this session"
        >
          <span className="truncate text-2xl font-black tracking-tight md:text-3xl">{name}</span>
          <span className="shrink-0 text-sm font-semibold text-neutral-500 underline-offset-4 group-hover:underline">Rename</span>
        </button>
      )}
      <p className="mt-1 text-sm text-neutral-500">
        {batches} {batches === 1 ? "batch" : "batches"}
      </p>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    </div>
  );
}

export type MenuItem =
  | { label: string; onSelect: () => void; href?: undefined }
  | { label: string; href: string; onSelect?: () => void };

// A ⋯ button over a design. Opens a small menu next to it, or a sheet from the bottom on phones.
export function DesignMenu({
  items,
  onOpenChange,
  className,
}: {
  items: Array<MenuItem>;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    changed.current?.(next);
  }, []);
  // The small menu sits below the button (above it near the bottom of the screen) and follows it
  // when the page scrolls; it closes once the button is out of sight.
  const fallbackHeight = items.length * 40 + 12;
  const measure = useCallback(() => {
    if (!button.current) return;
    const rect = button.current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      toggle(false);
      return;
    }
    const width = 220;
    const height = panel.current?.offsetHeight ?? fallbackHeight;
    const below = rect.bottom + 6 + height <= window.innerHeight;
    setPlace({
      top: below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - height),
      left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
    });
  }, [fallbackHeight, toggle]);
  const show = () => {
    const small = window.matchMedia("(max-width: 639px)").matches;
    setSheet(small);
    if (!small) measure();
    toggle(true);
  };
  useEffect(() => {
    if (!open) return;
    // Escape closes just the menu, not the viewer underneath it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      toggle(false);
    };
    window.addEventListener("keydown", onKey, true);
    // The phone sheet closes from its own backdrop, so a tap never lands on what's underneath.
    if (sheet) return () => window.removeEventListener("keydown", onKey, true);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      toggle(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, sheet, measure, toggle]);
  const choose = (item: MenuItem) => {
    toggle(false);
    item.onSelect?.();
  };
  const row = "flex w-full items-center px-4 py-3 text-left text-base font-semibold hover:bg-neutral-100 sm:py-2.5 sm:text-sm";
  const list = items.map((item) =>
    item.href ? (
      <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => choose(item)} className={row} role="menuitem">
        {item.label}
      </a>
    ) : (
      <button key={item.label} type="button" onClick={() => choose(item)} className={row} role="menuitem">
        {item.label}
      </button>
    ),
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) toggle(false);
          else show();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-xl font-black leading-none text-black shadow ring-1 ring-black/20 backdrop-blur transition-transform hover:scale-110",
          className,
        )}
      >
        ⋯
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {sheet ? (
              <motion.div
                key="sheet"
                className="fixed inset-0 z-[60] flex items-end bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) toggle(false);
                }}
              >
                <motion.div
                  ref={panel}
                  role="menu"
                  className="w-full rounded-t-3xl bg-white pb-[max(env(safe-area-inset-bottom),12px)] pt-2 text-black"
                  initial={{ y: 40 }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-neutral-300" />
                  {list}
                  <button type="button" onClick={() => toggle(false)} className={cn(row, "justify-center text-neutral-500")}>
                    Cancel
                  </button>
                </motion.div>
              </motion.div>
            ) : (
              place && (
                <motion.div
                  key="menu"
                  ref={panel}
                  role="menu"
                  className="fixed z-[60] w-[220px] overflow-hidden rounded-2xl border-2 border-black bg-white py-1.5 text-black shadow-xl"
                  style={{ top: place.top, left: place.left }}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  {list}
                </motion.div>
              )
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
