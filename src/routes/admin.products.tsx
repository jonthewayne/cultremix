import { useAction, useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AdminSection, adminButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

// The shirts CultRemix offers: search Printful's catalog, add a product with its real colors, pick
// which colors are offered, and make one the active shirt. The active shirt's offered colors are
// what the studio previews on and the publish dialog offers (convex/merch.ts).
export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});

type Product = FunctionReturnType<typeof api.merch.adminList>[number];
type Found = FunctionReturnType<typeof api.merch.adminSearch>[number];

function AdminProducts() {
  const products = useQuery(api.merch.adminList, {});
  const palette = useQuery(api.merch.palette, {});
  const search = useAction(api.merch.adminSearch);
  const add = useAction(api.merch.adminAdd);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Array<Found> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const runSearch = async () => {
    setBusy("search");
    setError("");
    try {
      setFound(await search({ words }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const addProduct = async (productId: number) => {
    setBusy(`add-${productId}`);
    setError("");
    try {
      await add({ productId });
      setFound(null);
      setWords("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="Shirt colors on offer"
        description={
          palette?.product
            ? `From ${palette.product.name}. The studio previews on these, and the publish dialog offers them.`
            : "No shirt picked yet, so the launch colors are on offer. Add a product below and make it active."
        }
      >
        <div className="flex flex-wrap gap-3">
          {(palette?.colors ?? []).map((color) => (
            <span key={color.key} className="flex w-16 flex-col items-center gap-1 text-center text-[11px] font-semibold leading-tight">
              <span className="h-10 w-10 rounded-full border border-black/20" style={{ background: color.hex }} />
              {color.name}
            </span>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Add a product" description="Searches Printful's catalog of shirts, tanks, sweatshirts, and hoodies. No Printful account needed.">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <input
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder="Comfort Colors 1717, Bella Canvas 3001, hoodie…"
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-border bg-background px-3"
            aria-label="Search the catalog"
          />
          <button type="submit" disabled={busy !== null || !words.trim()} className={adminButton}>
            {busy === "search" ? "Searching…" : "Search"}
          </button>
        </form>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
        {found && (
          <ul className="mt-4 divide-y divide-border">
            {found.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nothing matches. Try a brand or a model number.</li>}
            {found.map((product) => (
              <li key={product.productId} className="flex items-center gap-3 py-3">
                {product.image && <img src={product.image} alt="" className="h-14 w-14 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    #{product.productId} · {product.variants} variants
                  </p>
                </div>
                <button type="button" disabled={busy !== null} onClick={() => void addProduct(product.productId)} className={adminButton}>
                  {busy === `add-${product.productId}` ? "Adding…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {(products ?? []).map((product) => (
        <ProductCard key={product._id} product={product} />
      ))}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const setColors = useMutation(api.merch.adminSetColors);
  const setActive = useMutation(api.merch.adminSetActive);
  const remove = useMutation(api.merch.adminRemove);
  const refresh = useAction(api.merch.adminAdd);
  const stored = product.colors.filter((c) => c.offered).map((c) => c.key);
  const [draft, setDraft] = useState<Array<string> | null>(null);
  const offered = draft ?? stored;
  const dirty = draft !== null && JSON.stringify([...draft].sort()) !== JSON.stringify([...stored].sort());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key: string) => setDraft(offered.includes(key) ? offered.filter((k) => k !== key) : [...offered, key]);

  return (
    <AdminSection
      title={product.name}
      description={`Printful #${product.productId} · ${product.colors.length} colors · ${offered.length} offered · read ${new Date(product.fetchedAt).toLocaleDateString()}`}
      className={product.active ? "border-foreground" : undefined}
      action={
        product.active ? (
          <span className="rounded-full bg-foreground px-3 py-1 text-xs font-black uppercase tracking-wider text-background">Active shirt</span>
        ) : (
          <button type="button" disabled={busy || dirty} onClick={() => void run(() => setActive({ productId: product._id as Id<"merchProducts"> }))} className={adminButton}>
            Make active
          </button>
        )
      }
    >
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
        {product.colors.map((color) => {
          const on = offered.includes(color.key);
          return (
            <button
              key={color.key}
              type="button"
              onClick={() => toggle(color.key)}
              aria-pressed={on}
              disabled={busy}
              className="flex flex-col items-center gap-1 text-center text-[11px] font-semibold leading-tight"
              title={`${color.name} ${color.hex}${color.inStock ? "" : " (out of stock)"}`}
            >
              <span
                className={cn("h-11 w-11 rounded-full border border-black/20", on && "ring-2 ring-foreground ring-offset-2", !color.inStock && "opacity-40")}
                style={{ background: color.hex }}
              />
              {color.name}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !dirty} onClick={() => void run(async () => { await setColors({ productId: product._id as Id<"merchProducts">, offered }); setDraft(null); })} className={adminButton}>
          Save colors
        </button>
        <button type="button" disabled={busy} onClick={() => setDraft(product.colors.filter((c) => c.inStock).map((c) => c.key))} className="text-sm font-semibold underline underline-offset-4">
          All in stock
        </button>
        <button type="button" disabled={busy} onClick={() => setDraft([])} className="text-sm font-semibold underline underline-offset-4">
          None
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => refresh({ productId: product.productId }))} className="text-sm font-semibold underline underline-offset-4">
          Refresh from Printful
        </button>
        {product.active ? (
          <button type="button" disabled={busy} onClick={() => void run(() => setActive({ productId: null }))} className="text-sm font-semibold underline underline-offset-4">
            Back to the launch colors
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(() => remove({ productId: product._id as Id<"merchProducts"> }))} className="text-sm font-semibold text-red-600 underline underline-offset-4">
            Remove
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
    </AdminSection>
  );
}

