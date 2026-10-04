import { useEffect } from "react";
import { formatPrice } from "../../../shared/config/print-products";
import type { CartView } from "~/server/storefront";

const MAX = 10;

export function CartDrawer({
  open,
  onClose,
  cart,
  busy,
  error,
  onQuantity,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  cart: CartView | null;
  busy: boolean;
  error: string | null;
  onQuantity: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  const lines = cart?.lines ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Your cart">
      <button type="button" aria-label="Close cart" className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-background text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b-2 border-foreground px-5 py-4">
          <h2 className="text-2xl font-black tracking-tight">Your cart</h2>
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-3 font-bold underline underline-offset-4">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <p className="pt-8 text-lg text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul className="flex flex-col gap-5">
              {lines.map((line) => (
                <li key={line.id} className="flex gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {line.imageUrl && <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{line.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {[line.color, line.size].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="One fewer"
                        onClick={() => onQuantity(line.id, line.quantity - 1)}
                        className="h-9 w-9 rounded-lg border-2 border-foreground font-black disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold tabular-nums">{line.quantity}</span>
                      <button
                        type="button"
                        disabled={busy || line.quantity >= MAX}
                        aria-label="One more"
                        onClick={() => onQuantity(line.id, line.quantity + 1)}
                        className="h-9 w-9 rounded-lg border-2 border-foreground font-black disabled:opacity-40"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemove(line.id)}
                        className="ml-auto text-sm font-semibold underline underline-offset-4 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <p className="font-bold tabular-nums">{formatPrice(line.totalCents)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t-2 border-foreground px-5 py-4">
          {error && <p className="mb-3 text-sm font-semibold text-destructive">{error}</p>}
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold uppercase tracking-wider">Subtotal</span>
            <span className="text-2xl font-black tabular-nums">{formatPrice(cart?.subtotalCents ?? 0)}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Shipping is added at checkout. US only for now.</p>
          {cart && lines.length > 0 ? (
            <a
              href={cart.checkoutUrl}
              className="mt-4 flex h-14 w-full items-center justify-center rounded-2xl bg-foreground text-lg font-black text-background"
            >
              Check out
            </a>
          ) : (
            <button type="button" onClick={onClose} className="mt-4 h-14 w-full rounded-2xl border-2 border-foreground text-lg font-black">
              Keep looking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
