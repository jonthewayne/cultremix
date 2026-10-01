import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { ImageTray, MAX_IMAGES, MAX_STYLES, StyleChips, StyleLibrary, StyleMixer, listNames } from "~/components/studio/StudioInputs";
import type { ImageState, Slot, StyleSlot } from "~/components/studio/StudioInputs";
import { DesignMenu, SessionList, SessionTitle } from "~/components/studio/StudioSessions";
import type { MenuItem } from "~/components/studio/StudioSessions";
import { DEFAULT_BG, errorMessage, inkOn, prepareInspiration } from "~/lib/imagePrep";
import { PROMPT_IDEAS, pickIdeas } from "~/lib/promptIdeas";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { designFilename, isTouchDevice, prefetchImage, saveImage } from "~/lib/saveImage";
import { cn } from "~/lib/utils";

// /studio is always a blank design with the member's sessions below it; /studio?s=<id> opens a
// session (every batch made in it, newest first); /studio?remix=<CR> starts a new remix session.
export const Route = createFileRoute("/studio")({
  validateSearch: (search: Record<string, unknown>): { remix?: string; s?: string } => ({
    remix: typeof search.remix === "string" ? search.remix : undefined,
    s: typeof search.s === "string" ? search.s : undefined,
  }),
  beforeLoad: requireAuthenticatedRoute,
  component: StudioPage,
});

type Tile = {
  generationId: Id<"generations">;
  batchId: Id<"batches">;
  status: string;
  url?: string;
  favorite: boolean;
  error?: string;
  blocked?: boolean;
  backgroundColor: string;
  publishedCr?: string;
  key?: string;
};

let slotCounter = 0;
const newSlotId = () => `slot-${Date.now()}-${slotCounter++}`;

function StudioPage() {
  const { remix, s } = Route.useSearch();
  const navigate = useNavigate();
  const sessionQuery = useQuery(convexQuery(api.studio.session, s ? { sessionId: s } : "skip"));
  const session = s ? sessionQuery.data : undefined;
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const generate = useMutation(api.studio.generate);
  const startRemix = useMutation(api.studio.startRemix);
  const upload = useAction(api.imageGen.uploadInspiration);
  const adopt = useMutation(api.images.adopt);
  const markStyle = useMutation(api.images.markStyle);

  const [instruction, setInstruction] = useState("");
  const [color, setColor] = useState(DEFAULT_BG);
  // Numbered images to work on, and the style mix. Nothing joins the mix unless the member adds it.
  const [images, setImages] = useState<Array<Slot>>([]);
  const [styles, setStyles] = useState<Array<StyleSlot>>([]);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer_, setViewer] = useState<{ list: Array<Tile>; index: number } | null>(null);
  const [publishing, setPublishing] = useState<Tile | null>(null);
  const remixStarted = useRef<string | null>(null);
  const imagesRef = useRef(images);
  const stylesRef = useRef(styles);
  imagesRef.current = images;
  stylesRef.current = styles;
  // Ideas for starting from scratch, picked after mount so the server and client render the same page.
  const [ideas, setIdeas] = useState<Array<string> | null>(null);
  const [showIdeas, setShowIdeas] = useState(false);
  useEffect(() => setIdeas(pickIdeas(3)), []);

  // Live state of every image in play: reading, style captured, or failed.
  const imageIds = useMemo(
    () => [...new Set([...images, ...styles].map((slot) => slot.imageId).filter((id): id is Id<"userImages"> => Boolean(id)))],
    [images, styles],
  );
  const statusList = useQuery({ ...convexQuery(api.images.status, { imageIds }), placeholderData: keepPreviousData }).data;
  const states = useMemo(
    () => new Map<string, ImageState>((statusList ?? []).map((image) => [image.imageId, image])),
    [statusList],
  );

  // A finished upload: keep the slot, or drop it if the same image is already there.
  const settle = (id: string, imageId: Id<"userImages">, asStyle: boolean) => {
    const update = <T extends Slot>(list: Array<T>) =>
      list.some((slot) => slot.id !== id && slot.imageId === imageId)
        ? list.filter((slot) => slot.id !== id)
        : list.map((slot) => (slot.id === id ? { ...slot, imageId, uploading: false } : slot));
    if (asStyle) setStyles(update);
    else setImages(update);
  };
  const dropSlot = (id: string) => {
    setImages((list) => list.filter((slot) => slot.id !== id));
    setStyles((list) => list.filter((slot) => slot.id !== id));
  };

  // Files from the tray (images to work on) or the mixer and its picker (styles).
  const addFiles = useCallback(
    async (files: Array<File>, asStyle: boolean) => {
      if (files.length === 0) return;
      setError(null);
      const current = asStyle ? stylesRef.current.length : imagesRef.current.length;
      const max = asStyle ? MAX_STYLES : MAX_IMAGES;
      const room = max - current;
      if (room <= 0) {
        setError(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
        return;
      }
      const firstImage = !asStyle && current === 0;
      const prepared = [];
      for (const file of files.slice(0, room)) {
        try {
          prepared.push({ id: newSlotId(), ...(await prepareInspiration(file)) });
        } catch (err) {
          setError(errorMessage(err));
        }
      }
      if (prepared.length === 0) return;
      const slots = prepared.map((p) => ({ id: p.id, previewUrl: p.previewUrl, uploading: true }));
      if (asStyle) {
        setStyles((list) => [...list, ...slots.map((slot) => ({ ...slot, weight: 100 }))]);
        setMixerOpen(true);
      } else {
        setImages((list) => [...list, ...slots]);
        if (firstImage) setColor(prepared[0].color);
      }
      if (files.length > room) setError(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
      await Promise.all(
        prepared.map(async (p) => {
          try {
            const result = await upload({ bytes: p.bytes, contentType: p.contentType, asStyle });
            settle(p.id, result.imageId, asStyle);
          } catch (err) {
            dropSlot(p.id);
            setError(errorMessage(err));
          }
        }),
      );
    },
    [upload],
  );

  // A design or a published work's art, brought in as an image or a style.
  const addExisting = useCallback(
    async (key: string, url: string, asStyle: boolean) => {
      const list = asStyle ? stylesRef.current : imagesRef.current;
      if (list.some((slot) => slot.previewUrl === url)) return;
      if (list.length >= (asStyle ? MAX_STYLES : MAX_IMAGES)) {
        setError(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
        return;
      }
      const id = newSlotId();
      const slot = { id, previewUrl: url, uploading: true };
      if (asStyle) {
        setStyles((current) => [...current, { ...slot, weight: 100 }]);
        setMixerOpen(true);
      } else {
        setImages((current) => [...current, slot]);
      }
      try {
        const imageId = await adopt({ key, asStyle });
        settle(id, imageId, asStyle);
      } catch (err) {
        dropSlot(id);
        setError(errorMessage(err));
      }
    },
    [adopt],
  );

  // Moving between sessions (or back to a blank studio) clears the form, except when the studio
  // itself just opened the session (first batch or a remix link), which keeps what's in the form.
  const adopted = useRef<string | undefined>(undefined);
  const seeded = useRef<string | undefined>(undefined);
  useEffect(() => {
    setViewer(null);
    if (s && s === adopted.current) {
      seeded.current = s;
      return;
    }
    seeded.current = undefined;
    setImages([]);
    setStyles([]);
    setInstruction("");
    setColor(DEFAULT_BG);
    setMixerOpen(false);
    setError(null);
  }, [s]);
  // An opened session picks up where it left off: its newest batch's words, images, and styles.
  useEffect(() => {
    if (!s || !session || seeded.current === s) return;
    seeded.current = s;
    const last = session.lastInputs;
    if (last) {
      setInstruction(last.instruction);
      setColor(last.backgroundColor);
      setImages(last.images.flatMap((image) => (image.url ? [{ id: newSlotId(), imageId: image.imageId, previewUrl: image.url, uploading: false }] : [])));
      setStyles(
        last.styles.flatMap((style) =>
          style.url ? [{ id: newSlotId(), imageId: style.imageId, previewUrl: style.url, uploading: false, weight: style.weight }] : [],
        ),
      );
      if (last.legacyKey && last.legacyUrl) void addExisting(last.legacyKey, last.legacyUrl, false);
    } else if (session.remix?.artKey && session.remix.artUrl) {
      setColor(session.remix.backgroundColor);
      void addExisting(session.remix.artKey, session.remix.artUrl, false);
    }
  }, [s, session, addExisting]);
  // A session that isn't the member's (or no longer exists) falls back to a blank studio.
  useEffect(() => {
    if (s && sessionQuery.data === null) void navigate({ to: "/studio", search: {}, replace: true });
  }, [s, sessionQuery.data, navigate]);

  // Remix: a new session with the published design as image 1.
  useEffect(() => {
    if (!remix || remixStarted.current === remix || !viewer?.username) return;
    remixStarted.current = remix;
    startRemix({ cr: remix, fresh: true })
      .then((result) => {
        adopted.current = result.sessionId;
        setImages([]);
        setStyles([]);
        setInstruction("");
        setColor(result.backgroundColor);
        if (result.artKey && result.artUrl) void addExisting(result.artKey, result.artUrl, false);
        void navigate({ to: "/studio", search: { s: result.sessionId }, replace: true });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [remix, viewer?.username, startRemix, addExisting, navigate]);

  const openSession = (sessionId: string) => {
    void navigate({ to: "/studio", search: { s: sessionId } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const useAsImage = (tile: Tile) => {
    if (!tile.key || !tile.url) return;
    if (imagesRef.current.length === 0) setColor(tile.backgroundColor);
    void addExisting(tile.key, tile.url, false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const useAsStyle = (tile: Tile) => {
    if (!tile.key || !tile.url) return;
    void addExisting(tile.key, tile.url, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addImageLook = (slot: Slot) => {
    if (!slot.imageId || stylesRef.current.length >= MAX_STYLES) return;
    if (stylesRef.current.some((style) => style.imageId === slot.imageId)) return;
    setStyles((list) => [...list, { id: newSlotId(), imageId: slot.imageId, previewUrl: slot.previewUrl, uploading: false, weight: 100 }]);
  };
  const pickStyle = (image: { imageId: Id<"userImages">; url?: string }) => {
    if (!image.url || stylesRef.current.length >= MAX_STYLES) return;
    if (stylesRef.current.some((style) => style.imageId === image.imageId)) return;
    setStyles((list) => [...list, { id: newSlotId(), imageId: image.imageId, previewUrl: image.url!, uploading: false, weight: 100 }]);
    setMixerOpen(true);
    setLibraryOpen(false);
    void markStyle({ imageId: image.imageId }).catch(() => undefined);
  };

  const applyIdea = (idea: string) => {
    setInstruction(idea);
    setError(null);
    setShowIdeas(false);
  };

  const uploading = [...images, ...styles].some((slot) => slot.uploading || !slot.imageId);
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy || uploading) return;
    if (!instruction.trim() && images.length === 0 && !styles.some((style) => style.weight > 0)) {
      setError("Say what to make, or add an image.");
      return;
    }
    if (s && !session) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generate({
        ...(session ? { sessionId: session.sessionId } : { newSession: true }),
        instruction,
        backgroundColor: color,
        images: images.map((slot) => slot.imageId!),
        styles: styles.map((slot) => ({ imageId: slot.imageId!, weight: slot.weight })),
      });
      if ("refused" in result) {
        setError(
          result.refused === "NO_CREDITS"
            ? "You're out of credits for today."
            : "Generation is paused right now.",
        );
      } else if (result.sessionId !== s) {
        adopted.current = result.sessionId;
        await navigate({ to: "/studio", search: { s: result.sessionId } });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
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
  const count = images.length;
  const ink = inkOn(color);
  const outOfCredits = Boolean(viewer && !viewer.unlimited && viewer.credits < 4);
  const loadingSession = Boolean(s && session === undefined);

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <section className="grid grid-cols-1 gap-8 pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:pt-10">
          <div className="flex min-w-0 flex-col gap-6">
            <h1 className="text-[18vw] font-black leading-[0.8] tracking-[-0.06em] md:text-[9.5vw]">Studio</h1>
            {session ? (
              <div className="flex flex-col gap-4">
                <SessionTitle key={session.sessionId} sessionId={session.sessionId} name={session.name} batches={session.batches.length} />
                {remixInfo && (
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-2"
                      style={{ background: remixInfo.backgroundColor }}
                    >
                      <Art url={remixInfo.artUrl} alt={`CR ${remixInfo.cr}`} className="h-full w-auto max-w-full object-contain" />
                    </div>
                    <div>
                      <p className="text-sm font-bold uppercase tracking-wider">Remixing</p>
                      <CrMark cr={remixInfo.cr} className="text-3xl md:text-4xl" />
                      {remixInfo.title && <p className="mt-1 text-base">“{remixInfo.title}”</p>}
                    </div>
                  </div>
                )}
                <Link
                  to="/studio"
                  search={{}}
                  className="self-start rounded-xl border-2 border-black px-4 py-2 text-sm font-bold transition-colors hover:bg-black hover:text-white"
                >
                  + New design
                </Link>
              </div>
            ) : (
              !loadingSession && <p className="text-lg text-neutral-600">New design. Your sessions are below.</p>
            )}
          </div>

          <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
            <ImageTray
              images={images}
              states={states}
              color={color}
              ink={ink}
              onColor={setColor}
              onFiles={(files) => void addFiles(files, false)}
              onRemove={(id) => setImages((list) => list.filter((slot) => slot.id !== id))}
            />

            <label className="block">
              <span className="text-sm font-bold uppercase tracking-wider">
                {count === 0 ? "What do you want to make?" : "What should change?"}
              </span>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                rows={2}
                maxLength={600}
                placeholder={
                  count === 0
                    ? "Describe your design…"
                    : count === 1
                      ? "Change the words, colors, characters…"
                      : `Refer to them as ${listNames(count)}…`
                }
                className="mt-2 w-full resize-none border-b-4 border-black bg-transparent py-2 text-2xl font-semibold leading-tight outline-none placeholder:text-neutral-300 md:text-3xl"
              />
            </label>

            {count === 0 && ideas && (
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-bold uppercase tracking-wider">Need an idea?</span>
                  <span className="flex gap-4 text-sm font-semibold">
                    <button type="button" onClick={() => setIdeas(pickIdeas(3, ideas))} className="underline underline-offset-4">
                      Shuffle
                    </button>
                    <button type="button" onClick={() => setShowIdeas(true)} className="underline underline-offset-4">
                      All ideas
                    </button>
                  </span>
                </div>
                <div className="mt-2 flex flex-col items-start gap-2">
                  {ideas.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => applyIdea(idea)}
                      className="rounded-xl bg-neutral-100 px-3 py-1.5 text-left text-sm font-semibold transition-colors hover:bg-black hover:text-white"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <StyleMixer
              open={mixerOpen}
              onOpen={setMixerOpen}
              styles={styles}
              images={images}
              states={states}
              onWeight={(id, weight) => setStyles((list) => list.map((slot) => (slot.id === id ? { ...slot, weight } : slot)))}
              onRemove={(id) => setStyles((list) => list.filter((slot) => slot.id !== id))}
              onAddImage={addImageLook}
              onBrowse={() => setLibraryOpen(true)}
              onFiles={(files) => void addFiles(files, true)}
            />

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={busy || uploading || outOfCredits || loadingSession}
                className="h-16 rounded-2xl bg-black px-10 text-xl font-black text-white transition-transform hover:-translate-y-0.5 disabled:opacity-40"
              >
                {outOfCredits ? "Out of credits" : busy ? "Starting…" : uploading ? "Uploading…" : "Generate 4"}
              </button>
              <span className="text-sm text-neutral-600">
                {viewer?.unlimited ? "Unlimited" : `${viewer?.credits ?? 0} credits · 4 per batch`}
              </span>
            </div>
            {error && (
              <p role="alert" className="text-base font-semibold text-red-600">
                {error}
              </p>
            )}
          </form>
        </section>

        <section className="mt-16 flex flex-col gap-14">
          {!s && <SessionList onOpen={openSession} />}
          {loadingSession && <p className="text-neutral-500">Opening the session…</p>}
          <AnimatePresence initial={false}>
            {batches.map((batch) => (
              <motion.div
                key={batch.batchId}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-black pt-3">
                  <span className="h-4 w-4 shrink-0 border border-black" style={{ background: batch.backgroundColor }} />
                  {batch.images.length > 0 && (
                    <span className="flex shrink-0 gap-1">
                      {batch.images.map((image, i) => (
                        <span key={i} className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-black bg-neutral-100">
                          {image.url && <Art url={image.url} alt={`Image ${i + 1}`} className="max-h-full max-w-full object-contain" />}
                        </span>
                      ))}
                    </span>
                  )}
                  <p className="min-w-0 flex-1 truncate text-base font-semibold">
                    {batch.instruction || "From your images"}
                    {batch.presets.length > 0 && <span className="font-normal text-neutral-500"> · {batch.presets.join(", ")}</span>}
                  </p>
                  {batch.styles.length > 0 && (
                    <span className="flex shrink-0 items-center gap-2 text-sm text-neutral-500">
                      Style
                      <StyleChips items={batch.styles} />
                    </span>
                  )}
                  {batch.tiles.some((t) => t.status === "queued" || t.status === "dispatched") && (
                    <Elapsed since={batch.createdAt} />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                  {batch.tiles.map((tile) => (
                    <TileCard
                      key={tile.generationId}
                      tile={tile}
                      onOpen={() => openViewer(tile, batch.tiles)}
                      onPublish={() => setPublishing(tile)}
                      onInspire={() => useAsImage(tile)}
                      onStyle={() => useAsStyle(tile)}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {session && batches.length === 0 && (
            <p className="max-w-lg text-lg text-neutral-500">
              Designs in this session show up here, four at a time, newest on top. Heart the ones you like, then publish one to get its CR number.
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
              useAsImage(tile);
            }}
            onStyle={(tile) => {
              setViewer(null);
              useAsStyle(tile);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {publishing && <PublishDialog tile={publishing} onClose={() => setPublishing(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showIdeas && <IdeasSheet onPick={applyIdea} onClose={() => setShowIdeas(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {libraryOpen && (
          <StyleLibrary
            taken={new Set(styles.map((slot) => slot.imageId).filter((id): id is Id<"userImages"> => Boolean(id)))}
            onPick={pickStyle}
            onFiles={(files) => void addFiles(files, true)}
            onClose={() => setLibraryOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// The ⋯ menu's choices for a finished design.
function designItems(
  tile: Tile,
  actions: { onOpen: () => void; onPublish: () => void; onInspire: () => void; onStyle: () => void },
): Array<MenuItem> {
  const filename = designFilename(tile);
  const items: Array<MenuItem> = [
    { label: "View large", onSelect: actions.onOpen },
    { label: isTouchDevice() ? "Save image" : "Download", onSelect: () => saveImage(tile.url, filename) },
  ];
  if (tile.url && !tile.url.startsWith("fake:")) items.push({ label: "Open full size", href: tile.url });
  if (tile.key) {
    items.push({ label: "Use as image", onSelect: actions.onInspire });
    items.push({ label: "Use as style", onSelect: actions.onStyle });
  }
  if (!tile.publishedCr) items.push({ label: "Publish", onSelect: actions.onPublish });
  return items;
}

function IdeasSheet({ onPick, onClose }: { onPick: (idea: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      aria-label="Ideas"
    >
      <motion.div
        className="max-h-[88svh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-6 text-black md:rounded-3xl md:p-10"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-4xl font-black leading-none tracking-tight md:text-5xl">Ideas</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold underline underline-offset-4">
            Close
          </button>
        </div>
        <p className="mt-3 text-neutral-600">Pick one to start. Change anything before you generate.</p>
        <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
          {PROMPT_IDEAS.map((group) => (
            <section key={group.group}>
              <h3 className="text-sm font-bold uppercase tracking-wider">{group.group}</h3>
              <ul className="mt-2 divide-y divide-neutral-200 border-t-2 border-black">
                {group.ideas.map((idea) => (
                  <li key={idea}>
                    <button type="button" onClick={() => onPick(idea)} className="w-full py-2 text-left font-semibold hover:underline">
                      {idea}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function TileCard({
  tile,
  onOpen,
  onPublish,
  onInspire,
  onStyle,
}: {
  tile: Tile;
  onOpen: () => void;
  onPublish: () => void;
  onInspire: () => void;
  onStyle: () => void;
}) {
  const toggle = useMutation(api.studio.toggleFavorite);
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = tile.status === "succeeded";
  const failed = tile.status === "failed" || tile.status === "unknown_outcome" || tile.status === "expired";
  const ink = inkOn(tile.backgroundColor);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-2xl" style={{ background: tile.backgroundColor, color: ink }}>
      {ready ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center p-[6%]" aria-label="View large">
          <Art url={tile.url} alt="Design" className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]" />
        </button>
      ) : failed && tile.blocked ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center md:p-4">
          <span className="text-lg font-black leading-tight">Blocked by filter</span>
          <span className="mt-1 max-w-[16rem] text-xs opacity-70">
            Shittles, this got flagged for some reason. Please try again if you think we got this wrong. Credit’s back.
          </span>
        </div>
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
          <DesignMenu
            items={designItems(tile, { onOpen, onPublish, onInspire, onStyle })}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (open) prefetchImage(tile.url);
            }}
            className={cn(
              "absolute left-2 top-2",
              menuOpen ? "opacity-100" : "opacity-100 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100",
            )}
          />
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
            <button
              type="button"
              onClick={onPublish}
              className="absolute bottom-2 left-2 rounded-lg bg-black px-3 py-1.5 text-xs font-black text-white opacity-100 transition-opacity hover:bg-neutral-800 md:opacity-0 md:group-hover:opacity-100"
            >
              Publish
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-neutral-500">
      Designing · {seconds} s
    </span>
  );
}

function Viewer({
  list,
  index,
  onIndex,
  onClose,
  onPublish,
  onInspire,
  onStyle,
}: {
  list: Array<Tile>;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onPublish: (tile: Tile) => void;
  onInspire: (tile: Tile) => void;
  onStyle: (tile: Tile) => void;
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
  // Ready to save the moment it's tapped (phones only share files during the tap).
  useEffect(() => prefetchImage(tile?.url), [tile?.url]);
  if (!tile) return null;
  const ink = checker ? "#000000" : inkOn(tile.backgroundColor);
  const button = "h-11 rounded-xl px-4 text-sm font-bold";
  const items: Array<MenuItem> = [
    { label: checker ? "Show the background color" : "Show transparency", onSelect: () => setChecker(!checker) },
    ...designItems(tile, {
      onOpen: () => undefined,
      onPublish: () => onPublish(tile),
      onInspire: () => onInspire(tile),
      onStyle: () => onStyle(tile),
    }).filter((item) => item.label !== "View large" && item.label !== "Download" && item.label !== "Save image" && item.label !== "Publish"),
  ];
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
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
        <span className="font-cr text-3xl md:text-5xl">
          {index + 1} / {list.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggle({ generationId: tile.generationId })}
            className="h-11 px-2 text-3xl leading-none"
            aria-label={tile.favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={tile.favorite}
          >
            {tile.favorite ? "♥" : "♡"}
          </button>
          <button
            type="button"
            onClick={() => saveImage(tile.url, designFilename(tile))}
            className={cn(button, "hidden border-2 border-current sm:block")}
          >
            {isTouchDevice() ? "Save image" : "Download"}
          </button>
          {tile.publishedCr ? (
            <Link to="/cr/$cr" params={{ cr: tile.publishedCr }} className={cn(button, "flex items-center bg-black text-white")}>
              CR {tile.publishedCr}
            </Link>
          ) : (
            <button type="button" onClick={() => onPublish(tile)} className={cn(button, "bg-black text-white")}>
              Publish
            </button>
          )}
          <DesignMenu
            items={[{ label: isTouchDevice() ? "Save image" : "Download", onSelect: () => saveImage(tile.url, designFilename(tile)) }, ...items]}
          />
          <button type="button" onClick={onClose} className="h-11 px-2 text-sm font-bold underline underline-offset-4">
            Close
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-6 md:px-14">
        <AnimatePresence mode="wait">
          <motion.div
            key={tile.generationId}
            className="flex h-full w-full items-center justify-center"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.18 }}
            drag={list.length > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80) onIndex((index + 1) % list.length);
              else if (info.offset.x > 80) onIndex((index - 1 + list.length) % list.length);
            }}
          >
            <Art url={tile.url} alt="Design, full size" className="pointer-events-none h-full max-h-[82vh] w-auto max-w-full select-none object-contain" />
          </motion.div>
        </AnimatePresence>
        {list.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onIndex((index - 1 + list.length) % list.length)}
              className="absolute left-1 top-1/2 hidden -translate-y-1/2 p-3 text-5xl font-black sm:block md:left-6"
              aria-label="Previous"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onIndex((index + 1) % list.length)}
              className="absolute right-1 top-1/2 hidden -translate-y-1/2 p-3 text-5xl font-black sm:block md:right-6"
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
