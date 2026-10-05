import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  GARMENT_COLORS,
  MAX_DESCRIPTION_LENGTH,
  defaultOfferedColors,
  garmentColor,
  visibilityOn,
} from "../../../convex/lib/garments";
import type { Visibility } from "../../../convex/lib/garments";
import type { Id } from "../../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { RemixKindChoice } from "~/components/cr/RemixKindChoice";
import { RemixableWords } from "~/components/cr/RemixableWords";
import type { RemixKind } from "~/components/cr/RemixKindChoice";
import { useDesignPixels } from "~/lib/designPixels";
import { errorMessage, inkOn } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

export type PublishTile = {
  generationId: Id<"generations">;
  url?: string;
  mediumUrl?: string;
  thumbUrl?: string;
  backgroundColor: string;
};

// One sheet: title, a short note, the shirt colors (with a live preview on each and a heads-up
// where the design would get lost), the CR number it will get, and for a remix how it relates.
// Only confirming is required.
export function PublishDialog({ tile, onClose }: { tile: PublishTile; onClose: () => void }) {
  const publish = useMutation(api.publish.quick);
  const preview = useQuery(api.publish.preview, { generationId: tile.generationId });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // A remix that changed only its remixable words is a variation; one that changed more starts
  // with fork selected until the member picks (components/cr/RemixKindChoice.tsx).
  const [pickedKind, setPickedKind] = useState<RemixKind | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ workId: Id<"works">; cr: string; lead: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pixels = useDesignPixels(tile.thumbUrl ?? tile.mediumUrl ?? tile.url, tile.backgroundColor);
  const visibility = useMemo(() => {
    const map = new Map<string, Visibility>();
    if (pixels && pixels.length > 0) for (const color of GARMENT_COLORS) map.set(color.key, visibilityOn(pixels, color.hex));
    return map;
  }, [pixels]);

  // Starts from the design's own shade plus the defaults, skipping colors it would disappear on,
  // until the member picks for themselves.
  const [picked, setPicked] = useState<Array<string> | null>(null);
  const suggested = useMemo(() => {
    const hidden = new Set([...visibility].filter(([, seen]) => seen === "disappears").map(([key]) => key));
    return defaultOfferedColors(tile.backgroundColor, hidden);
  }, [tile.backgroundColor, visibility]);
  const selected = picked ?? suggested;
  const lead = selected[0];
  const [focus, setFocus] = useState<string | null>(null);
  const shown = garmentColor(focus ?? lead ?? "") ?? garmentColor(suggested[0])!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (key: string) => {
    setFocus(key);
    setPicked(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };
  const makeLead = (key: string) => setPicked([key, ...selected.filter((k) => k !== key)]);

  const isRemix = Boolean(preview?.remix);
  const forkAllowed = preview?.remix?.forkAllowed ?? false;
  const remixKind: RemixKind = forkAllowed ? (pickedKind ?? "fork") : "variation";
  const crPreview = preview ? (preview.remix && remixKind === "variation" ? preview.remix.variationCr : preview.newFamilyCr) : null;
  const paused = preview?.publishing === false;
  const lost = selected.filter((key) => visibility.get(key) === "disappears").map((key) => garmentColor(key)!.name);
  const faint = selected.filter((key) => visibility.get(key) === "faint").map((key) => garmentColor(key)!.name);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selected.length === 0 || paused) return;
    setSaving(true);
    setError(null);
    try {
      const published = await publish({
        requestId,
        generationId: tile.generationId,
        title: title || undefined,
        description: description.trim() || undefined,
        remixKind,
        offeredColors: selected,
      });
      setResult({ workId: published.workId, cr: published.cr, lead: garmentColor(selected[0])!.hex });
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
            <CrMark cr={result.cr} className="whitespace-nowrap text-[14vw] md:text-[16vw]" />
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
        {/* What people who remix it can change, once the words are read. */}
        <div className="max-w-xl empty:hidden">
          <RemixableWords workId={result.workId} tone="dark" editing />
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
      </motion.div>
    );
  }

  return (
    <motion.div
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
      <motion.div
        className="grid w-full max-w-5xl overflow-y-auto bg-white text-black md:h-[min(92svh,860px)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:rounded-3xl"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div
          className="relative flex aspect-square max-h-[45svh] items-center justify-center p-[8%] transition-colors duration-300 md:aspect-auto md:h-full md:max-h-none md:p-[10%]"
          style={{ background: shown.hex, color: inkOn(shown.hex) }}
        >
          <Art url={tile.mediumUrl ?? tile.url} alt={`Design on ${shown.name}`} className="h-full max-h-[70svh] w-auto max-w-full object-contain" />
          <span className="absolute bottom-3 left-4 text-sm font-bold">{shown.name}</span>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-7 p-5 pb-0 md:min-h-0 md:overflow-y-auto md:p-8 md:pb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider">Publish</p>
              {crPreview ? (
                <p className="mt-2">
                  <span className="font-cr text-4xl md:text-5xl">CR {crPreview}</span>
                </p>
              ) : (
                <p className="mt-2 h-10 w-40 animate-pulse rounded-xl bg-neutral-100 md:h-12" />
              )}
              <p className="mt-1 text-sm text-neutral-600">
                {preview?.remix && remixKind === "variation"
                  ? `The next number in family ${preview.remix.variationCr.split("-")[0]}.`
                  : "A new family starts here."}{" "}
                The number is set when you publish.
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
                {selected.length} picked
              </span>
            </legend>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {GARMENT_COLORS.map((color) => {
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
                  {garmentColor(lead)!.name} leads: the shop page opens on it and the model photo is shot on it.
                  {focus && focus !== lead && selected.includes(focus) && (
                    <>
                      {" "}
                      <button type="button" onClick={() => makeLead(focus)} className="font-bold text-black underline underline-offset-4">
                        Lead with {garmentColor(focus)!.name}
                      </button>
                    </>
                  )}
                </p>
              )}
              {lost.length > 0 && (
                <p className="font-semibold text-red-700">The design gets lost on {listOf(lost)}. You can still offer it.</p>
              )}
              {faint.length > 0 && <p className="text-amber-700">It looks faint on {listOf(faint)}.</p>}
            </div>
          </fieldset>

          {isRemix && (
            <div className="-mt-6">
              <RemixKindChoice
                generationId={tile.generationId}
                value={remixKind}
                onChange={setPickedKind}
                forkAllowed={forkAllowed}
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
              disabled={saving || selected.length === 0 || paused}
              className="h-14 w-full rounded-2xl bg-black px-8 text-lg font-black text-white disabled:opacity-40 md:w-auto md:self-start"
            >
              {saving ? "Publishing…" : crPreview ? `Publish as CR ${crPreview}` : "Publish"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function listOf(names: Array<string>) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
