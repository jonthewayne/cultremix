import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { DEFAULT_BG, errorMessage, inkOn, prepareInspiration } from "~/lib/imagePrep";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/studio")({
  validateSearch: (search: Record<string, unknown>): { remix?: string } => ({
    remix: typeof search.remix === "string" ? search.remix : undefined,
  }),
  beforeLoad: requireAuthenticatedRoute,
  component: StudioPage,
});

const CHIPS = ["Bold type", "Vintage", "Hand-drawn", "Y2K", "Minimal", "Psychedelic", "Collage", "Neon"];

type Inspiration = { key?: string; previewUrl: string; uploading: boolean };
type Tile = {
  generationId: Id<"generations">;
  batchId: Id<"batches">;
  status: string;
  url?: string;
  favorite: boolean;
  error?: string;
  backgroundColor: string;
  publishedCr?: string;
  key?: string;
};

function StudioPage() {
  const { remix } = Route.useSearch();
  const navigate = useNavigate();
  const session = useQuery(convexQuery(api.studio.current, {})).data;
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const generate = useMutation(api.studio.generate);
  const startRemix = useMutation(api.studio.startRemix);
  const newSession = useMutation(api.studio.newSession);
  const upload = useAction(api.imageGen.uploadInspiration);

  const [instruction, setInstruction] = useState("");
  const [chips, setChips] = useState<Array<string>>([]);
  const [color, setColor] = useState(DEFAULT_BG);
  const [inspiration, setInspiration] = useState<Inspiration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewer_, setViewer] = useState<{ list: Array<Tile>; index: number } | null>(null);
  const [publishing, setPublishing] = useState<Tile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const remixStarted = useRef<string | null>(null);

  // Remix: open a remix session with the published design as the inspiration.
  useEffect(() => {
    if (!remix || remixStarted.current === remix || !viewer?.username) return;
    remixStarted.current = remix;
    startRemix({ cr: remix })
      .then((result) => {
        if (result.artKey && result.artUrl) {
          setInspiration({ key: result.artKey, previewUrl: result.artUrl, uploading: false });
        }
        setColor(result.backgroundColor);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [remix, viewer?.username, startRemix]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Drop an image file.");
        return;
      }
      setError(null);
      try {
        const prepared = await prepareInspiration(file);
        setInspiration({ previewUrl: prepared.previewUrl, uploading: true });
        setColor(prepared.color);
        const result = await upload({ bytes: prepared.bytes, contentType: prepared.contentType });
        setInspiration({ key: result.key, previewUrl: prepared.previewUrl, uploading: false });
      } catch (err) {
        setInspiration(null);
        setError(errorMessage(err));
      }
    },
    [upload],
  );

  const useAsInspiration = (tile: Tile) => {
    if (!tile.key || !tile.url) return;
    setInspiration({ key: tile.key, previewUrl: tile.url, uploading: false });
    setColor(tile.backgroundColor);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!instruction.trim() && !inspiration?.key) {
      setError("Say what to make, or drop in an inspiration image.");
      return;
    }
    if (inspiration?.uploading) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generate({
        instruction,
        presets: chips,
        backgroundColor: color,
        inspirationKey: inspiration?.key,
      });
      if ("refused" in result) {
        setError(
          result.refused === "NO_CREDITS"
            ? "You're out of credits for today."
            : "Generation is paused right now.",
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    setInspiration(null);
    setInstruction("");
    setChips([]);
    setColor(DEFAULT_BG);
    remixStarted.current = null;
    await newSession({});
    if (remix) navigate({ to: "/studio", search: {} });
  };

  const batches = session?.batches ?? [];
  const allTiles: Array<Tile> = useMemo(() => batches.flatMap((b) => b.tiles), [batches]);
  const favorites = allTiles.filter((t) => t.favorite && t.status === "succeeded");
  const tileById = useMemo(() => new Map(allTiles.map((t) => [t.generationId, t])), [allTiles]);

  const openViewer = (tile: Tile, batchTiles: Array<Tile>) => {
    const list = favorites.length
      ? favorites
      : batchTiles.filter((t) => t.status === "succeeded");
    const index = Math.max(0, list.findIndex((t) => t.generationId === tile.generationId));
    if (!list.some((t) => t.generationId === tile.generationId)) {
      setViewer({ list: [tile, ...list], index: 0 });
    } else {
      setViewer({ list, index });
    }
  };

  const remixInfo = session?.remix;
  const ink = inkOn(color);

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <section className="grid gap-8 pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:pt-10">
          <div>
            <h1 className="text-[18vw] font-black leading-[0.8] tracking-[-0.06em] md:text-[9.5vw]">Studio</h1>
            {remixInfo && (
              <div className="mt-8 flex items-center gap-4">
                <div
                  className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-2"
                  style={{ background: remixInfo.backgroundColor }}
                >
                  <Art url={remixInfo.artUrl} alt={`CR ${remixInfo.cr}`} className="h-full w-auto max-w-full object-contain" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider">Remixing</p>
                  <CrMark cr={remixInfo.cr} className="text-4xl md:text-5xl" />
                  {remixInfo.title && <p className="mt-1 text-base">“{remixInfo.title}”</p>}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void onFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  "group relative flex min-h-40 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-black text-left transition-colors",
                  dragging ? "bg-neutral-100" : "hover:bg-neutral-50",
                )}
                style={inspiration ? { background: color } : undefined}
              >
                {inspiration ? (
                  <>
                    <img src={inspiration.previewUrl.startsWith("fake:") ? undefined : inspiration.previewUrl} alt="Inspiration" className="max-h-56 w-auto object-contain" />
                    {inspiration.previewUrl.startsWith("fake:") && <Art url={inspiration.previewUrl} alt="" className="h-48" />}
                    <span className="absolute bottom-2 left-2 rounded-lg bg-black px-2 py-1 text-xs font-bold text-white">
                      {inspiration.uploading ? "Uploading…" : "Inspiration · click to replace"}
                    </span>
                  </>
                ) : (
                  <span className="px-6 py-8 text-center">
                    <span className="block text-2xl font-black tracking-tight">Drop an inspiration image</span>
                    <span className="mt-1 block text-sm text-neutral-600">or click to choose one (optional)</span>
                  </span>
                )}
              </button>
              <div className="flex w-28 flex-col gap-2">
                <label className="flex flex-1 cursor-pointer flex-col justify-end rounded-2xl border-2 border-black p-2" style={{ background: color, color: ink }}>
                  <span className="text-xs font-bold uppercase tracking-wider">Background</span>
                  <span className="font-mono text-sm">{color}</span>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="sr-only"
                    aria-label="Background color"
                  />
                </label>
                {inspiration && (
                  <button
                    type="button"
                    onClick={() => setInspiration(null)}
                    className="rounded-xl border-2 border-black px-2 py-1 text-xs font-bold hover:bg-black hover:text-white"
                  >
                    Remove image
                  </button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <label className="block">
              <span className="text-sm font-bold uppercase tracking-wider">What should change?</span>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                rows={3}
                maxLength={600}
                placeholder={inspiration ? "Make it a motel sign that says NO VACANCY FOR BAD VIBES" : "A neon motel sign that says NO VACANCY FOR BAD VIBES"}
                className="mt-2 w-full resize-none border-b-4 border-black bg-transparent py-2 text-2xl font-semibold leading-tight outline-none placeholder:text-neutral-300 md:text-3xl"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {CHIPS.map((chip) => {
                const on = chips.includes(chip);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setChips(on ? chips.filter((c) => c !== chip) : [...chips, chip])}
                    className={cn(
                      "rounded-full border-2 border-black px-3 py-1 text-sm font-bold transition-colors",
                      on ? "bg-black text-white" : "hover:bg-neutral-100",
                    )}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={busy || inspiration?.uploading}
                className="h-16 rounded-2xl bg-black px-10 text-xl font-black text-white transition-transform hover:-translate-y-0.5 disabled:opacity-40"
              >
                {busy ? "Starting…" : "Generate 4"}
              </button>
              <span className="text-sm text-neutral-600">
                {viewer?.unlimited ? "Unlimited" : `${viewer?.credits ?? 0} credits · 1 per design`}
              </span>
              {(batches.length > 0 || remixInfo) && (
                <button type="button" onClick={() => void startOver()} className="ml-auto text-sm font-semibold underline underline-offset-4">
                  Start over
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-base font-semibold text-red-600">
                {error}
              </p>
            )}
          </form>
        </section>

        <section className="mt-16 flex flex-col gap-14">
          <AnimatePresence initial={false}>
            {batches.map((batch) => (
              <motion.div
                key={batch.batchId}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="mb-3 flex items-baseline gap-3 border-t-2 border-black pt-3">
                  <span className="h-4 w-4 shrink-0 border border-black" style={{ background: batch.backgroundColor }} />
                  <p className="truncate text-base font-semibold">
                    {batch.instruction || "From the inspiration image"}
                    {batch.presets.length > 0 && <span className="font-normal text-neutral-500"> · {batch.presets.join(", ")}</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                  {batch.tiles.map((tile) => (
                    <TileCard
                      key={tile.generationId}
                      tile={tile}
                      onOpen={() => openViewer(tile, batch.tiles)}
                      onPublish={() => setPublishing(tile)}
                      onInspire={() => useAsInspiration(tile)}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {batches.length === 0 && (
            <p className="max-w-lg text-lg text-neutral-500">
              Your designs show up here, four at a time, newest on top. Heart the ones you like, then publish one to get its CR number.
            </p>
          )}
        </section>
      </main>

      <AnimatePresence>
        {viewer_ && (
          <Viewer
            list={viewer_.list.map((t) => tileById.get(t.generationId) ?? t)}
            index={viewer_.index}
            onIndex={(index) => setViewer({ ...viewer_, index })}
            onClose={() => setViewer(null)}
            onPublish={(tile) => {
              setViewer(null);
              setPublishing(tile);
            }}
            onInspire={(tile) => {
              setViewer(null);
              useAsInspiration(tile);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {publishing && <PublishDialog tile={publishing} onClose={() => setPublishing(null)} />}
      </AnimatePresence>
    </div>
  );
}

function TileCard({
  tile,
  onOpen,
  onPublish,
  onInspire,
}: {
  tile: Tile;
  onOpen: () => void;
  onPublish: () => void;
  onInspire: () => void;
}) {
  const toggle = useMutation(api.studio.toggleFavorite);
  const ready = tile.status === "succeeded";
  const failed = tile.status === "failed" || tile.status === "unknown_outcome" || tile.status === "expired";
  const ink = inkOn(tile.backgroundColor);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-2xl" style={{ background: tile.backgroundColor, color: ink }}>
      {ready ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center p-[6%]" aria-label="Open full size">
          <Art url={tile.url} alt="Design" className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]" />
        </button>
      ) : failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <span className="text-lg font-black">Didn’t work</span>
          <span className="mt-1 line-clamp-3 text-xs opacity-70">{tile.error ?? "Try again."} Credit refunded.</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="h-3 w-3"
            style={{ background: ink }}
            animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        </div>
      )}
      {ready && (
        <>
          <button
            type="button"
            onClick={() => void toggle({ generationId: tile.generationId })}
            className={cn(
              "absolute right-2 top-2 flex h-10 w-10 items-center justify-center text-2xl transition-transform hover:scale-110",
              tile.favorite ? "opacity-100" : "opacity-70 md:opacity-0 md:group-hover:opacity-100",
            )}
            aria-label={tile.favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={tile.favorite}
          >
            {tile.favorite ? "♥" : "♡"}
          </button>
          {tile.publishedCr ? (
            <Link
              to="/cr/$cr"
              params={{ cr: tile.publishedCr }}
              className="absolute bottom-2 left-2 rounded-lg bg-black px-2 py-1 text-xs font-black text-white"
            >
              CR {tile.publishedCr}
            </Link>
          ) : (
            <div className="absolute inset-x-2 bottom-2 flex gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
              <button type="button" onClick={onPublish} className="rounded-lg bg-black px-3 py-1.5 text-xs font-black text-white hover:bg-neutral-800">
                Publish
              </button>
              <button type="button" onClick={onInspire} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-neutral-100">
                Use as inspiration
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Viewer({
  list,
  index,
  onIndex,
  onClose,
  onPublish,
  onInspire,
}: {
  list: Array<Tile>;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onPublish: (tile: Tile) => void;
  onInspire: (tile: Tile) => void;
}) {
  const toggle = useMutation(api.studio.toggleFavorite);
  const [checker, setChecker] = useState(false);
  const tile = list[Math.min(index, list.length - 1)];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndex((index + 1) % list.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + list.length) % list.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, list.length, onClose, onIndex]);
  if (!tile) return null;
  const ink = checker ? "#000000" : inkOn(tile.backgroundColor);
  const button = "h-11 rounded-xl px-4 text-sm font-bold";
  return (
    <motion.div
      className={cn("fixed inset-0 z-50 flex flex-col", checker && "checker")}
      style={checker ? { color: ink } : { background: tile.backgroundColor, color: ink }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label="Design viewer"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <span className="font-cr text-4xl md:text-5xl">
          {index + 1} / {list.length}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void toggle({ generationId: tile.generationId })}
            className="h-11 px-3 text-3xl leading-none"
            aria-label={tile.favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={tile.favorite}
          >
            {tile.favorite ? "♥" : "♡"}
          </button>
          <button
            type="button"
            onClick={() => setChecker(!checker)}
            aria-pressed={checker}
            className={cn(button, "border-2", checker ? "border-black bg-black text-white" : "border-current")}
          >
            Transparency
          </button>
          {tile.key && (
            <button type="button" onClick={() => onInspire(tile)} className={cn(button, "border-2 border-current")}>
              Use as inspiration
            </button>
          )}
          {tile.publishedCr ? (
            <Link to="/cr/$cr" params={{ cr: tile.publishedCr }} className={cn(button, "flex items-center bg-black text-white")}>
              CR {tile.publishedCr}
            </Link>
          ) : (
            <button type="button" onClick={() => onPublish(tile)} className={cn(button, "bg-black text-white")}>
              Publish
            </button>
          )}
          <button type="button" onClick={onClose} className="h-11 px-2 text-sm font-bold underline underline-offset-4">
            Close (Esc)
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tile.generationId}
            className="flex h-full w-full items-center justify-center"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.18 }}
          >
            <Art url={tile.url} alt="Design, full size" className="h-full max-h-[80vh] w-auto max-w-full object-contain" />
          </motion.div>
        </AnimatePresence>
        {list.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onIndex((index - 1 + list.length) % list.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-3 text-5xl font-black md:left-6"
              aria-label="Previous"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onIndex((index + 1) % list.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-5xl font-black md:right-6"
              aria-label="Next"
            >
              →
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function PublishDialog({ tile, onClose }: { tile: Tile; onClose: () => void }) {
  const publish = useMutation(api.publish.quick);
  const [title, setTitle] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ cr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const published = await publish({ requestId, generationId: tile.generationId, title: title || undefined });
      setResult({ cr: published.cr });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <motion.div
        className="fixed inset-0 z-50 flex flex-col justify-between gap-8 overflow-y-auto bg-black p-6 text-white md:p-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Published"
      >
        <p className="text-sm font-bold uppercase tracking-[0.3em]">Published</p>
        <div>
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 170, damping: 20 }}
          >
            <CrMark cr={result.cr} className="text-[18vw] md:text-[16vw]" />
          </motion.div>
          {title && (
            <motion.p
              className="mt-4 text-3xl font-bold md:text-5xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
            >
              {title}
            </motion.p>
          )}
        </div>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-2"
              style={{ background: tile.backgroundColor }}
            >
              <Art url={tile.url} alt="Design" className="h-full w-auto max-w-full object-contain" />
            </div>
            <p className="max-w-xs text-sm text-neutral-300">
              The model photo is developing. It appears on the feed in a minute or two.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/cr/$cr" params={{ cr: result.cr }} className="rounded-2xl bg-white px-7 py-4 text-base font-black text-black">
              View shop page
            </Link>
            <button type="button" onClick={onClose} className="rounded-2xl border-2 border-white px-7 py-4 text-base font-black">
              Keep creating
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Publish"
    >
      <motion.div
        className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white text-black md:grid-cols-2"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="flex aspect-square items-center justify-center p-[8%]" style={{ background: tile.backgroundColor }}>
          <Art url={tile.url} alt="Design on the shirt color" className="h-full w-auto max-w-full object-contain" />
        </div>
        <form onSubmit={submit} className="flex flex-col justify-between gap-8 p-6 md:p-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider">Publish</p>
            <h2 className="mt-3 text-4xl font-black leading-none tracking-tight">Give it a title</h2>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Optional"
              className="mt-6 w-full border-b-4 border-black bg-transparent py-2 text-2xl font-semibold outline-none placeholder:text-neutral-300"
            />
            <p className="mt-4 text-sm text-neutral-600">
              It gets the next CR number and goes on the feed, printed on a{" "}
              <span className="inline-block h-3 w-3 rounded-sm border border-black align-middle" style={{ background: tile.backgroundColor }} />{" "}
              <span className="font-mono">{tile.backgroundColor}</span> shirt.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving} className="h-14 rounded-2xl bg-black px-8 text-lg font-black text-white disabled:opacity-50">
              {saving ? "Publishing…" : "Publish"}
            </button>
            <button type="button" onClick={onClose} disabled={saving} className="px-2 text-sm font-semibold underline underline-offset-4">
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="font-semibold text-red-600">
              {error}
            </p>
          )}
        </form>
      </motion.div>
    </motion.div>
  );
}
