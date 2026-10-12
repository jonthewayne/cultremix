import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { BATCH_CREDITS, DESIGNS_PER_BATCH, ENGINES, engineMakesGrid } from "../../convex/lib/studioRules";
import { changeSummary } from "../../convex/lib/remixWords";
import { GARMENT_COLORS, nearestGarmentColor } from "../../convex/lib/garments";
import type { Engine } from "../../convex/lib/studioRules";
import type { Palette } from "../../convex/lib/garments";
import type { Id } from "../../convex/_generated/dataModel";
import type { ImageState, Slot, StyleSlot } from "~/components/studio/StudioInputs";
import type { Tile } from "~/components/studio/design";
import type { Scope } from "~/lib/viewerNav";
import type { PartValue, PublicPart } from "~/components/studio/RemixPartInputs";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { PublishDialog } from "~/components/publish/PublishDialog";
import { SiteHeader } from "~/components/cr/SiteHeader";
import {
  ImageTray,
  MAX_IMAGES,
  MAX_STYLES,
  StyleChips,
  StyleLibrary,
  StyleMixer,
  listNames,
  loneStyleAtFull,
} from "~/components/studio/StudioInputs";
import { LoadMore, PAGE, Skeleton } from "~/components/studio/LoadMore";
import { RemixWordInputs, changedWords, wordsTooLong } from "~/components/studio/RemixWordInputs";
import { RemixPartInputs, missingPhotos, partEntries } from "~/components/studio/RemixPartInputs";
import { RemixSetupSheet } from "~/components/studio/RemixSetupSheet";
import { DesignMenu, SessionList, SessionTitle } from "~/components/studio/StudioSessions";
import { Compare } from "~/components/studio/Compare";
import { FavoritesTray } from "~/components/studio/FavoritesTray";
import { JudgeWelcome } from "~/components/studio/JudgeWelcome";
import { Viewer } from "~/components/studio/Viewer";
import { designItems, isFailed } from "~/components/studio/design";
import { useDesignActions } from "~/components/studio/designActions";
import { useCompareRoute } from "~/components/studio/useCompareRoute";
import { useViewerRoute } from "~/components/studio/useViewerRoute";
import { DEFAULT_BG, errorMessage, inkOn, prepareInspiration } from "~/lib/imagePrep";
import { PROMPT_IDEAS, pickIdeas } from "~/lib/promptIdeas";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { prefetchImage } from "~/lib/saveImage";
import { fixSpellingRequest, spellingNote } from "~/lib/spelling";
import { COMPARE_MAX, canCompare, compareParam, parseCompare, togglePick } from "~/lib/compare";
import { cn } from "~/lib/utils";
import { parseScope } from "~/lib/viewerNav";
import { useReturnFocus } from "~/hooks/use-return-focus";

// /studio is always a blank design with the member's sessions below it; /studio?s=<id> opens a
// session (every batch made in it, newest first); /studio?remix=<CR> starts a new remix session;
// &try=<design> tries the member's own design as a remix with its remixable parts.
// &view=<design>&scope=<favorites|batch|session> opens the large viewer on a design;
// &compare=<design>,<design>,… opens Compare on two to four of them.
export const Route = createFileRoute("/studio")({
  head: () => ({ meta: [{ title: "Studio · CultRemix" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { remix?: string; s?: string; view?: string; scope?: Scope; compare?: string; try?: string } => ({
    remix: typeof search.remix === "string" ? search.remix : undefined,
    s: typeof search.s === "string" ? search.s : undefined,
    view: typeof search.view === "string" ? search.view : undefined,
    scope: parseScope(search.scope),
    compare: compareParam(parseCompare(search.compare)),
    try: typeof search.try === "string" ? search.try : undefined,
  }),
  beforeLoad: requireAuthenticatedRoute,
  component: StudioPage,
});

let slotCounter = 0;
const newSlotId = () => `slot-${Date.now()}-${slotCounter++}`;

// A problem with an image (one the browser can't open, too many, a failed upload) shows as a
// toast where the member is looking: the form's error line sits under Generate, off a phone's
// screen. The same message twice shows once, for long enough to read.
function imageProblem(message: string) {
  toast.error(message, { id: message, duration: 8000 });
}

// The studio previews designs on shirt colors (the active shirt's, convex/merch.ts palette): any
// color it picks by itself snaps to the nearest one.
const START_COLOR = nearestGarmentColor(DEFAULT_BG).hex;

// Examples under the request box once there are two or more images. The request reader
// (convex/lib/roleReader.ts) reads each of these the way it's meant.
const IMAGE_HINTS = ["Draw image 1 in the style of image 2", "Use the colors of image 2", "Put the people from image 2 into image 1"];

function StudioPage() {
  const search = Route.useSearch();
  const { remix, s } = search;
  const navigate = useNavigate();
  const sessionQuery = useQuery(convexQuery(api.studio.session, s ? { sessionId: s } : "skip"));
  const sessionData = s ? sessionQuery.data : undefined;
  const session = sessionData && !("missing" in sessionData) ? sessionData : undefined;
  // The session's batches, newest first; older ones page in as the list scrolls.
  const batchPages = usePaginatedQuery(api.studio.sessionBatches, s ? { sessionId: s } : "skip", {
    initialNumItems: PAGE.batches,
  });
  // Its favorites, in the order they were hearted: the tray, and the viewer's Favorites.
  const favoritePages = usePaginatedQuery(api.studio.sessionFavorites, s ? { sessionId: s } : "skip", {
    initialNumItems: PAGE.favorites,
  });
  const viewerRoute = useViewerRoute(search);
  const compareRoute = useCompareRoute(search);
  // Designs picked for Compare (from the favorites tray or the viewer), in the order picked.
  const [picks, setPicks] = useState<Array<string>>([]);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setPicks([]);
    setPicking(false);
  }, [s]);
  const designActions = useDesignActions(s);
  // Dismissed designs stay hidden unless the member shows them.
  const [showDismissed, setShowDismissed] = useState(false);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const generate = useMutation(api.studio.generate);
  const retryBatch = useMutation(api.studio.retryBatch);
  const startRemix = useMutation(api.studio.startRemix);
  const upload = useAction(api.imageGen.uploadInspiration);
  const adopt = useMutation(api.images.adopt);
  const markStyle = useMutation(api.images.markStyle);
  const palette: Palette = useQuery(convexQuery(api.merch.palette, {})).data?.colors ?? GARMENT_COLORS;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const shirtHex = useCallback((hex: string) => nearestGarmentColor(hex, paletteRef.current).hex, []);

  const [instruction, setInstruction] = useState("");
  // A remix's new words, by field id (components/studio/RemixWordInputs.tsx).
  const [words, setWords] = useState<Record<string, string>>({});
  // A remix's filled-in parts, by part id (components/studio/RemixPartInputs.tsx).
  const [partValues, setPartValues] = useState<Record<string, PartValue>>({});
  // The design whose remixable parts are being set up ("Make it remixable"), with its tile when
  // it came from one (trying it as a remix starts from the tile).
  const [settingUp, setSettingUp] = useState<{ generationId: Id<"generations">; tile?: Tile } | null>(null);
  const [color, setColor] = useState(START_COLOR);
  // Set once the member picks a color; until then image 1 suggests one.
  const colorPicked = useRef(false);
  const pickColor = (hex: string) => {
    colorPicked.current = true;
    setColor(hex);
  };
  // The starting color, and any color the studio picked before the palette loaded, snaps to the
  // active shirt's nearest color once it arrives (until the member picks one).
  useEffect(() => {
    if (colorPicked.current) return;
    setColor((current) => {
      const snapped = nearestGarmentColor(current, palette).hex;
      return snapped === current ? current : snapped;
    });
  }, [palette]);
  // Numbered images to work on, and the style mix. Nothing joins the mix unless the member adds it.
  const [images, setImages] = useState<Array<Slot>>([]);
  const [styles, setStyles] = useState<Array<StyleSlot>>([]);
  // A lone style sets the whole look whatever its slider says, so it sits at 100.
  useEffect(() => {
    if (styles.length === 1 && styles[0].weight !== 100) setStyles(loneStyleAtFull);
  }, [styles]);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // An admin's choice of image model; members always get GPT Image 2.5.
  const [engine, setEngine] = useState<Engine>("gpt");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<Tile | null>(null);
  // Publish buttons hide while an admin has publishing turned off.
  const canPublish = useQuery(convexQuery(api.publish.availability, {})).data?.publishing !== false;
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
  const partSlots = useMemo(() => Object.values(partValues).flatMap((value) => value.photos), [partValues]);
  const imageIds = useMemo(
    () => [...new Set([...images, ...styles, ...partSlots].map((slot) => slot.imageId).filter((id): id is Id<"userImages"> => Boolean(id)))],
    [images, styles, partSlots],
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
    setStyles((list) => loneStyleAtFull(list.filter((slot) => slot.id !== id)));
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
        imageProblem(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
        return;
      }
      const firstImage = !asStyle && current === 0;
      const prepared = [];
      for (const file of files.slice(0, room)) {
        try {
          prepared.push({ id: newSlotId(), ...(await prepareInspiration(file)) });
        } catch (err) {
          imageProblem(errorMessage(err));
        }
      }
      if (prepared.length === 0) return;
      const slots = prepared.map((p) => ({ id: p.id, previewUrl: p.previewUrl, uploading: true }));
      if (asStyle) {
        setStyles((list) => [...list, ...slots.map((slot) => ({ ...slot, weight: 100 }))]);
        setMixerOpen(true);
      } else {
        setImages((list) => [...list, ...slots]);
        // Image 1's own background suggests the shirt, as the nearest shirt color. Style images and
        // later images never change it, and neither does anything once the member has picked one.
        if (firstImage && !colorPicked.current) setColor(shirtHex(prepared[0].color));
      }
      if (files.length > room) imageProblem(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
      await Promise.all(
        prepared.map(async (p) => {
          try {
            const result = await upload({ bytes: p.bytes, contentType: p.contentType, asStyle });
            settle(p.id, result.imageId, asStyle);
          } catch (err) {
            dropSlot(p.id);
            imageProblem(errorMessage(err));
          }
        }),
      );
    },
    [upload, shirtHex],
  );

  // A design or a published work's art, brought in as an image or a style.
  const addExisting = useCallback(
    async (key: string, url: string, asStyle: boolean) => {
      const list = asStyle ? stylesRef.current : imagesRef.current;
      if (list.some((slot) => slot.previewUrl === url)) return;
      if (list.length >= (asStyle ? MAX_STYLES : MAX_IMAGES)) {
        imageProblem(asStyle ? `A mix holds up to ${MAX_STYLES} styles.` : `Use up to ${MAX_IMAGES} images.`);
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
        imageProblem(errorMessage(err));
      }
    },
    [adopt],
  );

  // Moving between sessions (or back to a blank studio) clears the form, except when the studio
  // itself just opened the session (first batch or a remix link), which keeps what's in the form.
  const adopted = useRef<string | undefined>(undefined);
  const seeded = useRef<string | undefined>(undefined);
  useEffect(() => {
    setShowDismissed(false);
    if (s && s === adopted.current) {
      seeded.current = s;
      return;
    }
    seeded.current = undefined;
    setImages([]);
    setStyles([]);
    setInstruction("");
    setWords({});
    setPartValues({});
    setColor(START_COLOR);
    colorPicked.current = false;
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
      // Stored colors snap to the shirts on offer now, which may have changed since.
      setColor(shirtHex(last.backgroundColor));
      setImages(
        last.images.flatMap((image) => {
          const previewUrl = image.thumbUrl ?? image.url;
          return previewUrl ? [{ id: newSlotId(), imageId: image.imageId, previewUrl, uploading: false }] : [];
        }),
      );
      setStyles(
        loneStyleAtFull(
          last.styles.flatMap((style) => {
            const previewUrl = style.thumbUrl ?? style.url;
            return previewUrl ? [{ id: newSlotId(), imageId: style.imageId, previewUrl, uploading: false, weight: style.weight }] : [];
          }),
        ),
      );
      if (last.legacyKey && last.legacyUrl) void addExisting(last.legacyKey, last.legacyUrl, false);
    } else if (session.remix) {
      const { artKey, artThumbUrl, artUrl, backgroundColor } = session.remix;
      const preview = artThumbUrl ?? artUrl;
      if (artKey && preview) {
        setColor(shirtHex(backgroundColor));
        void addExisting(artKey, preview, false);
      }
    }
  }, [s, session, addExisting, shirtHex]);
  // A session that isn't the member's (or no longer exists) falls back to a blank studio. The query
  // answers null until the page's sign-in token reaches Convex, so only "missing" counts.
  useEffect(() => {
    if (s && sessionQuery.data && "missing" in sessionQuery.data) void navigate({ to: "/studio", search: {}, replace: true });
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
        setWords({});
        setPartValues({});
        // The original's shirt, as the nearest shirt on offer now (an older design may use one
        // that's no longer offered).
        setColor(shirtHex(result.backgroundColor));
        const preview = result.artThumbUrl ?? result.artUrl;
        if (result.artKey && preview) void addExisting(result.artKey, preview, false);
        void navigate({ to: "/studio", search: { s: result.sessionId }, replace: true });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [remix, viewer?.username, startRemix, addExisting, navigate, shirtHex]);

  const openSession = (sessionId: string) => {
    void navigate({ to: "/studio", search: { s: sessionId } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const useAsImage = (tile: Tile) => {
    const preview = tile.thumbUrl ?? tile.url;
    if (!tile.key || !preview) return;
    if (imagesRef.current.length === 0 && !colorPicked.current) setColor(shirtHex(tile.backgroundColor));
    void addExisting(tile.key, preview, false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // A fresh prompt in this session, starting from one design: it becomes image 1, and the request,
  // the other images, and the style mix clear. The design's shirt color comes along.
  const startFrom = (tile: Tile, next?: { instruction?: string; color?: string }) => {
    const preview = tile.thumbUrl ?? tile.url;
    if (!tile.key || !preview) return;
    const id = newSlotId();
    imagesRef.current = [{ id, previewUrl: preview, uploading: true }];
    stylesRef.current = [];
    setImages(imagesRef.current);
    setStyles([]);
    setMixerOpen(false);
    setInstruction(next?.instruction ?? "");
    setWords({});
    setPartValues({});
    setError(null);
    colorPicked.current = Boolean(next?.color);
    setColor(next?.color ?? shirtHex(tile.backgroundColor));
    adopt({ key: tile.key, asStyle: false })
      .then((imageId) => settle(id, imageId, false))
      .catch((err) => {
        dropSlot(id);
        setError(errorMessage(err));
      });
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => instructionRef.current?.focus({ preventScroll: true }));
  };
  // A fresh request on a design whose words came out misspelled, fixing only its lettering.
  const fixSpelling = (tile: Tile) => {
    if (tile.spelling?.length) startFrom(tile, { instruction: fixSpellingRequest(tile.spelling) });
  };
  const useAsStyle = (tile: Tile) => {
    const preview = tile.thumbUrl ?? tile.url;
    if (!tile.key || !preview) return;
    void addExisting(tile.key, preview, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addImageLook = (slot: Slot) => {
    if (!slot.imageId || stylesRef.current.length >= MAX_STYLES) return;
    if (stylesRef.current.some((style) => style.imageId === slot.imageId)) return;
    setStyles((list) => [...list, { id: newSlotId(), imageId: slot.imageId, previewUrl: slot.previewUrl, uploading: false, weight: 100 }]);
  };
  const pickStyle = (image: { imageId: Id<"userImages">; url?: string; thumbUrl?: string }) => {
    const previewUrl = image.thumbUrl ?? image.url;
    if (!previewUrl || stylesRef.current.length >= MAX_STYLES) return;
    if (stylesRef.current.some((style) => style.imageId === image.imageId)) return;
    setStyles((list) => [...list, { id: newSlotId(), imageId: image.imageId, previewUrl, uploading: false, weight: 100 }]);
    setMixerOpen(true);
    setLibraryOpen(false);
    void markStyle({ imageId: image.imageId }).catch(() => undefined);
  };

  const applyIdea = (idea: string) => {
    setInstruction(idea);
    setError(null);
    setShowIdeas(false);
  };
  // A hint joins whatever the request already says.
  const addHint = (hint: string) => {
    setInstruction((current) => {
      const text = current.trim();
      if (!text) return `${hint}.`;
      return `${text}${/[.!?]$/u.test(text) ? "" : "."} ${hint}.`;
    });
    setError(null);
    instructionRef.current?.focus({ preventScroll: true });
  };

  // A remix of a design, while its art is still image 1: its remixable words and parts as inputs.
  // The same for the member's own design tried as a remix (&try=).
  const remixInfo = session?.remix;
  const remixWords = useQuery(convexQuery(api.remixFields.forWork, remixInfo ? { workId: remixInfo.workId } : "skip")).data;
  const remixPartList = useQuery(convexQuery(api.remixParts.forWork, remixInfo ? { workId: remixInfo.workId } : "skip")).data;
  const tryId = search.try as Id<"generations"> | undefined;
  const tryInfo = useQuery(convexQuery(api.remixParts.forDesign, tryId ? { generationId: tryId } : "skip")).data;
  const firstKey = statusList?.find((image) => image.imageId === images[0]?.imageId)?.key;
  const onTryArt = Boolean(tryInfo && firstKey === tryInfo.artKey);
  const onRemixArt = Boolean(remixInfo?.artKey && firstKey === remixInfo.artKey);
  const wordFields = onTryArt && tryInfo ? tryInfo.fields : onRemixArt ? (remixWords?.fields ?? []) : [];
  const partList: Array<PublicPart> = onTryArt && tryInfo ? tryInfo.parts : onRemixArt ? (remixPartList?.parts ?? []) : [];
  const askedWords = changedWords(wordFields, words);
  const askedParts = partEntries(partList, partValues);
  const needPhotos = missingPhotos(partList, partValues);
  const remixForm = wordFields.length > 0 || partList.length > 0;
  const nothingToChange = remixForm && askedWords.length === 0 && askedParts.length === 0 && !instruction.trim();

  // Photos for a remix's parts: uploaded like any image, kept with their part.
  const addPartFiles = async (partId: string, files: Array<File>) => {
    if (files.length === 0) return;
    setError(null);
    const prepared: Array<{ id: string } & Awaited<ReturnType<typeof prepareInspiration>>> = [];
    for (const file of files) {
      try {
        prepared.push({ id: newSlotId(), ...(await prepareInspiration(file)) });
      } catch (err) {
        imageProblem(errorMessage(err));
      }
    }
    if (prepared.length === 0) return;
    const edit = (change: (photos: Array<Slot>) => Array<Slot>) =>
      setPartValues((all) => {
        const current = all[partId] ?? { to: "", photos: [] };
        return { ...all, [partId]: { ...current, photos: change(current.photos) } };
      });
    edit((photos) => [...photos, ...prepared.map((p) => ({ id: p.id, previewUrl: p.previewUrl, uploading: true }))]);
    await Promise.all(
      prepared.map(async (p) => {
        try {
          const result = await upload({ bytes: p.bytes, contentType: p.contentType, asStyle: false });
          // The same photo twice in one part counts once.
          edit((photos) =>
            photos.some((slot) => slot.id !== p.id && slot.imageId === result.imageId)
              ? photos.filter((slot) => slot.id !== p.id)
              : photos.map((slot) => (slot.id === p.id ? { ...slot, imageId: result.imageId, uploading: false } : slot)),
          );
        } catch (err) {
          edit((photos) => photos.filter((slot) => slot.id !== p.id));
          imageProblem(errorMessage(err));
        }
      }),
    );
  };
  const removePartPhoto = (partId: string, slotId: string) =>
    setPartValues((all) => {
      const current = all[partId];
      return current ? { ...all, [partId]: { ...current, photos: current.photos.filter((slot) => slot.id !== slotId) } } : all;
    });
  const setPartTo = (partId: string, to: string) =>
    setPartValues((all) => ({ ...all, [partId]: { ...(all[partId] ?? { to: "", photos: [] }), to } }));

  // "Make it remixable", then "Try it as a remix": the design becomes image 1 with its parts' form.
  const tryAsRemix = (tile: Tile) => {
    setSettingUp(null);
    startFrom(tile);
    void navigate({ to: "/studio", search: { s, try: tile.generationId } });
  };

  const uploading = [...images, ...styles, ...partSlots].some((slot) => slot.uploading || !slot.imageId);
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy || uploading) return;
    if (!instruction.trim() && images.length === 0 && !styles.some((style) => style.weight > 0)) {
      setError("Say what to make, or add an image.");
      return;
    }
    if (nothingToChange) {
      setError("Change some words or parts, or say what else to change.");
      return;
    }
    if (needPhotos.length > 0) {
      setError(`Add a photo for ${needPhotos.join(" and ")}.`);
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
        ...(askedWords.length > 0 ? { words: askedWords } : {}),
        ...(askedParts.length > 0 ? { parts: askedParts } : {}),
        ...(onTryArt && tryId ? { tryDesign: tryId } : {}),
        ...(viewer?.canPickModel && engine !== "gpt" ? { engine } : {}),
      });
      if ("refused" in result) {
        setError(refusalMessage(result.refused));
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

  const batches = session ? batchPages.results : [];

  // "Try again" on a batch that didn't work: the same request runs again, and its designs land on top.
  const batchesTop = useRef<HTMLElement>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const tryAgain = async (batchId: Id<"batches">) => {
    if (retrying) return;
    setRetrying(batchId);
    try {
      const result = await retryBatch({ batchId });
      if ("refused" in result) toast(refusalMessage(result.refused));
      else batchesTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setRetrying(null);
    }
  };
  const favorites = s ? favoritePages.results : [];

  // Back to the studio itself from the viewer, and from Compare under it.
  const leaveViewer = () => {
    if (compareRoute.ids) {
      viewerRoute.hide();
      compareRoute.dismiss();
    } else {
      viewerRoute.close();
    }
  };
  // B in the viewer: the design becomes an image to work on, ready for what should change.
  const branch = (tile: Tile) => {
    leaveViewer();
    useAsImage(tile);
    window.requestAnimationFrame(() => instructionRef.current?.focus({ preventScroll: true }));
  };
  const reject = (tile: Tile, rejected: boolean) => designActions.setRejected(tile.generationId, rejected, tile.favorite);

  const pick = (tile: Tile) => {
    const next = togglePick(picks, tile.generationId);
    if (next.full) toast(`Compare holds up to ${COMPARE_MAX} designs. Take one out first.`);
    setPicks(next.picks);
  };
  const startCompare = () => {
    if (!canCompare(picks)) return;
    viewerRoute.hide();
    compareRoute.open(picks);
    setPicks([]);
    setPicking(false);
  };
  // Compare's designs: the ones already on the page, and the rest (from a link) fetched.
  const compareFetched = useQuery(
    convexQuery(api.studio.compareDesigns, s && compareRoute.ids ? { sessionId: s, generationIds: compareRoute.ids } : "skip"),
  ).data;
  const compareTiles = useMemo(() => {
    if (!compareRoute.ids) return [];
    const known = new Map<string, Tile>();
    for (const tile of compareFetched ?? []) known.set(tile.generationId, tile);
    for (const tile of favorites) known.set(tile.generationId, tile);
    for (const batch of batches) for (const tile of batch.tiles) known.set(tile.generationId, tile);
    return compareRoute.ids.flatMap((id) => {
      const tile = known.get(id);
      return tile && tile.status === "succeeded" && tile.url ? [tile] : [];
    });
  }, [compareRoute.ids, compareFetched, favorites, batches]);

  const count = images.length;
  const ink = inkOn(color);
  const picked: Engine = viewer?.canPickModel ? engine : "gpt";
  const batchCredits = engineMakesGrid(picked) ? BATCH_CREDITS : DESIGNS_PER_BATCH;
  const outOfCredits = Boolean(viewer && !viewer.unlimited && viewer.credits < batchCredits);
  const loadingSession = Boolean(s && session === undefined);

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className={cn("px-4 md:px-10", favorites.length > 0 ? "pb-40" : "pb-24")}>
        <section className="grid grid-cols-1 gap-8 pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:pt-10">
          <div className="flex min-w-0 flex-col gap-6">
            <h1 className="text-[18vw] font-black leading-[0.8] tracking-[-0.06em] md:text-[9.5vw]">Studio</h1>
            {session ? (
              <div className="flex flex-col gap-4">
                <SessionTitle key={session.sessionId} sessionId={session.sessionId} name={session.name} batches={session.batchCount} />
                {remixInfo && (
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-2"
                      style={{ background: remixInfo.backgroundColor }}
                    >
                      <Art url={remixInfo.artThumbUrl ?? remixInfo.artUrl} alt={`CR ${remixInfo.cr}`} className="h-full w-auto max-w-full object-contain" />
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
                {onTryArt && tryId && (
                  <div className="rounded-2xl border-2 border-black p-4">
                    <p className="text-sm font-bold uppercase tracking-wider">Trying it as a remix</p>
                    <p className="mt-1 text-sm text-neutral-600">
                      This is the form people get when they remix this design. Fill it in and generate to test your parts.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setSettingUp({ generationId: tryId })}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white"
                      >
                        Edit parts
                      </button>
                      <Link to="/studio" search={{ s }} className="text-sm font-semibold underline underline-offset-4">
                        Stop trying
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ) : remix && !error ? (
              // A remix link before its session exists (studio.startRemix is on its way).
              <p className="animate-pulse text-lg font-semibold" role="status">
                Opening CR {remix} to remix…
              </p>
            ) : (
              !loadingSession && <p className="text-lg text-neutral-600">New design. Your sessions are below.</p>
            )}
            {viewer?.isJudge && <JudgeWelcome />}
          </div>

          <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
            <ImageTray
              images={images}
              states={states}
              color={color}
              ink={ink}
              palette={palette}
              onColor={pickColor}
              onFiles={(files) => void addFiles(files, false)}
              onRemove={(id) => setImages((list) => list.filter((slot) => slot.id !== id))}
            />

            {wordFields.length > 0 && (
              <RemixWordInputs fields={wordFields} values={words} onChange={(id, text) => setWords((current) => ({ ...current, [id]: text }))} />
            )}
            {partList.length > 0 && (
              <RemixPartInputs
                parts={partList}
                values={partValues}
                states={states}
                onTo={setPartTo}
                onFiles={(id, files) => void addPartFiles(id, files)}
                onRemovePhoto={removePartPhoto}
              />
            )}

            <label className="block">
              <span className="text-sm font-bold uppercase tracking-wider">
                {remixForm ? "Anything else to change? (optional)" : count === 0 ? "What do you want to make?" : "What should change?"}
              </span>
              <textarea
                ref={instructionRef}
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
                    : wordFields.length > 0
                      ? "Colors, characters, the mood…"
                      : count === 1
                      ? "Change the words, colors, characters…"
                      : `Refer to them as ${listNames(count)}…`
                }
                className="mt-2 w-full resize-none border-b-4 border-black bg-transparent py-2 text-2xl font-semibold leading-tight outline-none placeholder:text-neutral-300 md:text-3xl"
              />
            </label>

            {count >= 2 && wordFields.length === 0 && (
              <div>
                <span className="text-sm font-bold uppercase tracking-wider">Try</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {IMAGE_HINTS.map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      onClick={() => addHint(hint)}
                      className="min-h-10 rounded-xl bg-neutral-100 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-black hover:text-white"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {count === 0 && ideas && (
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-bold uppercase tracking-wider">Need an idea?</span>
                  <span className="-my-3 flex gap-2 text-sm font-semibold">
                    <button type="button" onClick={() => setIdeas(pickIdeas(3, ideas))} className="inline-flex min-h-10 items-center px-1 underline underline-offset-4">
                      Shuffle
                    </button>
                    <button type="button" onClick={() => setShowIdeas(true)} className="inline-flex min-h-10 items-center px-1 underline underline-offset-4">
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
                      className="min-h-10 rounded-xl bg-neutral-100 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-black hover:text-white"
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
              onRemove={(id) => setStyles((list) => loneStyleAtFull(list.filter((slot) => slot.id !== id)))}
              onAddImage={addImageLook}
              onBrowse={() => setLibraryOpen(true)}
              onFiles={(files) => void addFiles(files, true)}
            />

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={busy || uploading || outOfCredits || loadingSession || nothingToChange || wordsTooLong(wordFields, words)}
                className="h-16 rounded-2xl bg-black px-10 text-xl font-black text-white transition-transform hover:-translate-y-0.5 disabled:opacity-40"
              >
                {outOfCredits ? "Out of credits" : busy ? "Starting…" : uploading ? "Uploading…" : "Generate 4"}
              </button>
              <span className="text-sm text-neutral-600">
                {viewer?.unlimited ? "Unlimited" : `${viewer?.credits ?? 0} credits · ${batchCredits} per batch`}
              </span>
              {viewer?.canPickModel && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-bold">Model</span>
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as Engine)}
                    className="h-10 rounded-xl border-2 border-black bg-white px-2 font-semibold"
                    aria-label="Image model (admins only)"
                  >
                    {ENGINES.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-neutral-500">Admins only</span>
                </label>
              )}
            </div>
            {error && (
              <p role="alert" className="text-base font-semibold text-red-600">
                {error}
              </p>
            )}
          </form>
        </section>

        <section ref={batchesTop} className="mt-16 flex scroll-mt-24 flex-col gap-14">
          {!s && <SessionList onOpen={openSession} />}
          {s && session !== null && batchPages.status === "LoadingFirstPage" && <BatchSkeleton />}
          <AnimatePresence initial={false}>
            {batches.map((batch) => (
              <m.div
                key={batch.batchId}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-black pt-3">
                  <span className="h-4 w-4 shrink-0 border border-black" style={{ background: batch.backgroundColor }} />
                  {batch.images.length > 0 && (
                    <span className="flex shrink-0 items-center gap-1">
                      {batch.images.map((image, i) =>
                        image.design ? (
                          <ParentDesign
                            key={i}
                            image={image}
                            design={image.design}
                            here={image.design.sessionId === s}
                            onOpen={(view) => viewerRoute.open({ view, scope: "session" })}
                          />
                        ) : (
                          <span key={i} className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-black bg-neutral-100">
                            <Art url={image.thumbUrl ?? image.url} alt={`Image ${i + 1}`} className="max-h-full max-w-full object-contain" />
                          </span>
                        ),
                      )}
                    </span>
                  )}
                  <p className="min-w-0 flex-1 truncate text-base font-semibold">
                    {batch.wordChanges?.length || batch.parts ? (
                      <>
                        {batch.tried && <span className="font-normal text-neutral-500">Trying as a remix · </span>}
                        {batch.wordChanges?.length ? <>Changed the words: {changeSummary(batch.wordChanges)}</> : null}
                        {batch.wordChanges?.length && batch.parts ? " · " : null}
                        {batch.parts ? <>{batch.parts}</> : null}
                        {batch.instruction && <span className="font-normal text-neutral-500"> · {batch.instruction}</span>}
                      </>
                    ) : (
                      <>
                        {batch.tried && <span className="font-normal text-neutral-500">Trying as a remix · </span>}
                        {batch.instruction || "From your images"}
                      </>
                    )}
                    {batch.presets.length > 0 && <span className="font-normal text-neutral-500"> · {batch.presets.join(", ")}</span>}
                  </p>
                  {batch.styles.length > 0 && (
                    <span className="flex shrink-0 items-center gap-2 text-sm text-neutral-500">
                      Style
                      <StyleChips items={batch.styles.map((style) => ({ url: style.thumbUrl ?? style.url, share: style.share, job: style.job }))} />
                    </span>
                  )}
                  {batch.engine && <span className="shrink-0 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-bold">{batch.engine}</span>}
                  {batch.tiles.some((t) => t.status === "queued" || t.status === "dispatched") && (
                    <Elapsed since={batch.createdAt} />
                  )}
                  {batch.refunded ? (
                    <span className="shrink-0 text-sm font-semibold text-neutral-500">
                      {batch.refunded} {batch.refunded === 1 ? "credit" : "credits"} back
                    </span>
                  ) : null}
                  {batch.tiles.length > 0 && batch.tiles.every(isFailed) ? (
                    batch.retried ? (
                      <span className="shrink-0 text-sm font-semibold text-neutral-500">Tried again</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void tryAgain(batch.batchId)}
                        disabled={retrying !== null}
                        className="inline-flex h-10 shrink-0 items-center rounded-xl bg-black px-4 text-sm font-black text-white transition-transform active:scale-95 disabled:opacity-50"
                      >
                        {retrying === batch.batchId ? "Trying…" : "Try again"}
                      </button>
                    )
                  ) : null}
                  <DismissedToggle
                    count={batch.tiles.filter((tile) => tile.rejected).length}
                    shown={showDismissed}
                    onToggle={() => setShowDismissed(!showDismissed)}
                  />
                </div>
                {batch.tiles.some((t) => t.status === "queued" || t.status === "dispatched") && (
                  <DesignHint since={batch.createdAt} withImages={batch.images.length > 0 || batch.styles.length > 0} />
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                  {batch.tiles
                    .filter((tile) => showDismissed || !tile.rejected)
                    .map((tile) => (
                      <TileCard
                        key={tile.generationId}
                        tile={tile}
                        grid={batch.grid}
                        onOpen={() => viewerRoute.open({ view: tile.generationId, scope: "batch" })}
                        onPublish={canPublish ? () => setPublishing(tile) : undefined}
                        onStartFrom={() => startFrom(tile)}
                        onFixSpelling={() => fixSpelling(tile)}
                        onRemixable={() => setSettingUp({ generationId: tile.generationId, tile })}
                        onInspire={() => useAsImage(tile)}
                        onStyle={() => useAsStyle(tile)}
                        onFavorite={(on) => designActions.setFavorite(tile.generationId, on)}
                        onReject={(rejected) => reject(tile, rejected)}
                      />
                    ))}
                </div>
              </m.div>
            ))}
          </AnimatePresence>
          {session && batchPages.status === "LoadingMore" && <BatchSkeleton />}
          {session && <LoadMore status={batchPages.status} onMore={() => batchPages.loadMore(PAGE.batches)} label="Show older batches" />}
          {session && batchPages.status === "Exhausted" && batches.length === 0 && (
            <p className="max-w-lg text-lg text-neutral-500">
              Designs in this session show up here, four at a time, newest on top. Heart the ones you like, then publish one to get its CR number.
            </p>
          )}
        </section>
      </main>

      <AnimatePresence>
        {s && favorites.length > 0 && (
          <FavoritesTray
            favorites={favorites}
            status={favoritePages.status}
            onMore={() => favoritePages.loadMore(PAGE.favorites)}
            onOpen={(tile) => viewerRoute.open({ view: tile.generationId, scope: "favorites" })}
            picking={picking || picks.length > 0}
            picks={picks}
            onStartPicking={() => setPicking(true)}
            onPick={pick}
            onCompare={startCompare}
            onStopPicking={() => {
              setPicks([]);
              setPicking(false);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s && compareRoute.ids && (
          <Compare
            tiles={compareTiles}
            missing={compareFetched !== undefined && compareTiles.length < compareRoute.ids.length}
            active={!viewerRoute.spot}
            onRemove={(tile) => compareRoute.remove(tile.generationId)}
            onOpen={(tile) =>
              viewerRoute.open({ view: tile.generationId, scope: tile.favorite && !tile.rejected ? "favorites" : "batch" })
            }
            onClose={compareRoute.close}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s && viewerRoute.spot && (
          <Viewer
            sessionId={s}
            spot={viewerRoute.spot}
            batches={batches}
            batchesStatus={batchPages.status}
            onMoreBatches={() => batchPages.loadMore(PAGE.batches)}
            favorites={favorites}
            favoritesStatus={favoritePages.status}
            onMoreFavorites={() => favoritePages.loadMore(PAGE.favorites)}
            showRejected={showDismissed}
            onShowRejected={setShowDismissed}
            onMove={viewerRoute.move}
            onClose={viewerRoute.close}
            onFavorite={(tile, on) => designActions.setFavorite(tile.generationId, on)}
            onReject={reject}
            onBranch={branch}
            onStartFrom={(tile) => {
              leaveViewer();
              startFrom(tile);
            }}
            onFixSpelling={(tile) => {
              leaveViewer();
              fixSpelling(tile);
            }}
            onRemixable={(tile) => {
              leaveViewer();
              setSettingUp({ generationId: tile.generationId, tile });
            }}
            onStyle={(tile) => {
              leaveViewer();
              useAsStyle(tile);
            }}
            onPublish={
              canPublish
                ? (tile) => {
                    leaveViewer();
                    setPublishing(tile);
                  }
                : undefined
            }
            picks={picks}
            onPick={pick}
            onCompare={startCompare}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {publishing && (
          <PublishDialog
            tile={publishing}
            onClose={() => setPublishing(null)}
            onFixSpelling={() => {
              const tile = publishing;
              setPublishing(null);
              fixSpelling(tile);
            }}
            onAdapt={(shirt) => {
              const tile = publishing;
              setPublishing(null);
              // A version for a shirt the design gets lost on, made in this session's thread.
              // Tried 2026-10-06 on a gray pencil-sketch wolf for Moss: the first wording ("keep the
              // same design, words, and layout") read clearly in all four but added mountains, pines,
              // feathers, or a moon behind three of them. Saying "change nothing else" keeps it.
              startFrom(tile, {
                instruction: `Make a version of image 1 for a ${shirt.name.toLowerCase()} shirt: keep exactly the same design, words, layout, and drawing, and only recolor or outline the parts that would get lost on ${shirt.name.toLowerCase()}, so every part reads clearly on it. Add nothing new.`,
                color: shirt.hex,
              });
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {settingUp && (
          <RemixSetupSheet
            generationId={settingUp.generationId}
            onTry={() => {
              const tile = settingUp.tile;
              if (tile && !(tryId === settingUp.generationId && onTryArt)) tryAsRemix(tile);
              else setSettingUp(null);
            }}
            onClose={() => setSettingUp(null)}
          />
        )}
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

function IdeasSheet({ onPick, onClose }: { onPick: (idea: string) => void; onClose: () => void }) {
  useReturnFocus();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <m.div
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
      <m.div
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
      </m.div>
    </m.div>
  );
}

// A batch still loading: its line and four grey squares, laid out like the real thing.
// Why a batch didn't start.
function refusalMessage(refused: "NO_CREDITS" | "GENERATION_OFF" | "BUDGET") {
  if (refused === "NO_CREDITS") return "You're out of credits for today.";
  if (refused === "BUDGET") return "The studio is resting until tomorrow. Your credits are safe.";
  return "Generation is paused right now.";
}

function BatchSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 flex items-center gap-3 border-t-2 border-neutral-200 pt-3">
        <Skeleton className="h-4 w-4 rounded-none" />
        <Skeleton className="h-5 w-1/2 max-w-sm rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="aspect-square" />
        ))}
      </div>
    </div>
  );
}

// The design a batch started from ("Use as image"), on the batch's line: a thumbnail over its own
// background color that opens it, in the viewer here or in the session it came from.
function ParentDesign({
  image,
  design,
  here,
  onOpen,
}: {
  image: { url?: string; thumbUrl?: string };
  design: { generationId: string; sessionId: string; backgroundColor: string };
  here: boolean;
  onOpen: (view: string) => void;
}) {
  const className =
    "flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-black py-0.5 pl-2 pr-0.5 text-sm font-bold transition-transform hover:-translate-y-0.5";
  const content = (
    <>
      From
      <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md" style={{ background: design.backgroundColor }}>
        <Art url={image.thumbUrl ?? image.url} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    </>
  );
  return here ? (
    <button type="button" onClick={() => onOpen(design.generationId)} className={className} title="Open the design this started from">
      {content}
    </button>
  ) : (
    <Link
      to="/studio"
      search={{ s: design.sessionId, view: design.generationId, scope: "batch" }}
      className={className}
      title="Open the design this started from"
    >
      {content}
    </Link>
  );
}

// "Show 2 dismissed" on a batch's line, when it has any.
function DismissedToggle({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" onClick={onToggle} className="shrink-0 text-sm font-semibold text-neutral-500 underline underline-offset-4 hover:text-black">
      {shown ? "Hide dismissed" : `Show ${count} dismissed`}
    </button>
  );
}

function TileCard({
  tile,
  grid,
  onOpen,
  onPublish,
  onStartFrom,
  onFixSpelling,
  onRemixable,
  onInspire,
  onStyle,
  onFavorite,
  onReject,
}: {
  tile: Tile;
  // Grid batches give credits back per batch (shown on the batch line), not per design.
  grid: boolean;
  onOpen: () => void;
  // Absent while publishing is turned off.
  onPublish?: () => void;
  onStartFrom: () => void;
  onFixSpelling: () => void;
  onRemixable: () => void;
  onInspire: () => void;
  onStyle: () => void;
  onFavorite: (favorite: boolean) => void;
  onReject: (rejected: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = tile.status === "succeeded";
  const failed = isFailed(tile);
  const ink = inkOn(tile.backgroundColor);
  const corner = "absolute bottom-2 right-2 rounded-lg px-2.5 py-1.5 text-xs font-black";
  const pending = !ready && !failed;
  return (
    <div
      className="group relative aspect-square overflow-hidden rounded-2xl"
      // While it's designing, a faint outline keeps the tile visible on a page of the same color.
      style={{ background: tile.backgroundColor, color: ink, boxShadow: pending ? `inset 0 0 0 1px ${ink}24` : undefined }}
    >
      {ready ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center p-[6%]" aria-label="View large">
          <Art
            url={tile.mediumUrl ?? tile.url}
            alt="Design"
            className={cn(
              "h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]",
              tile.rejected && "opacity-40",
            )}
          />
        </button>
      ) : failed && tile.blocked ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center md:p-4">
          <span className="text-lg font-black leading-tight">Blocked by filter</span>
          {/* Full ink: small text at partial opacity drops under 4.5:1 on mid-tone backgrounds. */}
          <span className="mt-1 max-w-[16rem] text-xs">
            Shittles, this got flagged for some reason. Please try again if you think we got this wrong.
            {grid ? "" : " Credit’s back."}
          </span>
        </div>
      ) : failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <span className="text-lg font-black">Didn’t work</span>
          <span className="mt-1 line-clamp-3 text-xs">
            {tile.error ?? "Try again."}
            {grid ? "" : " Credit refunded."}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0" aria-label="Designing" role="status">
          <m.div
            aria-hidden
            className="absolute inset-y-0 left-0 w-2/3"
            style={{ background: `linear-gradient(100deg, transparent, ${ink}12, transparent)` }}
            initial={{ x: "-100%" }}
            animate={{ x: "160%" }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.3 }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <m.span
              aria-hidden
              className="h-3 w-3"
              style={{ background: ink }}
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          </div>
        </div>
      )}
      {ready && (
        <>
          <DesignMenu
            items={designItems(tile, {
              onOpen,
              onPublish,
              onStartFrom,
              onFixSpelling,
              onRemixable,
              onInspire,
              onStyle,
              onReject: () => onReject(!tile.rejected),
            })}
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
            onClick={() => onFavorite(!tile.favorite)}
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
          ) : tile.keptId ? (
            <Link
              to="/keep/$workId"
              params={{ workId: tile.keptId }}
              className="absolute bottom-2 left-2 rounded-lg bg-black px-2 py-1 text-xs font-black text-white"
            >
              Kept
            </Link>
          ) : onPublish && !tile.rejected ? (
            <button
              type="button"
              onClick={onPublish}
              className="absolute bottom-2 left-2 rounded-lg bg-black px-3 py-1.5 text-xs font-black text-white opacity-100 transition-opacity hover:bg-neutral-800 md:opacity-0 md:group-hover:opacity-100"
            >
              Publish
            </button>
          ) : null}
          {tile.spelling && tile.spelling.length > 0 && !tile.publishedCr && !tile.keptId && (
            <button
              type="button"
              onClick={onOpen}
              title={spellingNote(tile.spelling)}
              aria-label={`Check the spelling. ${spellingNote(tile.spelling)}`}
              // Short enough to sit between the ⋯ menu and the heart on a 360 px phone's tile.
              className="absolute left-1/2 top-2 flex h-10 -translate-x-1/2 items-center whitespace-nowrap rounded-lg bg-amber-300 px-2 text-xs font-black text-black"
            >
              Typo?
            </button>
          )}
          {tile.model && (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white md:group-hover:opacity-0">
              {tile.model}
            </span>
          )}
        </>
      )}
      {tile.rejected ? (
        <button type="button" onClick={() => onReject(false)} className={cn(corner, "bg-white text-black ring-1 ring-black/20")}>
          Bring back
        </button>
      ) : (
        (ready || failed) && (
          <button
            type="button"
            onClick={() => onReject(true)}
            className={cn(
              corner,
              "border-2 border-current transition-opacity",
              failed ? "" : "hidden opacity-0 md:block md:group-hover:opacity-100 md:focus-visible:opacity-100",
            )}
            aria-label="Dismiss this design"
          >
            Dismiss
          </button>
        )
      )}
    </div>
  );
}

// Under a batch that's still designing: how long it usually takes, once the wait is long enough to
// wonder (designs with images take about twice as long as from words alone).
function DesignHint({ since, withImages }: { since: number; withImages: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = (now - since) / 1000;
  if (seconds < 15) return null;
  return (
    <p className="-mt-1 mb-3 text-sm text-neutral-500">
      {seconds < 120
        ? withImages
          ? "Designs with images usually take about a minute. All four arrive together."
          : "Usually about 30 seconds. All four arrive together."
        : "Taking longer than usual. They'll still arrive, and credits come back for any that don't."}
    </p>
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
