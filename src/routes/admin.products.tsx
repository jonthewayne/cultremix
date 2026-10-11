import { useAction, useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GARMENT_KINDS, GARMENT_KIND_KEYS, formatPrice } from "../../shared/config/print-products";
import type { GarmentKind } from "../../shared/config/print-products";
import { AdminSection, adminButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

// The products CultRemix offers: search Printful's catalog, add a product with its real colors and
// print placements, pick which colors are offered, put products on offer, and set how each sells
// (the name buyers see, prices, what a back print adds, print areas). Creators pick from the
// products on offer when publishing. The default product's offered colors are what the studio
// previews on and the publish dialog offers (convex/merch.ts).
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
            ? `From ${palette.product.name}, the default product. The studio previews on these, and the publish dialog offers them. Other products sell in the ones they carry.`
            : "No product picked yet, so the launch shirt and colors are on offer. Add a product below and make it the default."
        }
      >
        <div className="flex flex-wrap gap-3">
          {(palette?.colors ?? []).map((color) => (
            <span key={color.key} className="flex w-16 flex-col items-center gap-1 text-center text-[11px] font-semibold leading-tight">
              <span className="h-10 w-10 rounded-full border border-black/20 ring-1 ring-white/25" style={{ background: color.hex }} />
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
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
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
  const setOffered = useMutation(api.merch.adminSetOffered);
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
      className={product.offered ? "border-foreground" : undefined}
      action={
        product.active ? (
          <span className="rounded-full bg-foreground px-3 py-1 text-xs font-black uppercase tracking-wider text-background">Default · on offer</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || dirty}
              aria-pressed={product.offered}
              onClick={() => void run(() => setOffered({ productId: product._id as Id<"merchProducts">, offered: !product.offered }))}
              className={cn(adminButton, product.offered && "bg-foreground text-background")}
            >
              {product.offered ? "On offer" : "Put on offer"}
            </button>
            <button type="button" disabled={busy || dirty} onClick={() => void run(() => setActive({ productId: product._id as Id<"merchProducts"> }))} className={adminButton}>
              Make default
            </button>
          </div>
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
          <button type="button" disabled={busy} onClick={() => void run(() => remove({ productId: product._id as Id<"merchProducts"> }))} className="text-sm font-semibold text-destructive underline underline-offset-4">
            Remove
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
      <SaleSettings product={product} />
    </AdminSection>
  );
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/u, "");
const toCents = (text: string) => Math.round(Number(text) * 100);

// How a product sells: the name buyers see, what it is, prices, what a back print adds, and its
// print areas. Saving sets every field; "Use the defaults" clears them.
function SaleSettings({ product }: { product: Product }) {
  const save = useMutation(api.merch.adminSetSale);
  const checkAreas = useAction(api.merch.adminCheckAreas);
  const printfulReady = useQuery(api.merch.printfulReady, {});
  const sale = product.sale;
  const initial = () => ({
    name: sale.name,
    kind: sale.kind,
    price: dollars(sale.priceCents),
    large: dollars(sale.largePriceCents),
    back: dollars(sale.backExtraCents),
    frontW: String(sale.front.widthIn),
    frontH: String(sale.front.heightIn),
    backW: String(sale.back?.widthIn ?? ""),
    backH: String(sale.back?.heightIn ?? ""),
  });
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const set = (field: keyof ReturnType<typeof initial>) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: event.target.value });
  const catalogExtras = (product.placements ?? [])
    .filter((placement) => placement.id !== "front")
    .map((placement) => `${placement.id === "front_large" ? "large front" : placement.id} +${formatPrice(placement.extraCents)}`);

  const submit = async (reset: boolean) => {
    setBusy(true);
    setNote("");
    try {
      await save(
        reset
          ? { productId: product._id as Id<"merchProducts"> }
          : {
              productId: product._id as Id<"merchProducts">,
              shopName: form.name,
              kind: form.kind as GarmentKind,
              priceCents: toCents(form.price),
              largePriceCents: toCents(form.large),
              backExtraCents: toCents(form.back),
              frontArea: { widthIn: Number(form.frontW), heightIn: Number(form.frontH) },
              ...(sale.back ? { backArea: { widthIn: Number(form.backW), heightIn: Number(form.backH) } } : {}),
            },
      );
      setNote(reset ? "Back to the defaults." : "Saved. Works approved from now on use it.");
      if (reset) setOpen(false);
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const input = "h-10 w-full rounded-lg border-2 border-border bg-background px-2";
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-bold">{sale.name}</span> · {GARMENT_KINDS[sale.kind].label} · {formatPrice(sale.priceCents)} (2XL {formatPrice(sale.largePriceCents)})
          {sale.back ? ` · back print +${formatPrice(sale.backExtraCents)}` : " · front only"} · front {sale.front.widthIn} × {sale.front.heightIn} in
          {sale.back ? `, back ${sale.back.widthIn} × ${sale.back.heightIn} in` : ""}
        </p>
        <button
          type="button"
          onClick={() => {
            setForm(initial());
            setOpen(!open);
          }}
          className="text-sm font-semibold underline underline-offset-4"
        >
          {open ? "Close" : "Edit how it sells"}
        </button>
      </div>
      {catalogExtras.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">Printful charges extra for: {catalogExtras.join(", ")}.</p>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {product.areasCheckedAt
          ? `Print areas read from Printful's print files on ${new Date(product.areasCheckedAt).toLocaleDateString()}.`
          : "Print areas are Printful's published sizes, not yet checked against its print files."}
        <button
          type="button"
          disabled={busy || !printfulReady}
          title={printfulReady ? undefined : "Needs PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID"}
          onClick={() => {
            setBusy(true);
            setNote("");
            checkAreas({ productId: product._id as Id<"merchProducts"> })
              .then((areas) =>
                setNote(
                  `Printful's print files: front ${areas.front?.widthIn} × ${areas.front?.heightIn} in${areas.back ? `, back ${areas.back.widthIn} × ${areas.back.heightIn} in` : ", no back"}.`,
                ),
              )
              .catch((err) => setNote(errorMessage(err)))
              .finally(() => setBusy(false));
          }}
          className="font-semibold text-foreground underline underline-offset-4 disabled:opacity-40"
        >
          Check with Printful
        </button>
      </p>
      {open && (
        <form
          className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <label className="col-span-2 text-xs font-bold uppercase tracking-wider">
            Name buyers see
            <input value={form.name} onChange={set("name")} maxLength={60} className={cn(input, "mt-1 normal-case tracking-normal")} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider">
            Kind
            <select value={form.kind} onChange={set("kind")} className={cn(input, "mt-1 normal-case tracking-normal")}>
              {GARMENT_KIND_KEYS.map((kind) => (
                <option key={kind} value={kind}>
                  {GARMENT_KINDS[kind].label}
                </option>
              ))}
            </select>
          </label>
          <span />
          <label className="text-xs font-bold uppercase tracking-wider">
            Price, S–XL ($)
            <input value={form.price} onChange={set("price")} inputMode="decimal" className={cn(input, "mt-1")} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider">
            2XL price ($)
            <input value={form.large} onChange={set("large")} inputMode="decimal" className={cn(input, "mt-1")} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider">
            Back print adds ($)
            <input value={form.back} onChange={set("back")} inputMode="decimal" disabled={!sale.back} className={cn(input, "mt-1")} />
          </label>
          <span />
          <label className="text-xs font-bold uppercase tracking-wider">
            Front width (in)
            <input value={form.frontW} onChange={set("frontW")} inputMode="decimal" className={cn(input, "mt-1")} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider">
            Front height (in)
            <input value={form.frontH} onChange={set("frontH")} inputMode="decimal" className={cn(input, "mt-1")} />
          </label>
          {sale.back && (
            <>
              <label className="text-xs font-bold uppercase tracking-wider">
                Back width (in)
                <input value={form.backW} onChange={set("backW")} inputMode="decimal" className={cn(input, "mt-1")} />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider">
                Back height (in)
                <input value={form.backH} onChange={set("backH")} inputMode="decimal" className={cn(input, "mt-1")} />
              </label>
            </>
          )}
          <div className="col-span-2 flex flex-wrap items-center gap-3 md:col-span-4">
            <button type="submit" disabled={busy} className={adminButton}>
              {busy ? "Saving…" : "Save"}
            </button>
            {sale.custom.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void submit(true)} className="text-sm font-semibold underline underline-offset-4">
                Use the defaults
              </button>
            )}
          </div>
        </form>
      )}
      {note && <p className="mt-2 text-sm font-semibold">{note}</p>}
    </div>
  );
}

