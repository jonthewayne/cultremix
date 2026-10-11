import { useCallback, useState } from "react";
import { formatPrice } from "../../../shared/config/print-products";
import type { GarmentKind } from "../../../shared/config/print-products";
import type { PrintArea, RelativePlacement } from "~/lib/print/shirtPlacement";
import { OnTheShirt } from "./OnTheShirt";
import { ColorSwatches } from "~/components/cr/ColorSwatches";
import { useCaptureRef } from "~/lib/ref";
import { cn } from "~/lib/utils";
import { CartDrawer } from "./CartDrawer";
import { useCart } from "./useCart";

export type BuyProduct = {
  key: string;
  name: string;
  kind: GarmentKind;
  side: "front" | "back";
  placement: RelativePlacement;
  printArea: PrintArea;
  // key: the garment color key the page selects by; code: the SKU code the cart sends.
  colors: Array<{ key: string; code: string; name: string; hex: string }>;
  sizes: Array<string>;
  variants: Array<{ color: string; size: string; priceCents: number }>;
};

// keep: a kept design's id, for its creator's own page (it has no public CR number).
export type BuyOffer = { cr: string; keep?: string; products: Array<BuyProduct> };

const MAX = 10;

const fromPrice = (product: BuyProduct) => Math.min(...product.variants.map((v) => v.priceCents));

// Style (when it sells on more than one product), color, size, quantity, add to cart. Shown on the
// work page in place of "Buying opens soon" once the work is on sale and checkout is open. The page
// owns the product and color selection, so the art square and these swatches show the same shirt.
export function BuyBox({
  offer,
  product,
  onProductChange,
  colorKey,
  onColorChange,
  artUrl,
}: {
  offer: BuyOffer;
  product: BuyProduct;
  onProductChange: (key: string) => void;
  colorKey: string;
  onColorChange: (key: string) => void;
  artUrl?: string;
}) {
  useCaptureRef();
  const { cart, error, busy, addLine, setQuantity, removeLine } = useCart();
  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const picked = product.colors.find((c) => c.key === colorKey) ?? product.colors[0];
  const color = picked?.code ?? "";

  const available = (c: string, s: string) => product.variants.some((v) => v.color === c && v.size === s);
  const variant = size ? product.variants.find((v) => v.color === color && v.size === size) : undefined;
  const fromCents = fromPrice(product);
  const largeCents = product.variants.find((v) => v.size === "2XL")?.priceCents;
  const price = variant?.priceCents ?? fromCents;
  const count = cart?.totalQuantity ?? 0;

  async function add() {
    if (!variant || !size) return;
    const design = offer.keep ? { keep: offer.keep } : { cr: offer.cr };
    if (await addLine({ ...design, product: product.key, color, size, quantity })) {
      setQty(1);
      setOpen(true);
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-foreground pt-4">
        <span className="text-5xl font-black tracking-tight">{formatPrice(price)}</span>
        <span className="text-right text-sm font-semibold">
          {product.name}
          {product.side === "back" ? " · printed on the back" : ""}
        </span>
      </div>

      {offer.products.length > 1 && (
        <div>
          <p className="text-sm font-bold uppercase tracking-wider">Style</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {offer.products.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={p.key === product.key}
                onClick={() => {
                  onProductChange(p.key);
                  setSize(null);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl border-2 border-foreground px-3 py-2 text-left font-bold",
                  p.key === product.key && "bg-foreground text-background",
                )}
              >
                {p.name}
                <span className="font-semibold opacity-70">{formatPrice(fromPrice(p))}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {picked && <ColorSwatches colors={product.colors} value={picked.key} onChange={onColorChange} />}

      {picked && (
        <OnTheShirt kind={product.kind} placement={product.placement} printArea={product.printArea} hex={picked.hex} artUrl={artUrl} />
      )}

      <div>
        <p className="text-sm font-bold uppercase tracking-wider">Size</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {product.sizes.map((s) => {
            const enabled = available(color, s);
            return (
              <button
                key={s}
                type="button"
                disabled={!enabled}
                aria-pressed={s === size}
                onClick={() => setSize(s)}
                className={`flex h-11 min-w-11 items-center justify-center rounded-xl border-2 border-foreground px-3 font-bold disabled:opacity-30 ${
                  s === size ? "bg-foreground text-background" : ""
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
        {largeCents !== undefined && largeCents !== fromCents && (
          <p className="mt-2 text-sm text-muted-foreground">2XL is {formatPrice(largeCents)}.</p>
        )}
      </div>

      <div>
        <p className="text-sm font-bold uppercase tracking-wider">Quantity</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            aria-label="One fewer"
            disabled={quantity <= 1}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="h-11 w-11 rounded-xl border-2 border-foreground text-xl font-black disabled:opacity-30"
          >
            −
          </button>
          <span className="w-8 text-center text-xl font-bold tabular-nums">{quantity}</span>
          <button
            type="button"
            aria-label="One more"
            disabled={quantity >= MAX}
            onClick={() => setQty((q) => Math.min(MAX, q + 1))}
            className="h-11 w-11 rounded-xl border-2 border-foreground text-xl font-black disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!variant || busy}
          onClick={add}
          className="h-14 w-full rounded-2xl bg-foreground text-lg font-black text-background transition-transform enabled:hover:-translate-y-0.5 disabled:bg-muted disabled:text-muted-foreground"
        >
          {busy ? "Adding…" : variant ? `Add to cart · ${formatPrice(variant.priceCents * quantity)}` : "Pick a size"}
        </button>
        {error && !open && <p className="text-sm font-semibold text-destructive">{error}</p>}
        {count > 0 && (
          <button type="button" onClick={() => setOpen(true)} className="h-11 font-bold underline underline-offset-4">
            View cart ({count})
          </button>
        )}
      </div>

      <CartDrawer
        open={open}
        onClose={close}
        cart={cart}
        busy={busy}
        error={error}
        onQuantity={(lineId, q) => void setQuantity(lineId, q)}
        onRemove={(lineId) => void removeLine(lineId)}
      />
    </>
  );
}

