import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import * as m from "motion/react-m";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  GARMENT_COLORS,
  MAX_DESCRIPTION_LENGTH,
  MAX_OFFERED_COLORS,
  defaultOfferedColors,
  garmentColor,
  visibilityOn,
} from "../../../convex/lib/garments";
import { ChestMarkPreview, GarmentPreview, useImageAspect } from "./GarmentPreview";
import { PrintChoices, areaOn, placementOn } from "./PrintChoices";
import type { Palette, Visibility } from "../../../convex/lib/garments";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RemixKind } from "~/components/cr/RemixKindChoice";
import type { SpellingMiss } from "~/lib/spelling";
import type { RelativePlacement } from "~/lib/print/shirtPlacement";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { RemixKindChoice } from "~/components/cr/RemixKindChoice";
import { RemixableParts } from "~/components/cr/RemixableParts";
import { useDesignPixels } from "~/lib/designPixels";
import { errorMessage, inkOn } from "~/lib/imagePrep";
import { spellingNote } from "~/lib/spelling";
import { garmentTones } from "~/lib/print/garmentMockup";
import { DEFAULT_PLACEMENT, toInches } from "~/lib/print/shirtPlacement";
import { cn, keepHyphens } from "~/lib/utils";

export type PublishTile = {
  generationId: Id<"generations">;
  url?: string;
  mediumUrl?: string;
  thumbUrl?: string;
  backgroundColor: string;
  // Asked-for words it drew a letter or two off (convex/spelling.ts).
  spelling?: Array<SpellingMiss>;
};

// One sheet: title, a short note, the shirt colors (with a live preview on each and a heads-up
// where the design would get lost), the products it comes on and where it sits on them (shown on a
// drawn garment at real size), the CR number it will get, and for a remix how it relates. Only
// confirming is required.
export function PublishDialog({
  tile,
  onClose,
  onAdapt,
  onFixSpelling,
}: {
  tile: PublishTile;
  onClose: () => void;
  // Back to the studio with a request that fixes its misspelled words.
  onFixSpelling?: () => void;
  // "Make a version for Black": back to the studio with a new prompt for that shirt color.
  onAdapt?: (color: { name: string; hex: string }) => void;
}) {
  const publish = useMutation(api.publish.quick);
  const preview = useQuery(api.publish.preview, { generationId: tile.generationId });
  // The shirt colors on offer: the active shirt's (convex/merch.ts), or the launch colors.
  const paletteData = useQuery(api.merch.palette, {});
  const palette: Palette = paletteData?.colors ?? GARMENT_COLORS;
  const colorOf = (key: string) => garmentColor(key, palette);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // A remix is a variation unless it reads as a new design, when fork starts selected until the
  // member picks; if it couldn't be compared, variation starts selected
  // (components/cr/RemixKindChoice.tsx).
  const [pickedKind, setPickedKind] = useState<RemixKind | null>(null);
  // Share with the world (a CR number, the feed, anyone can order or remix it) or keep it just
  // for the member.
  const [audience, setAudience] = useState<"world" | "me">("world");
  const keep = audience === "me";
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ workId: Id<"works">; cr: string; lead: string; kept?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pixels = useDesignPixels(tile.thumbUrl ?? tile.mediumUrl ?? tile.url, tile.backgroundColor);
  const visibility = useMemo(() => {
    const map = new Map<string, Visibility>();
    if (pixels && pixels.all.length > 0) {
      for (const color of palette) map.set(color.key, visibilityOn(pixels.all, color.hex, pixels.edge));
    }
    return map;
  }, [pixels, palette]);

  // Starts from the design's own shade plus the defaults, skipping colors it would disappear on,
  // until the member picks for themselves.
  const [picked, setPicked] = useState<Array<string> | null>(null);
  const suggested = useMemo(() => {
    const hidden = new Set([...visibility].filter(([, seen]) => seen === "disappears").map(([key]) => key));
    return defaultOfferedColors(tile.backgroundColor, hidden, palette);
  }, [tile.backgroundColor, visibility, palette]);
  const selected = picked ?? suggested;
  const lead = selected[0];
  const [focus, setFocus] = useState<string | null>(null);
  const shown = colorOf(focus ?? lead ?? "") ?? colorOf(suggested[0]) ?? palette[0];

  // The products on offer (convex/merch.ts offered), and which ones it comes on: every product that
  // carries one of its colors until the member picks. One placement fits them all; a product can
  // be placed separately.
  const offered = useQuery(api.merch.offered, {});
  const products = useMemo(() => offered ?? [], [offered]);
  const [pickedProducts, setPickedProducts] = useState<Array<number> | null>(null);
  const chosenProducts =
    pickedProducts ??
    products
      .filter((product, index) => index === 0 || product.colors.some((color) => selected.includes(color.key)))
      .map((product) => product.productId);
  const [shared, setShared] = useState<RelativePlacement>(DEFAULT_PLACEMENT);
  const [own, setOwn] = useState<Record<number, RelativePlacement>>({});
  const [focusedProductId, setFocusedProductId] = useState<number | null>(null);
  const focusedProduct =
    products.find((product) => product.productId === focusedProductId) ??
    products.find((product) => chosenProducts.includes(product.productId)) ??
    products[0];
  const aspect = useImageAspect(tile.mediumUrl ?? tile.url);
  // Ticking a product shows it; unticking the one shown moves to another that's still picked.
  const toggleProduct = (productId: number) => {
    const on = chosenProducts.includes(productId);
    const next = on ? chosenProducts.filter((id) => id !== productId) : [...chosenProducts, productId];
    setPickedProducts(next);
    if (!on) setFocusedProductId(productId);
    else if (focusedProduct?.productId === productId && next.length > 0) setFocusedProductId(next[0]);
  };
  const changePlacement = (next: RelativePlacement) => {
    if (focusedProduct && focusedProduct.productId in own) setOwn({ ...own, [focusedProduct.productId]: next });
    else setShared(next);
  };
  const separate = (productId: number, on: boolean) => {
    const product = products.find((p) => p.productId === productId);
    if (!product) return;
    const next = { ...own };
    if (on) next[productId] = placementOn(product, shared, own);
    else delete next[productId];
    setOwn(next);
  };
  const previewPlacement = focusedProduct ? placementOn(focusedProduct, shared, own) : shared;
  // A remix starts from what its parent comes on and where it sits (once, before the member picks).
  const parentSetup = preview?.remix?.setup;
  const seeded = useRef(false);
  useEffect(() => {
    if (!parentSetup || seeded.current) return;
    seeded.current = true;
    if (pickedProducts !== null || Object.keys(own).length > 0 || parentSetup.printProducts.length === 0) return;
    setShared(parentSetup.printPlacement);
    setOwn(
      Object.fromEntries(
        parentSetup.printProducts.flatMap((pick) => (pick.placement ? [[pick.productId, pick.placement] as const] : [])),
      ),
    );
    setPickedProducts(parentSetup.printProducts.map((pick) => pick.productId));
  }, [parentSetup, pickedProducts, own]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (key: string) => {
    setFocus(key);
    if (selected.includes(key)) setPicked(selected.filter((k) => k !== key));
    else if (selected.length < MAX_OFFERED_COLORS) setPicked([...selected, key]);
  };
  const makeLead = (key: string) => setPicked([key, ...selected.filter((k) => k !== key)]);

  const isRemix = Boolean(preview?.remix);
  const relation = preview?.remix?.relation ?? { status: "words" as const };
  const forkOpen = relation.status === "fork" || relation.status === "failed";
  const remixKind: RemixKind = forkOpen ? (pickedKind ?? (relation.status === "fork" ? "fork" : "variation")) : "variation";

  // A remix that changed more than its words is compared with its original when the dialog opens
  // (convex/publish.ts checkRemix); the answer arrives through the preview.
  const checkRemix = useMutation(api.publish.checkRemix);
  const asked = useRef(false);
  const needsCheck = relation.status === "none" || relation.status === "pending" || relation.status === "failed";
  useEffect(() => {
    if (!needsCheck || asked.current) return;
    asked.current = true;
    void checkRemix({ generationId: tile.generationId }).catch(() => undefined);
  }, [needsCheck, checkRemix, tile.generationId]);
  const crPreview = preview ? (preview.remix && remixKind === "variation" ? preview.remix.variationCr : preview.newFamilyCr) : null;
  const paused = preview?.publishing === false;
  const lost = selected.filter((key) => visibility.get(key) === "disappears").map((key) => colorOf(key)?.name ?? key);
  const faint = selected.filter((key) => visibility.get(key) === "faint").map((key) => colorOf(key)?.name ?? key);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selected.length === 0 || paused || (offered && chosenProducts.length === 0)) return;
    setSaving(true);
    setError(null);
    try {
      const published = await publish({
        requestId,
        generationId: tile.generationId,
        title: title || undefined,
        description: description.trim() || undefined,
        remixKind: keep ? undefined : remixKind,
        offeredColors: selected,
        ...(keep ? { keep: "private" as const } : {}),
        ...(offered
          ? {
              printPlacement: shared,
              printProducts: chosenProducts.map((productId) =>
                productId in own ? { productId, placement: own[productId] } : { productId },
              ),
            }
          : {}),
      });
      setResult({ workId: published.workId, cr: published.cr, lead: colorOf(selected[0])?.hex ?? tile.backgroundColor, kept: published.kept });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (result?.kept) {
    return (
      <m.div
        className="fixed inset-0 z-50 flex flex-col justify-between gap-8 overflow-y-auto bg-black p-6 text-white md:p-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Kept"
      >
        <p className="text-sm font-bold uppercase tracking-[0.3em]">Kept just for you</p>
        <div className="flex flex-col items-start gap-6 md:flex-row md:items-end">
          <m.div
            className="flex h-56 w-56 shrink-0 items-center justify-center overflow-hidden rounded-3xl p-4 md:h-80 md:w-80"
            style={{ background: result.lead }}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 170, damping: 20 }}
          >
            <Art url={tile.mediumUrl ?? tile.url} alt="Design" className="h-full w-auto max-w-full object-contain" />
          </m.div>
          <div>
            {title && <p className="text-3xl font-bold md:text-5xl">{title}</p>}
            <p className="mt-3 max-w-md text-base text-neutral-300">
              Only you can see it. It's marked Kept in your studio, and you can share it with the world any time.
              {isRemix ? " The original's creator still gets credit." : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/keep/$workId" params={{ workId: result.workId }} className="rounded-2xl border-2 border-white bg-white px-7 py-4 text-base font-black text-black">
            View it
          </Link>
          <button type="button" onClick={onClose} className="rounded-2xl border-2 border-white px-7 py-4 text-base font-black">
            Keep creating
          </button>
        </div>
      </m.div>
    );
  }

  if (result) {
    return (
      <m.div
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
          <m.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 170, damping: 20 }}
          >
            <CrMark cr={result.cr} className="whitespace-nowrap text-[14vw] md:text-[16vw]" />
          </m.div>
          {title && (
            <m.p
              className="mt-4 text-3xl font-bold md:text-5xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
            >
              {title}
            </m.p>
          )}
        </div>
        {/* What people who remix it can change, once the words are read. */}
        <div className="max-w-xl empty:hidden">
          <RemixableParts target={{ workId: result.workId }} tone="dark" editing />
        </div>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-2"
              style={{ background: result.lead }}
            >
              <Art url={tile.mediumUrl ?? tile.url} alt="Design" className="h-full w-auto max-w-full object-contain" />
            </div>
            <p className="max-w-xs text-sm text-neutral-300">
              The model photo is developing. It appears on the feed in a minute or two.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/cr/$cr" params={{ cr: result.cr }} className="rounded-2xl border-2 border-white bg-white px-7 py-4 text-base font-black text-black">
              View shop page
            </Link>
            <button type="button" onClick={onClose} className="rounded-2xl border-2 border-white px-7 py-4 text-base font-black">
              Keep creating
            </button>
          </div>
        </div>
      </m.div>
    );
  }

  return (
    <m.div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 md:items-center md:p-4"
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
      <m.div
        className="grid w-full max-w-5xl overflow-y-auto bg-white text-black md:h-[min(92svh,860px)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:rounded-3xl"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {focusedProduct ? (
          <div
            className="relative flex aspect-square max-h-[45svh] items-center justify-center p-[3%] transition-colors duration-300 md:aspect-auto md:h-full md:max-h-none md:p-[5%]"
            style={{ background: garmentTones(shown.hex).backdrop }}
          >
            <GarmentPreview
              kind={focusedProduct.kind}
              hex={shown.hex}
              imageUrl={tile.mediumUrl ?? tile.url}
              aspect={aspect}
              placement={toInches(previewPlacement, aspect, areaOn(focusedProduct, previewPlacement.side))}
              area={areaOn(focusedProduct, previewPlacement.side)}
              className="max-h-[70svh]"
            />
            {previewPlacement.side === "back" && previewPlacement.mark !== undefined && (
              <div className="absolute right-3 top-3 flex w-[28%] flex-col items-center rounded-xl bg-white/80 p-1 shadow-sm">
                <ChestMarkPreview
                  kind={focusedProduct.kind}
                  hex={shown.hex}
                  imageUrl={tile.mediumUrl ?? tile.url}
                  aspect={aspect}
                  markIn={previewPlacement.mark}
                  area={focusedProduct.front}
                />
                <span className="text-xs font-bold text-black">Front</span>
              </div>
            )}
            <span className="absolute bottom-3 left-4 text-sm font-bold text-black">
              {shown.name} · {keepHyphens(focusedProduct.name)}
              {previewPlacement.side === "back" ? " · back" : ""}
            </span>
          </div>
        ) : (
          <div
            className="relative flex aspect-square max-h-[45svh] items-center justify-center p-[8%] transition-colors duration-300 md:aspect-auto md:h-full md:max-h-none md:p-[10%]"
            style={{ background: shown.hex, color: inkOn(shown.hex) }}
          >
            <Art url={tile.mediumUrl ?? tile.url} alt={`Design on ${shown.name}`} className="h-full max-h-[70svh] w-auto max-w-full object-contain" />
            <span className="absolute bottom-3 left-4 text-sm font-bold">{shown.name}</span>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-7 p-5 pb-0 md:min-h-0 md:overflow-y-auto md:p-8 md:pb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider">Publish</p>
              {keep ? (
                <p className="mt-2 text-4xl font-black tracking-tight md:text-5xl">Just for you</p>
              ) : crPreview ? (
                <p className="mt-2">
                  <span className="font-cr text-4xl md:text-5xl">CR {crPreview}</span>
                </p>
              ) : (
                <p className="mt-2 h-10 w-40 animate-pulse rounded-xl bg-neutral-100 md:h-12" />
              )}
              <p className="mt-1 text-sm text-neutral-600">
                {keep
                  ? "No CR number. You can share it with the world later."
                  : <>
                      {preview?.remix && remixKind === "variation"
                        ? `The next number in family ${preview.remix.variationCr.split("-")[0]}.`
                        : "A new family starts here."}{" "}
                      The number is set when you publish.
                    </>}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="shrink-0 px-1 text-sm font-semibold underline underline-offset-4"
            >
              Cancel
            </button>
          </div>

          {preview?.remix && <p className="-mt-3 text-base font-semibold">{preview.remix.summary}</p>}

          {tile.spelling && tile.spelling.length > 0 && (
            <div className="-mt-3 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">{spellingNote(tile.spelling)} You can still publish it as it is.</p>
              {onFixSpelling && (
                <button type="button" onClick={onFixSpelling} className="mt-1 h-10 font-bold underline underline-offset-4">
                  Fix the spelling
                </button>
              )}
            </div>
          )}

          <fieldset disabled={saving}>
            <legend className="text-sm font-bold uppercase tracking-wider">Who it's for</legend>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "world",
                    name: "Share with the world",
                    note: "Gets a CR number and a spot in the feed. Anyone can order it or remix it.",
                  },
                  {
                    value: "me",
                    name: "Keep it just for you",
                    note: preview?.remix
                      ? "Only you can see it and order it. The original's creator still gets credit."
                      : "Only you can see it and order it. Share it later if you like.",
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAudience(option.value)}
                  aria-pressed={audience === option.value}
                  className={cn(
                    "rounded-2xl border-2 p-3 text-left transition-colors",
                    audience === option.value ? "border-black bg-black text-white" : "border-neutral-200 hover:border-black",
                  )}
                >
                  <span className="block text-base font-black">{option.name}</span>
                  <span className={cn("mt-1 block text-sm", audience === option.value ? "text-neutral-300" : "text-neutral-600")}>{option.note}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-sm font-bold uppercase tracking-wider">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Optional"
              className="mt-2 w-full border-b-4 border-black bg-transparent py-2 text-2xl font-semibold outline-none placeholder:text-neutral-300"
            />
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between text-sm font-bold uppercase tracking-wider">
              A few words
              <span className="text-xs font-semibold normal-case tracking-normal text-neutral-500">
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={2}
              placeholder="Optional. Shown on the shop page."
              className="mt-2 w-full resize-none rounded-2xl border-2 border-neutral-200 bg-transparent p-3 text-base outline-none placeholder:text-neutral-400 focus:border-black"
            />
          </label>

          <fieldset disabled={saving}>
            <legend className="flex w-full items-baseline justify-between text-sm font-bold uppercase tracking-wider">
              Shirt colors
              <span className="text-xs font-semibold normal-case tracking-normal text-neutral-500">
                {selected.length} picked{selected.length >= MAX_OFFERED_COLORS ? ", the most" : ""}
                {paletteData?.product ? ` · ${paletteData.product.brand ?? ""} ${paletteData.product.model ?? ""}`.trimEnd() : ""}
              </span>
            </legend>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {palette.map((color) => {
                const on = selected.includes(color.key);
                const seen = visibility.get(color.key);
                return (
                  <button
                    key={color.key}
                    type="button"
                    onClick={() => toggle(color.key)}
                    onMouseEnter={() => setFocus(color.key)}
                    aria-pressed={on}
                    aria-label={`${color.name}${on ? ", picked" : ""}${seen === "disappears" ? ", the design gets lost" : seen === "faint" ? ", the design looks faint" : ""}`}
                    className={cn(
                      "relative flex aspect-square items-center justify-center overflow-hidden rounded-xl p-[14%] outline-offset-2 transition-transform active:scale-95",
                      on ? "ring-4 ring-black ring-offset-2" : "ring-1 ring-black/10",
                    )}
                    style={{ background: color.hex }}
                  >
                    <Art url={tile.thumbUrl ?? tile.mediumUrl ?? tile.url} alt="" className="h-full w-auto max-w-full object-contain" />
                    {lead === color.key && (
                      <span className="absolute left-1 top-1 rounded bg-black px-1 text-[10px] font-black leading-4 text-white">Lead</span>
                    )}
                    {seen && seen !== "clear" && (
                      <span
                        className={cn(
                          "absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black text-white",
                          seen === "disappears" ? "bg-red-600" : "bg-amber-500",
                        )}
                        aria-hidden
                      >
                        !
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 min-h-5 space-y-1 text-sm">
              {selected.length === 0 ? (
                <p className="font-semibold text-red-600">Pick at least one color.</p>
              ) : (
                <p className="text-neutral-600">
                  {colorOf(lead)?.name} leads: the shop page opens on it and the model photo is shot on it.
                  {focus && focus !== lead && selected.includes(focus) && (
                    <>
                      {" "}
                      <button type="button" onClick={() => makeLead(focus)} className="font-bold text-black underline underline-offset-4">
                        Lead with {colorOf(focus)?.name}
                      </button>
                    </>
                  )}
                </p>
              )}
              {lost.length > 0 && (
                <p className="font-semibold text-red-700">The design gets lost on {listOf(lost)}. You can still offer it.</p>
              )}
              {faint.length > 0 && <p className="text-amber-700">It looks faint on {listOf(faint)}.</p>}
              {onAdapt && (lost.length > 0 || faint.length > 0) && (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {selected
                    .filter((key) => visibility.get(key) === "disappears" || visibility.get(key) === "faint")
                    .slice(0, 3)
                    .map((key) => {
                      const color = colorOf(key);
                      return color ? (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onAdapt({ name: color.name, hex: color.hex })}
                          className="font-bold text-black underline underline-offset-4"
                        >
                          Make a version for {color.name}
                        </button>
                      ) : null;
                    })}
                </p>
              )}
            </div>
          </fieldset>

          {focusedProduct && (
            <PrintChoices
              products={products}
              chosen={chosenProducts}
              onToggle={toggleProduct}
              focused={focusedProduct}
              onFocus={setFocusedProductId}
              shared={shared}
              own={own}
              onChange={changePlacement}
              onSeparate={separate}
              colorKeys={selected}
              aspect={aspect}
              disabled={saving}
              chestMarks={preview?.chestMarks ?? false}
              preview={
                <GarmentPreview
                  kind={focusedProduct.kind}
                  hex={shown.hex}
                  imageUrl={tile.mediumUrl ?? tile.url}
                  aspect={aspect}
                  placement={toInches(previewPlacement, aspect, areaOn(focusedProduct, previewPlacement.side))}
                  area={areaOn(focusedProduct, previewPlacement.side)}
                  showArea={false}
                />
              }
            />
          )}

          {isRemix && !keep && (
            <div className="-mt-6">
              <RemixKindChoice
                generationId={tile.generationId}
                value={remixKind}
                onChange={setPickedKind}
                relation={relation}
                disabled={saving}
              />
            </div>
          )}

          <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-2 border-t border-neutral-200 bg-white px-5 py-4 md:-mx-8 md:px-8 md:pb-6">
            {paused && (
              <p role="status" className="font-semibold">
                Publishing is paused for now. Your designs are safe here; try again soon.
              </p>
            )}
            {error && (
              <p role="alert" className="font-semibold text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={saving || selected.length === 0 || paused || (Boolean(offered) && chosenProducts.length === 0)}
              className="h-14 w-full rounded-2xl bg-black px-8 text-lg font-black text-white disabled:opacity-40 md:w-auto md:self-start"
            >
              {keep ? (saving ? "Keeping…" : "Keep it") : saving ? "Publishing…" : crPreview ? `Publish as CR ${crPreview}` : "Publish"}
            </button>
          </div>
        </form>
      </m.div>
    </m.div>
  );
}

function listOf(names: Array<string>) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
