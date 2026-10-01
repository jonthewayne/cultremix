import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { cn } from "~/lib/utils";

// The studio's inputs: numbered images to work on, and the style mixer with its picker.
// Nothing becomes a style unless the member adds it; see docs/usage-flow.md.

export const MAX_IMAGES = 4;
export const MAX_STYLES = 3;

export type Slot = {
  id: string;
  imageId?: Id<"userImages">;
  previewUrl: string;
  uploading: boolean;
};
export type StyleSlot = Slot & { weight: number };
export type ImageState = {
  analysis: "pending" | "ready" | "failed";
  summary?: string;
  kind?: "photo" | "art";
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

export function ImageTray({
  images,
  states,
  color,
  ink,
  onColor,
  onFiles,
  onRemove,
}: {
  images: Array<Slot>;
  states: Map<string, ImageState>;
  color: string;
  ink: string;
  onColor: (color: string) => void;
  onFiles: (files: Array<File>) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const room = MAX_IMAGES - images.length;
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
            title={state?.summary}
          >
            <Thumb url={slot.previewUrl} className="max-h-full max-w-full object-contain" />
            <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-black text-white">
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(slot.id)}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-black text-black ring-1 ring-black hover:bg-black hover:text-white"
              aria-label={`Remove image ${i + 1}`}
            >
              ×
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
      <label
        className="flex h-28 w-24 cursor-pointer flex-col justify-end rounded-2xl border-2 border-black p-2"
        style={{ background: color, color: ink }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide">Background</span>
        <span className="font-mono text-xs">{color}</span>
        <input type="color" value={color} onChange={(e) => onColor(e.target.value)} className="sr-only" aria-label="Background color" />
      </label>
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
  share,
  state,
  onWeight,
  onRemove,
}: {
  slot: StyleSlot;
  label: string;
  share: number;
  state?: ImageState;
  onWeight: (weight: number) => void;
  onRemove: () => void;
}) {
  const analysis = slot.uploading ? undefined : state?.analysis;
  // "Style captured" shows for a moment when the notes arrive (or a captured style is added).
  const [justCaptured, setJustCaptured] = useState(false);
  const [known, setKnown] = useState<string | undefined>(undefined);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Unknown while the status loads: keep showing the last known state.
    if (analysis === undefined) return;
    const before = previous.current;
    previous.current = analysis;
    setKnown(analysis);
    if (analysis !== "ready" || before === "ready") return;
    setJustCaptured(true);
    const timer = window.setTimeout(() => setJustCaptured(false), 1800);
    return () => window.clearTimeout(timer);
  }, [analysis]);
  const current = slot.uploading ? undefined : (analysis ?? known);
  const settled = current === "ready" || current === "failed";
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black bg-neutral-100 p-0.5">
        <Thumb url={slot.previewUrl} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{label}</p>
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
                aria-label={`How much of ${label}`}
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg font-black hover:bg-black hover:text-white"
        aria-label={`Remove ${label}`}
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
  const labelFor = (slot: Slot) => {
    const index = images.findIndex((image) => image.imageId && image.imageId === slot.imageId);
    const state = slot.imageId ? states.get(slot.imageId) : undefined;
    const name = state?.summary ?? (slot.uploading ? "New style image" : "Style image");
    return index >= 0 ? `Image ${index + 1} · ${name}` : name;
  };
  const summary =
    styles.length === 0
      ? "Optional"
      : styles.length === 1
        ? labelFor(styles[0])
        : styles.map((s, i) => `${labelFor(s)} ${mix[i]}%`).join(" · ");
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
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-600">{summary}</span>
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
                      share={mix[i]}
                      state={slot.imageId ? states.get(slot.imageId) : undefined}
                      onWeight={(weight) => onWeight(slot.id, weight)}
                      onRemove={() => onRemove(slot.id)}
                    />
                  ))}
                </div>
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
  analysis: "pending" | "ready" | "failed";
  summary?: string;
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
  const library = useQuery(convexQuery(api.images.library, {})).data;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grid = (list: Array<LibraryImage>) => (
    <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {list.map((image) => {
        const used = taken.has(image.imageId);
        return (
          <button
            key={image.imageId}
            type="button"
            disabled={used || !image.url}
            onClick={() => onPick(image)}
            title={image.summary}
            className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border-2 border-black bg-neutral-100 p-1 disabled:opacity-40"
          >
            {image.url && <Thumb url={image.url} className="max-h-full max-w-full object-contain" />}
            {used && <span className="absolute inset-x-1 bottom-1 rounded bg-black px-1 text-[10px] font-bold text-white">In the mix</span>}
            {!used && image.analysis === "pending" && (
              <span className="absolute inset-x-1 bottom-1 rounded bg-black/80 px-1 text-[10px] font-bold text-white">Analyzing…</span>
            )}
          </button>
        );
      })}
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
        {library === undefined ? (
          <p className="mt-8 text-neutral-500">Loading your images…</p>
        ) : (
          <>
            {library.styles.length > 0 && (
              <section className="mt-8">
                <h3 className="text-sm font-bold uppercase tracking-wider">Your style images</h3>
                {grid(library.styles)}
              </section>
            )}
            <section className="mt-8">
              <h3 className="text-sm font-bold uppercase tracking-wider">Your images</h3>
              {library.recent.length > 0 ? (
                grid(library.recent)
              ) : (
                <p className="mt-2 text-sm text-neutral-500">Images you add to the studio show up here.</p>
              )}
            </section>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
