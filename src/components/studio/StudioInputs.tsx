import { usePaginatedQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_IMAGES, MAX_STYLES } from "../../../convex/lib/studioRules";
import { GARMENT_COLORS, nearestGarmentColor } from "../../../convex/lib/garments";
import type { Palette } from "../../../convex/lib/garments";
import { Art } from "~/components/cr/Art";
import { LoadMore, PAGE, Skeleton } from "~/components/studio/LoadMore";
import { useReturnFocus } from "~/hooks/use-return-focus";
import { cn } from "~/lib/utils";

// The studio's inputs: numbered images to work on, and the style mixer with its picker.
// Nothing becomes a style unless the member adds it. What the server knows about an image stays
// there; docs/image-generation/README.md covers both.

export { MAX_IMAGES, MAX_STYLES };

export type Slot = {
  id: string;
  imageId?: Id<"userImages">;
  previewUrl: string;
  uploading: boolean;
};
export type StyleSlot = Slot & { weight: number };
// The server only says whether an image's notes are ready; the notes themselves never leave it.
export type ImageState = {
  analysis: "pending" | "ready" | "failed";
};

// Slider values (0-100) as shares of the mix; two equal values split evenly.
export function shares(weights: Array<number>) {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  return weights.map((w) => (total > 0 && w > 0 ? Math.round((100 * w) / total) : 0));
}

export function listNames(count: number) {
  const names = Array.from({ length: count }, (_, i) => `image ${i + 1}`);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

// The mixer's styles by position, as the request can name them ("style 2").
export function styleNames(count: number) {
  const names = Array.from({ length: count }, (_, i) => `style ${i + 1}`);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
}

function Thumb({ url, className }: { url: string; className?: string }) {
  if (url.startsWith("fake:")) return <Art url={url} alt="" className={className} />;
  return <img src={url} alt="" className={className} draggable={false} />;
}

function Dots() {
  return (
    <span aria-hidden="true" className="inline-flex w-4">
      <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity }}>
        …
      </motion.span>
    </span>
  );
}

// A style mix as small thumbnails with their shares: the mixer's closed bar and each batch.
export function StyleChips({ items, className }: { items: Array<{ url?: string; share: number }>; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-black bg-neutral-100">
            {item.url && <Thumb url={item.url} className="max-h-full max-w-full object-contain" />}
          </span>
          <span className="text-xs font-bold tabular-nums text-black">{item.share > 0 ? `${item.share}%` : "off"}</span>
        </span>
      ))}
    </span>
  );
}

export function ImageTray({
  images,
  states,
  color,
  ink,
  palette = GARMENT_COLORS,
  onColor,
  onFiles,
  onRemove,
}: {
  images: Array<Slot>;
  states: Map<string, ImageState>;
  color: string;
  ink: string;
  // The shirt colors on offer (convex/merch.ts palette).
  palette?: Palette;
  onColor: (color: string) => void;
  onFiles: (files: Array<File>) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const room = MAX_IMAGES - images.length;
  const shirt = nearestGarmentColor(color, palette);
  const onShirt = shirt.hex.toLowerCase() === color.toLowerCase();
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(imageFiles(e.dataTransfer.files));
      }}
      className={cn("flex flex-wrap items-stretch gap-3 rounded-2xl transition-colors", dragging && "bg-neutral-100")}
    >
      {images.map((slot, i) => {
        const state = slot.imageId ? states.get(slot.imageId) : undefined;
        const reading = slot.uploading || state?.analysis === "pending";
        return (
          <div
            key={slot.id}
            className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border-2 border-black p-1.5"
            style={{ background: color }}
          >
            <Thumb url={slot.previewUrl} className="max-h-full max-w-full object-contain" />
            <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-black text-white">
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(slot.id)}
              className="group absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full"
              aria-label={`Remove image ${i + 1}`}
            >
              {/* A 40 px target around the small mark, so it's easy to hit on a phone. */}
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-black text-black ring-1 ring-black group-hover:bg-black group-hover:text-white"
              >
                ×
              </span>
            </button>
            {reading && (
              <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {slot.uploading ? "Uploading" : "Reading"}
                <Dots />
              </span>
            )}
          </div>
        );
      })}
      {room > 0 && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            "flex h-28 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black px-4 text-center transition-colors hover:bg-neutral-50",
            images.length === 0 ? "min-w-0 flex-1" : "w-28",
          )}
        >
          <span className="text-2xl font-black leading-none">+</span>
          <span className="mt-1 text-sm font-bold">{images.length === 0 ? "Add images (optional)" : "Add image"}</span>
          {images.length === 0 && <span className="mt-0.5 text-xs text-neutral-600">Drop or click · up to {MAX_IMAGES}</span>}
        </button>
      )}
      <button
        type="button"
        onClick={() => setColorsOpen(!colorsOpen)}
        aria-expanded={colorsOpen}
        className="flex h-28 w-24 flex-col justify-end rounded-2xl border-2 border-black p-2 text-left"
        style={{ background: color, color: ink }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide">Shirt</span>
        <span className="text-xs font-semibold leading-tight">{onShirt ? shirt.name : color}</span>
      </button>
      {colorsOpen && (
        <div className="basis-full rounded-2xl border-2 border-black p-3">
          <p className="text-sm font-bold">Preview on a shirt color</p>
          <div role="radiogroup" aria-label="Shirt color" className="mt-2 grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6">
            {palette.map((option) => {
              const selected = onShirt && option.key === shirt.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    onColor(option.hex);
                    setColorsOpen(false);
                  }}
                  className="flex flex-col items-center gap-1 text-center text-[11px] font-semibold leading-tight"
                >
                  <span
                    className={cn("h-10 w-10 rounded-full border border-black/30", selected && "ring-2 ring-black ring-offset-2")}
                    style={{ background: option.hex }}
                  />
                  {option.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          onFiles(imageFiles(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function StyleRow({
  slot,
  label,
  position,
  share,
  state,
  onWeight,
  onRemove,
}: {
  slot: StyleSlot;
  label: string;
  position: number;
  share: number;
  state?: ImageState;
  onWeight: (weight: number) => void;
  onRemove: () => void;
}) {
  const analysis = slot.uploading ? undefined : state?.analysis;
  // The last state seen, kept while the status reloads.
  const [known, setKnown] = useState(analysis);
  // "Style captured" shows for a moment when this row's notes arrive while it's on screen
  // (uploading or analyzing, then ready); a style that was already captured goes straight to its
  // slider. The timer lives in its own effect so React's development double-run can't cancel it.
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const previous = useRef<string | undefined>(slot.uploading ? "uploading" : analysis);
  useEffect(() => {
    const observed = slot.uploading ? "uploading" : analysis;
    if (observed === undefined) return;
    const before = previous.current;
    previous.current = observed;
    if (analysis) setKnown(analysis);
    if (observed === "ready" && (before === "pending" || before === "uploading")) setCapturedAt(Date.now());
  }, [analysis, slot.uploading]);
  useEffect(() => {
    if (capturedAt === null) return;
    const timer = window.setTimeout(() => setCapturedAt(null), 1800);
    return () => window.clearTimeout(timer);
  }, [capturedAt]);
  const justCaptured = capturedAt !== null;
  const current = slot.uploading ? undefined : (analysis ?? known);
  const settled = current === "ready" || current === "failed";
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black bg-neutral-100 p-0.5">
        <Thumb url={slot.previewUrl} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          Style {position} <span className="font-normal text-neutral-500">· {label}</span>
        </p>
        <AnimatePresence mode="wait" initial={false}>
          {!settled || justCaptured ? (
            <motion.p
              key={justCaptured ? "captured" : "working"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm text-neutral-600"
            >
              {justCaptured ? "Style captured ✓" : slot.uploading ? "Uploading" : "Analyzing"}
              {!justCaptured && <Dots />}
            </motion.p>
          ) : (
            <motion.div key="slider" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={slot.weight}
                onChange={(e) => onWeight(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-black"
                aria-label={`How much of style ${position} (${label})`}
              />
              <span className="w-9 shrink-0 text-right font-mono text-xs">{slot.weight}</span>
              <span className="w-12 shrink-0 text-right text-sm font-bold">{share > 0 ? `${share}%` : "off"}</span>
            </motion.div>
          )}
        </AnimatePresence>
        {current === "failed" && !justCaptured && (
          <p className="text-xs text-neutral-500">Couldn't read this style in words; the image itself still guides the look.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black hover:bg-black hover:text-white"
        aria-label={`Remove style ${position} (${label})`}
      >
        ×
      </button>
    </div>
  );
}

export function StyleMixer({
  open,
  onOpen,
  styles,
  images,
  states,
  onWeight,
  onRemove,
  onAddImage,
  onBrowse,
  onFiles,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  styles: Array<StyleSlot>;
  images: Array<Slot>;
  states: Map<string, ImageState>;
  onWeight: (id: string, weight: number) => void;
  onRemove: (id: string) => void;
  onAddImage: (slot: Slot) => void;
  onBrowse: () => void;
  onFiles: (files: Array<File>) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const mix = shares(styles.map((s) => s.weight));
  // Rows are named Style 1, Style 2, … (the request can use those names), with where the image
  // came from; what it was read as stays on the server.
  const labelFor = (slot: Slot) => {
    const index = images.findIndex((image) => image.imageId && image.imageId === slot.imageId);
    if (index >= 0) return `image ${index + 1}'s look`;
    return slot.uploading ? "new style image" : "style image";
  };
  const addable = images.filter((image) => image.imageId && !styles.some((s) => s.imageId === image.imageId));
  const room = MAX_STYLES - styles.length;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onOpen(true);
        onFiles(imageFiles(e.dataTransfer.files));
      }}
      className={cn("rounded-2xl border-2 border-black transition-colors", dragging && "bg-neutral-100")}
    >
      <button
        type="button"
        onClick={() => onOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold uppercase tracking-wider">Style mixer</span>
        <span className="flex min-w-0 flex-1 items-center overflow-hidden text-sm text-neutral-600">
          {styles.length === 0 ? "Optional" : <StyleChips items={styles.map((s, i) => ({ url: s.previewUrl, share: mix[i] }))} />}
        </span>
        <span className={cn("text-lg font-black transition-transform", open && "rotate-180")} aria-hidden="true">
          ▾
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-black px-4 pb-4 pt-1">
              {styles.length > 0 && (
                <div className="divide-y divide-neutral-200">
                  {styles.map((slot, i) => (
                    <StyleRow
                      key={slot.id}
                      slot={slot}
                      label={labelFor(slot)}
                      position={i + 1}
                      share={mix[i]}
                      state={slot.imageId ? states.get(slot.imageId) : undefined}
                      onWeight={(weight) => onWeight(slot.id, weight)}
                      onRemove={() => onRemove(slot.id)}
                    />
                  ))}
                </div>
              )}
              {styles.length >= 2 && (
                <p className="pt-2 text-xs text-neutral-500">In your request, call them {styleNames(styles.length)}.</p>
              )}
              {styles.length === 0 && (
                <p className="pt-3 text-sm text-neutral-600">
                  Mix in the look of other images. Each one gets a slider; equal sliders mix evenly.
                </p>
              )}
              {room > 0 && addable.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-neutral-600">Add a look from your images:</span>
                  {addable.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => onAddImage(image)}
                      className="rounded-full border-2 border-black px-3 py-1 font-bold hover:bg-black hover:text-white"
                    >
                      + Image {images.indexOf(image) + 1}
                    </button>
                  ))}
                </div>
              )}
              {room > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <button
                    type="button"
                    onClick={onBrowse}
                    className="rounded-xl bg-black px-3 py-2 font-bold text-white hover:-translate-y-0.5 transition-transform"
                  >
                    + Upload a style image
                  </button>
                  <span className="text-neutral-500">or drop one here</span>
                </div>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">Up to {MAX_STYLES} styles in a mix.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type LibraryImage = {
  imageId: Id<"userImages">;
  key: string;
  url?: string;
  thumbUrl?: string;
  analysis: "pending" | "ready" | "failed";
};

export function StyleLibrary({
  taken,
  onPick,
  onFiles,
  onClose,
}: {
  taken: Set<string>;
  onPick: (image: LibraryImage) => void;
  onFiles: (files: Array<File>) => void;
  onClose: () => void;
}) {
  // Style images first, then everything else the member has added; both page in as they scroll.
  const styles = usePaginatedQuery(api.images.styleImages, {}, { initialNumItems: PAGE.images });
  const recent = usePaginatedQuery(api.images.recentImages, {}, { initialNumItems: PAGE.images });
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Closing the sheet puts focus back on whatever opened it.
  useReturnFocus();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pending = (status: typeof recent.status, count: number) =>
    status === "LoadingFirstPage" || status === "LoadingMore" || (count === 0 && status === "CanLoadMore");
  const grid = (list: Array<LibraryImage>, loading: boolean) => (
    <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {list.map((image) => {
        const used = taken.has(image.imageId);
        const preview = image.thumbUrl ?? image.url;
        return (
          <button
            key={image.imageId}
            type="button"
            disabled={used || !preview}
            onClick={() => onPick(image)}
            className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border-2 border-black bg-neutral-100 p-1 disabled:opacity-40"
          >
            {preview && <Thumb url={preview} className="max-h-full max-w-full object-contain" />}
            {used && <span className="absolute inset-x-1 bottom-1 rounded bg-black px-1 text-[10px] font-bold text-white">In the mix</span>}
            {!used && image.analysis === "pending" && (
              <span className="absolute inset-x-1 bottom-1 rounded bg-black/80 px-1 text-[10px] font-bold text-white">Analyzing…</span>
            )}
          </button>
        );
      })}
      {loading && Array.from({ length: 6 }, (_, i) => <Skeleton key={`loading-${i}`} className="aspect-square rounded-xl" />)}
    </div>
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 md:items-center md:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add a style image"
    >
      <motion.div
        className={cn(
          "max-h-[88svh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-6 text-black md:rounded-3xl md:p-10",
          dragging && "ring-4 ring-black",
        )}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(imageFiles(e.dataTransfer.files));
          onClose();
        }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-4xl font-black leading-none tracking-tight md:text-5xl">Add a style</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold underline underline-offset-4">
            Close
          </button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-xl bg-black px-4 py-2.5 font-bold text-white transition-transform hover:-translate-y-0.5"
          >
            Upload from your computer
          </button>
          <span className="text-sm text-neutral-600">or drop an image anywhere here</span>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              onFiles(imageFiles(e.target.files));
              e.target.value = "";
              onClose();
            }}
          />
        </div>
        {styles.results.length > 0 && (
          <section className="mt-8">
            <h3 className="text-sm font-bold uppercase tracking-wider">Your style images</h3>
            {grid(styles.results, styles.status === "LoadingMore")}
            <LoadMore status={styles.status} onMore={() => styles.loadMore(PAGE.images)} className="mt-4" />
          </section>
        )}
        <section className="mt-8">
          <h3 className="text-sm font-bold uppercase tracking-wider">Your images</h3>
          {recent.status === "Exhausted" && recent.results.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Images you add to the studio show up here.</p>
          ) : (
            <>
              {grid(recent.results, pending(recent.status, recent.results.length))}
              <LoadMore status={recent.status} onMore={() => recent.loadMore(PAGE.images)} className="mt-4" />
            </>
          )}
        </section>
      </motion.div>
    </motion.div>
  );
}
