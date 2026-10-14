import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import * as m from "motion/react-m";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { GARMENT_COLORS, MAX_OFFERED_COLORS, garmentColor, visibilityOn } from "../../../convex/lib/garments";
import type { FunctionReturnType } from "convex/server";
import type { Palette, Visibility } from "../../../convex/lib/garments";
import type { Id } from "../../../convex/_generated/dataModel";
import { Art } from "~/components/cr/Art";
import { useDesignPixels } from "~/lib/designPixels";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

type Setup = NonNullable<FunctionReturnType<typeof api.publish.colorSetup>>;

function listOf(names: Array<string>) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// On a work's page, for its creator and the owner: change the shirt colors it sells in, and which
// one leads, after publishing (convex/publish.ts setOfferedColors). Its shop products follow at once.
export function ColorEditor({ workId, artUrl, backgroundColor }: { workId: Id<"works">; artUrl?: string; backgroundColor: string }) {
  const setup = useQuery(convexQuery(api.publish.colorSetup, { workId })).data;
  const [open, setOpen] = useState(false);
  if (!setup) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-bold underline underline-offset-4">
        Change its shirt colors
      </button>
      {open && (
        <ColorDialog workId={workId} artUrl={artUrl} backgroundColor={backgroundColor} setup={setup} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ColorDialog({
  workId,
  artUrl,
  backgroundColor,
  setup,
  onClose,
}: {
  workId: Id<"works">;
  artUrl?: string;
  backgroundColor: string;
  setup: Setup;
  onClose: () => void;
}) {
  const paletteData = useQuery(convexQuery(api.merch.palette, {})).data;
  const palette: Palette = paletteData?.colors ?? GARMENT_COLORS;
  const colorOf = (key: string) => garmentColor(key, palette);
  const save = useMutation(api.publish.setOfferedColors);
  const pixels = useDesignPixels(artUrl, backgroundColor);
  const visibility = useMemo(() => {
    const map = new Map<string, Visibility>();
    if (pixels && pixels.all.length > 0) {
      for (const color of palette) map.set(color.key, visibilityOn(pixels.all, color.hex, pixels.edge));
    }
    return map;
  }, [pixels, palette]);
  const [saved, setSaved] = useState<Array<string>>(setup.colors);
  const [selected, setSelected] = useState<Array<string>>(setup.colors);
  const [focus, setFocus] = useState<string | null>(null);
  const [retake, setRetake] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lead = selected.at(0);
  const leadChanged = lead !== undefined && lead !== saved.at(0);
  const changed = selected.join() !== saved.join();
  const shown = colorOf(focus ?? lead ?? "") ?? palette[0];
  const lost = selected.filter((key) => visibility.get(key) === "disappears").map((key) => colorOf(key)?.name ?? key);
  const faint = selected.filter((key) => visibility.get(key) === "faint").map((key) => colorOf(key)?.name ?? key);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (key: string) => {
    setFocus(key);
    setNote(null);
    if (selected.includes(key)) setSelected(selected.filter((k) => k !== key));
    else if (selected.length < MAX_OFFERED_COLORS) setSelected([...selected, key]);
  };
  const makeLead = (key: string) => {
    setNote(null);
    setSelected([key, ...selected.filter((k) => k !== key)]);
  };

  const submit = async () => {
    setSaving(true);
    setNote(null);
    try {
      const result = await save({ workId, colors: selected, retakePhoto: setup.canRetake && leadChanged && retake });
      setSaved(result.colors);
      const parts = ["Saved."];
      if (result.relisted > 0) parts.push("Its shop products are switching to these colors.");
      if (result.kept.length > 0) parts.push(`${listOf(result.kept)} doesn't come in these colors, so it keeps selling its old ones.`);
      if (result.photo) parts.push(`A new model photo on ${colorOf(result.colors[0])?.name ?? "the lead color"} is on its way.`);
      setNote(parts.join(" "));
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <m.div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 md:items-center md:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Shirt colors"
    >
      <div className="grid w-full max-w-5xl overflow-y-auto bg-white text-black md:h-[min(92svh,820px)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:overflow-hidden md:rounded-3xl">
        <div
          className="relative flex aspect-square max-h-[45svh] items-center justify-center p-[12%] transition-colors duration-300 md:aspect-auto md:h-full md:max-h-none"
          style={{ background: shown.hex }}
        >
          <Art url={artUrl} alt="" className="h-full w-auto max-w-full object-contain" />
          <span className="absolute bottom-3 left-4 rounded-md bg-white/85 px-2 py-0.5 text-sm font-bold">
            {shown.name}
            {shown.key === lead ? " · leads" : ""}
          </span>
        </div>
        <div className="flex flex-col gap-6 p-5 md:min-h-0 md:overflow-y-auto md:p-8">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-bold uppercase tracking-wider">Shirt colors</p>
            <button type="button" onClick={onClose} disabled={saving} className="text-sm font-semibold underline underline-offset-4">
              Close
            </button>
          </div>
          <p className="text-sm text-neutral-600">
            Pick the colors it sells in, up to {MAX_OFFERED_COLORS}. The first one leads: the shop page opens on it and the model photo is shot on
            it.
          </p>
          <fieldset disabled={saving}>
            <legend className="text-xs font-semibold text-neutral-500">
              {selected.length} picked{selected.length >= MAX_OFFERED_COLORS ? ", the most" : ""}
              {paletteData?.product ? ` · ${paletteData.product.brand ?? ""} ${paletteData.product.model ?? ""}`.trimEnd() : ""}
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
                    aria-label={`${color.name}${on ? ", picked" : ""}${lead === color.key ? ", the lead color" : ""}${seen === "disappears" ? ", the design gets lost" : seen === "faint" ? ", the design looks faint" : ""}`}
                    className={cn(
                      "relative flex aspect-square items-center justify-center overflow-hidden rounded-xl p-[14%] outline-offset-2 transition-transform active:scale-95",
                      on ? "ring-4 ring-black ring-offset-2" : "ring-1 ring-black/10",
                    )}
                    style={{ background: color.hex }}
                  >
                    <Art url={artUrl} alt="" className="h-full w-auto max-w-full object-contain" />
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
          </fieldset>
          <div className="min-h-5 space-y-1 text-sm">
            {selected.length === 0 ? (
              <p className="font-semibold text-red-600">Pick at least one color.</p>
            ) : (
              <p className="text-neutral-600">
                {colorOf(lead ?? "")?.name} leads.
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
            {lost.length > 0 && <p className="font-semibold text-red-700">The design gets lost on {listOf(lost)}. You can still offer it.</p>}
            {faint.length > 0 && <p className="text-amber-700">It looks faint on {listOf(faint)}.</p>}
          </div>
          {setup.onSale && (
            <p className="text-sm text-neutral-600">It's for sale, so its shop products switch to these colors when you save. Its print file stays the same.</p>
          )}
          {setup.canRetake && leadChanged && (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={retake} onChange={(event) => setRetake(event.target.checked)} className="mt-0.5 h-4 w-4 accent-black" />
              <span>
                Take a new model photo on {colorOf(lead ?? "")?.name}
                {setup.isOwner ? " (about 5¢)." : " (it uses one of today's photo shoots)."}
              </span>
            </label>
          )}
          <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-2 border-t border-neutral-200 bg-white px-5 py-4 md:-mx-8 md:px-8">
            {note && <p className="font-semibold">{note}</p>}
            <button
              type="button"
              disabled={saving || !changed || selected.length === 0}
              onClick={() => void submit()}
              className="h-14 rounded-2xl bg-black px-8 text-lg font-black text-white disabled:opacity-40 md:self-start"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </m.div>
  );
}
