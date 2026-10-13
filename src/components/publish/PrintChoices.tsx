import { GARMENT_KINDS, formatPrice } from "../../../shared/config/print-products";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { PrintArea, RelativePlacement } from "~/lib/print/shirtPlacement";
import {
  DEFAULT_MARK_IN,
  MARK_PRESETS,
  MIN_SIZE,
  markKeyOf,
  markPlacement,
  onFront,
  shareOfWidth,
  toInches,
  withoutMark,
} from "~/lib/print/shirtPlacement";
import { cn, keepHyphens } from "~/lib/utils";

// A product on offer, as convex/merch.ts offered returns it.
export type OfferedProduct = {
  productId: number;
  key: string;
  kind: GarmentKind;
  name: string;
  detail?: string;
  priceCents: number;
  largePriceCents: number;
  backExtraCents: number;
  front: PrintArea;
  back?: PrintArea;
  colors: Array<{ key: string; name: string; hex: string }>;
  isDefault: boolean;
};

// A product's placement: its own when its creator set one, else the shared one; a back placement
// on a product without a back prints on the front, without a chest mark.
export function placementOn(product: OfferedProduct, shared: RelativePlacement, own: Record<number, RelativePlacement>): RelativePlacement {
  const placement = product.productId in own ? own[product.productId] : shared;
  return placement.side === "back" && !product.back ? onFront(placement) : placement;
}

export function areaOn(product: OfferedProduct, side: RelativePlacement["side"]): PrintArea {
  return side === "back" && product.back ? product.back : product.front;
}

// The products a design comes on, and where it sits on them. Placed once, it fits every product:
// the size is a share of the largest it fits and the height a share of the room left
// (src/lib/print/shirtPlacement.ts). "Place it separately" gives one product its own.
export function PrintChoices({
  products,
  chosen,
  onToggle,
  focused,
  onFocus,
  shared,
  own,
  onChange,
  onSeparate,
  colorKeys,
  aspect,
  disabled,
  preview,
  chestMarks = false,
}: {
  products: Array<OfferedProduct>;
  chosen: Array<number>;
  onToggle: (productId: number) => void;
  focused: OfferedProduct;
  onFocus: (productId: number) => void;
  shared: RelativePlacement;
  own: Record<number, RelativePlacement>;
  // The placement being edited changed (the focused product's own, or the shared one).
  onChange: (placement: RelativePlacement) => void;
  onSeparate: (productId: number, separate: boolean) => void;
  // The shirt colors picked, to show which products come in them.
  colorKeys: Array<string>;
  aspect: number;
  disabled?: boolean;
  // A small preview shown beside the controls on phones, where the big one has scrolled away.
  preview?: React.ReactNode;
  // The Chest marks switch: a back print may add the same design small on the front chest.
  chestMarks?: boolean;
}) {
  const current = placementOn(focused, shared, own);
  const area = areaOn(focused, current.side);
  const inches = toInches(current, aspect, area);
  const separate = focused.productId in own;
  const set = (next: Partial<RelativePlacement>) => onChange({ ...current, ...next });
  const markPreset = markKeyOf(current.mark);
  const markWidth = current.mark !== undefined ? markPlacement(current.mark, aspect, focused.front).widthIn : null;
  // "the hoodie", or the product's name when two products on offer are the same kind.
  const sameKind = products.filter((product) => product.kind === focused.kind).length > 1;
  const called = sameKind ? focused.name : GARMENT_KINDS[focused.kind].label.toLowerCase();

  return (
    <>
      <fieldset disabled={disabled}>
        <legend className="flex w-full items-baseline justify-between text-sm font-bold uppercase tracking-wider">
          Comes on
          <span className="text-xs font-semibold normal-case tracking-normal text-neutral-500">{chosen.length} picked</span>
        </legend>
        <div className="mt-3 grid gap-2">
          {products.map((product) => {
            const on = chosen.includes(product.productId);
            const carried = product.colors.filter((color) => colorKeys.includes(color.key)).length;
            const isFocused = product.productId === focused.productId;
            return (
              <div
                key={product.productId}
                className={cn(
                  "flex items-stretch gap-1 rounded-2xl border-2 transition-colors",
                  isFocused ? "border-black" : "border-neutral-200",
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${product.name}${on ? ", picked" : ""}`}
                  onClick={() => onToggle(product.productId)}
                  className="flex w-12 shrink-0 items-center justify-center"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md border-2 border-black text-sm font-black",
                      on ? "bg-black text-white" : "bg-white",
                    )}
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                </button>
                <button type="button" onClick={() => onFocus(product.productId)} className="flex-1 py-3 pr-3 text-left">
                  <span className="block text-base font-black">{keepHyphens(product.name)}</span>
                  <span className="block text-sm text-neutral-600">
                    {formatPrice(product.priceCents)}
                    {/* A work published before colors were chosen has none to count. */}
                    {colorKeys.length > 0 && " · "}
                    {colorKeys.length === 0 ? null : carried === 0 ? (
                      <span className="font-semibold text-red-700">none of your colors</span>
                    ) : carried === colorKeys.length ? (
                      "all your colors"
                    ) : (
                      `${carried} of your colors`
                    )}
                    {product.productId in own ? " · placed separately" : ""}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {chosen.length === 0 && <p className="mt-3 text-sm font-semibold text-red-600">Pick at least one.</p>}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="text-sm font-bold uppercase tracking-wider">On the {called}</legend>
        {preview && <div className="sticky top-0 z-10 mt-2 h-40 rounded-xl bg-neutral-200 p-1 md:hidden">{preview}</div>}
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Side">
          {(["front", "back"] as const).map((side) => {
            const available = side === "front" || Boolean(focused.back);
            return (
              <button
                key={side}
                type="button"
                disabled={!available}
                aria-pressed={current.side === side}
                onClick={() => (side === "front" ? onChange(onFront(current)) : set({ side }))}
                className={cn(
                  "h-11 rounded-xl border-2 border-black px-4 font-bold disabled:opacity-30",
                  current.side === side && "bg-black text-white",
                )}
              >
                {side === "front" ? "Front" : "Back"}
                {side === "back" && focused.backExtraCents > 0 ? (
                  <span className="ml-1 font-semibold opacity-70">+{formatPrice(focused.backExtraCents)}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-sm text-neutral-600">
          The {current.side} prints up to {area.widthIn} × {area.heightIn} in, the dashed box. The largest size stays half an inch
          inside it.
        </p>
        <label className="mt-3 block">
          <span className="flex items-baseline justify-between text-sm font-semibold">
            Size
            <span className="text-neutral-600">
              {inches.widthIn.toFixed(1)} in wide · {shareOfWidth(inches, area)}% of the print width
            </span>
          </span>
          <input
            type="range"
            min={MIN_SIZE}
            max={1}
            step={0.01}
            value={current.size}
            onChange={(event) => set({ size: Number(event.target.value) })}
            aria-label="Size: smaller to larger"
            className="mt-2 w-full accent-black"
          />
        </label>
        <label className="mt-3 block">
          <span className="flex items-baseline justify-between text-sm font-semibold">
            Height
            <span className="text-neutral-600">
              {current.drop < 0.15 ? "up high" : current.drop > 0.85 ? "down low" : current.drop < 0.45 ? "upper" : current.drop > 0.6 ? "lower" : "middle"}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={current.drop}
            onChange={(event) => set({ drop: Number(event.target.value) })}
            aria-label="Height: higher to lower"
            className="mt-2 w-full accent-black"
          />
          <span className="mt-1 flex justify-between text-xs font-semibold text-neutral-500" aria-hidden>
            <span>Higher</span>
            <span>Lower</span>
          </span>
        </label>
        {chosen.length > 1 && chosen.includes(focused.productId) && (
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={separate}
              onChange={(event) => onSeparate(focused.productId, event.target.checked)}
              className="h-5 w-5 accent-black"
            />
            Place it separately on the {called}
          </label>
        )}
        <p className="mt-2 text-sm text-neutral-600">
          {separate
            ? "This one keeps its own size and spot."
            : chosen.length > 1
              ? "Set once, it fits every product: the same share of each print area, in the same spot."
              : "Centered, the size shown on the shirt."}
        </p>
        {chestMarks && current.side === "back" && (
          <div className="mt-5 rounded-2xl border-2 border-neutral-200 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={current.mark !== undefined}
                onChange={(event) => onChange(event.target.checked ? { ...current, mark: DEFAULT_MARK_IN } : withoutMark(current))}
                className="h-5 w-5 accent-black"
              />
              Add a small one on the front
            </label>
            {current.mark !== undefined && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Size on the front">
                {MARK_PRESETS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={markPreset === option.key}
                    onClick={() => set({ mark: option.widthIn })}
                    className={cn("h-11 rounded-xl border-2 border-black px-4 font-bold", markPreset === option.key && "bg-black text-white")}
                  >
                    {option.label} · {option.widthIn} in
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-sm text-neutral-600">
              {markWidth !== null
                ? `The same design, ${markWidth.toFixed(1)} in wide, on the left chest. It doesn't change the price.`
                : "The same design, small, on the left chest, the way back prints often have one. It doesn't change the price."}
            </p>
          </div>
        )}
      </fieldset>
    </>
  );
}
