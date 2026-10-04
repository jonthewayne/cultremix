import { useCallback, useState } from "react";
import { PRINT_PRODUCT, formatPrice } from "../../../shared/config/print-products";
import { ColorSwatches } from "~/components/cr/ColorSwatches";
import { useCaptureRef } from "~/lib/ref";
import { CartDrawer } from "./CartDrawer";
import { useCart } from "./useCart";

export type BuyOffer = {
  cr: string;
  // key: the garment color key the page selects by; code: the SKU code the cart sends.
  colors: Array<{ key: string; code: string; name: string; hex: string }>;
  sizes: Array<string>;
  variants: Array<{ color: string; size: string; priceCents: number }>;
};

const MAX = 10;

// Color, size, quantity, add to cart. Shown on the work page in place of "Buying opens soon"
// once the work is on sale and checkout is open. The page owns the color selection (colorKey), so
// the art square and these swatches always show the same shirt.
export function BuyBox({
  offer,
  colorKey,
  onColorChange,
}: {
  offer: BuyOffer;
  colorKey: string;
  onColorChange: (key: string) => void;
}) {
  useCaptureRef();
  const { cart, error, busy, addLine, setQuantity, removeLine } = useCart();
  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const picked = offer.colors.find((c) => c.key === colorKey) ?? offer.colors[0];
  const color = picked?.code ?? "";

  const available = (c: string, s: string) => offer.variants.some((v) => v.color === c && v.size === s);
  const variant = size ? offer.variants.find((v) => v.color === color && v.size === size) : undefined;
  const fromCents = Math.min(...offer.variants.map((v) => v.priceCents));
  const price = variant?.priceCents ?? fromCents;
  const count = cart?.totalQuantity ?? 0;

  async function add() {
    if (!variant || !size) return;
    if (await addLine({ cr: offer.cr, color, size, quantity })) {
      setQty(1);
      setOpen(true);
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between border-t-2 border-foreground pt-4">
        <span className="text-5xl font-black tracking-tight">{formatPrice(price)}</span>
        <span className="text-sm font-semibold">{PRINT_PRODUCT.name}</span>
      </div>

      {picked && <ColorSwatches colors={offer.colors} value={picked.key} onChange={onColorChange} />}

      <div>
        <p className="text-sm font-bold uppercase tracking-wider">Size</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {offer.sizes.map((s) => {
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
        <p className="mt-2 text-sm text-muted-foreground">2XL is {formatPrice(offer.variants.find((v) => v.size === "2XL")?.priceCents ?? 3900)}.</p>
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
