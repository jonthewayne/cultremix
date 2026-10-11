import { GARMENT_KINDS, formatPrice } from "../../../shared/config/print-products";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { PrintArea, RelativePlacement } from "~/lib/print/shirtPlacement";
import { MIN_SIZE, SIZE_PRESETS, sizeKeyOf, toInches } from "~/lib/print/shirtPlacement";
import { cn } from "~/lib/utils";

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
// on a product without a back prints on the front.
export function placementOn(product: OfferedProduct, shared: RelativePlacement, own: Record<number, RelativePlacement>): RelativePlacement {
  const placement = product.productId in own ? own[product.productId] : shared;
  return placement.side === "back" && !product.back ? { ...placement, side: "front" } : placement;
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
}) {
  const current = placementOn(focused, shared, own);
  const area = areaOn(focused, current.side);
  const inches = toInches(current, aspect, area);
  const preset = sizeKeyOf(current.size);
  const separate = focused.productId in own;
  const set = (next: Partial<RelativePlacement>) => onChange({ ...current, ...next });
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
                  <span className="block text-base font-black">{product.name}</span>
                  <span className="block text-sm text-neutral-600">
                    {formatPrice(product.priceCents)}
                    {" · "}
                    {carried === 0 ? (
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
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Side">
          {(["front", "back"] as const).map((side) => {
            const available = side === "front" || Boolean(focused.back);
            return (
              <button
                key={side}
                type="button"
                disabled={!available}
                aria-pressed={current.side === side}
                onClick={() => set({ side })}
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

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Size">
          {SIZE_PRESETS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={preset === option.key}
              onClick={() => set({ size: option.size })}
              className={cn("h-11 rounded-xl border-2 border-black px-4 font-bold", preset === option.key && "bg-black text-white")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="flex items-baseline justify-between text-sm font-semibold">
            Size
            <span className="text-neutral-600">{inches.widthIn.toFixed(1)} in wide</span>
          </span>
          <input
            type="range"
            min={MIN_SIZE}
            max={1}
            step={0.01}
            value={current.size}
            onChange={(event) => set({ size: Number(event.target.value) })}
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
      </fieldset>
    </>
  );
}

