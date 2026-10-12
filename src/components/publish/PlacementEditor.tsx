import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { GarmentPreview, useImageAspect } from "./GarmentPreview";
import { PrintChoices, areaOn, placementOn } from "./PrintChoices";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RelativePlacement } from "~/lib/print/shirtPlacement";
import { errorMessage } from "~/lib/imagePrep";
import { garmentTones } from "~/lib/print/garmentMockup";
import { toInches } from "~/lib/print/shirtPlacement";

// On a work's page, for its creator (and the owner): change what it comes on and where it sits,
// after publishing. Saved on the work (convex/publish.ts setPrintSetup); when it's already on sale,
// the new placement reaches the shop the next time an admin approves it.
export function PlacementEditor({
  workId,
  artUrl,
  colors,
}: {
  workId: Id<"works">;
  artUrl?: string;
  colors: Array<{ key: string; name: string; hex: string }>;
}) {
  const setup = useQuery(convexQuery(api.publish.printSetup, { workId })).data;
  const [open, setOpen] = useState(false);
  if (!setup) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-bold underline underline-offset-4">
        Change what it comes on and where it sits
      </button>
      {open && <EditorDialog workId={workId} artUrl={artUrl} colors={colors} setup={setup} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditorDialog({
  workId,
  artUrl,
  colors,
  setup,
  onClose,
}: {
  workId: Id<"works">;
  artUrl?: string;
  colors: Array<{ key: string; name: string; hex: string }>;
  setup: { printPlacement: RelativePlacement; printProducts: Array<{ productId: number; placement?: RelativePlacement }>; onSale: boolean };
  onClose: () => void;
}) {
  const offered = useQuery(convexQuery(api.merch.offered, {})).data;
  const products = offered ?? [];
  const save = useMutation(api.publish.setPrintSetup);
  const [chosen, setChosen] = useState<Array<number>>(() => setup.printProducts.map((pick) => pick.productId));
  const [shared, setShared] = useState<RelativePlacement>(setup.printPlacement);
  const [own, setOwn] = useState<Record<number, RelativePlacement>>(() =>
    Object.fromEntries(setup.printProducts.filter((pick) => pick.placement).map((pick) => [pick.productId, pick.placement!])),
  );
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const aspect = useImageAspect(artUrl);
  const focused = products.find((p) => p.productId === focusedId) ?? products.find((p) => chosen.includes(p.productId)) ?? products[0];
  const lead = colors[0] ?? { key: "white", name: "White", hex: "#ffffff" };
  const placement = focused ? placementOn(focused, shared, own) : shared;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (productId: number) => {
    const on = chosen.includes(productId);
    const next = on ? chosen.filter((id) => id !== productId) : [...chosen, productId];
    setChosen(next);
    if (!on) setFocusedId(productId);
    else if (focused?.productId === productId && next.length > 0) setFocusedId(next[0]);
  };
  const change = (next: RelativePlacement) => {
    if (focused && focused.productId in own) setOwn({ ...own, [focused.productId]: next });
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
  const submit = async () => {
    setSaving(true);
    setNote(null);
    try {
      await save({
        workId,
        printPlacement: shared,
        printProducts: chosen.map((productId) => (productId in own ? { productId, placement: own[productId] } : { productId })),
      });
      setNote(setup.onSale ? "Saved. It reaches the shop once it's approved again." : "Saved.");
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
      aria-label="Where it sits"
    >
      <div className="grid w-full max-w-5xl overflow-y-auto bg-white text-black md:h-[min(92svh,820px)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:overflow-hidden md:rounded-3xl">
        <div
          className="relative flex aspect-square max-h-[45svh] items-center justify-center p-[3%] md:aspect-auto md:h-full md:max-h-none md:p-[5%]"
          style={{ background: garmentTones(lead.hex).backdrop }}
        >
          {focused && (
            <GarmentPreview
              kind={focused.kind}
              hex={lead.hex}
              imageUrl={artUrl}
              aspect={aspect}
              placement={toInches(placement, aspect, areaOn(focused, placement.side))}
              area={areaOn(focused, placement.side)}
              className="max-h-[70svh]"
            />
          )}
          <span className="absolute bottom-3 left-4 text-sm font-bold">
            {lead.name}
            {focused ? ` · ${focused.name}` : ""}
            {placement.side === "back" ? " · back" : ""}
          </span>
        </div>
        <div className="flex flex-col gap-7 p-5 md:min-h-0 md:overflow-y-auto md:p-8">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-bold uppercase tracking-wider">Where it sits</p>
            <button type="button" onClick={onClose} disabled={saving} className="text-sm font-semibold underline underline-offset-4">
              Close
            </button>
          </div>
          {focused && (
            <PrintChoices
              products={products}
              chosen={chosen}
              onToggle={toggle}
              focused={focused}
              onFocus={setFocusedId}
              shared={shared}
              own={own}
              onChange={change}
              onSeparate={separate}
              colorKeys={colors.map((color) => color.key)}
              aspect={aspect}
              disabled={saving}
              preview={
                <GarmentPreview
                  kind={focused.kind}
                  hex={lead.hex}
                  imageUrl={artUrl}
                  aspect={aspect}
                  placement={toInches(placement, aspect, areaOn(focused, placement.side))}
                  area={areaOn(focused, placement.side)}
                  showArea={false}
                />
              }
            />
          )}
          <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-2 border-t border-neutral-200 bg-white px-5 py-4 md:-mx-8 md:px-8">
            {note && <p className="font-semibold">{note}</p>}
            <button
              type="button"
              disabled={saving || chosen.length === 0}
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

