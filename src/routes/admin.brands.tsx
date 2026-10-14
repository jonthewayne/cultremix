import { useAction, useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { SHOP_COSTS } from "../../shared/config/shopCosts";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { ShirtSplit } from "~/lib/shirtMath";
import { AdminSection, adminButton, adminInput, adminQuietButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { formatCents } from "~/lib/money";
import { costFor, shirtMath } from "~/lib/shirtMath";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/admin/brands")({
  component: AdminBrands,
});

// The sizes priced at the regular price, and at the large one.
const REGULAR_SIZES = ["S", "M", "L", "XL"];
const LARGE_SIZES = ["2XL"];

// "101, 104 107" -> [101, 104, 107]; null when anything isn't a family number.
function parseFamilies(text: string): Array<number> | null {
  const parts = text.split(/[\s,]+/u).map((part) => part.trim().replace(/^cr\s*/iu, "")).filter(Boolean);
  if (parts.length === 0) return null;
  const families = parts.map((part) => (/^\d{1,6}$/u.test(part) ? Number(part) : Number.NaN));
  return families.some((family) => !Number.isInteger(family) || family < 1) ? null : families;
}

function percentText(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// "25", "25%" -> 2500; null for anything but a whole percent.
function wholePercent(text: string): number | null {
  const value = Number(text.trim().replace(/%$/u, ""));
  return text.trim() && Number.isInteger(value) && value >= 0 ? value * 100 : null;
}

type Limits = FunctionReturnType<typeof api.brands.list>["limits"];
type Costs = Array<{ productId: number; sizes: Array<{ size: string; cents: number }> }>;

// Brands and rights holders (economics v4): a member account whose design families pay a share of
// each sale, set here, which the brand splits with the families' creators on its own page.
function AdminBrands() {
  const data = useQuery(api.brands.list, {});
  const save = useMutation(api.brands.save);
  const deactivate = useMutation(api.brands.deactivate);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const [creators, setCreators] = useState("");
  const [families, setFamilies] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const limits = data?.limits;
  // Empty fields mean the starting deal.
  const totalBps = wholePercent(total || String((limits?.defaultTotalBps ?? 2500) / 100));
  const creatorBps = wholePercent(creators || String((limits?.defaultCreatorBps ?? 1000) / 100));
  const problem = !limits
    ? null
    : totalBps === null || totalBps < limits.minCreatorBps || totalBps > limits.maxTotalBps
      ? `The family's share is a whole percent from ${percentText(limits.minCreatorBps)} to ${percentText(limits.maxTotalBps)}.`
      : creatorBps === null || creatorBps < limits.minCreatorBps || creatorBps > totalBps
        ? `The creators' share is a whole percent from ${percentText(limits.minCreatorBps)} to ${percentText(totalBps)}.`
        : null;
  const split: ShirtSplit | null =
    limits && !problem && totalBps !== null && creatorBps !== null
      ? { creatorBps, brandBps: totalBps - creatorBps, linkBps: limits.affiliateBps }
      : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    const list = parseFamilies(families);
    if (!list) {
      setError("List the brand's families by their CR numbers, like 101, 104.");
      return;
    }
    if (problem || totalBps === null || creatorBps === null) {
      setError(problem ?? "Check the shares.");
      return;
    }
    setBusy(true);
    try {
      await save({ username, name, totalBps, creatorBps, families: list, ...(note.trim() ? { note } : {}) });
      setStatus(
        `Saved ${name.trim()}: ${percentText(totalBps)} of each sale in ${list.length === 1 ? "family" : "families"} ${list.join(", ")}, ${percentText(totalBps - creatorBps)} to the brand and ${percentText(creatorBps)} to creators.`,
      );
      setUsername("");
      setName("");
      setTotal("");
      setCreators("");
      setFamilies("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const edit = (brand: { username: string; name: string; totalBps: number; creatorBps: number; families: Array<number>; note?: string }) => {
    setUsername(brand.username);
    setName(brand.name);
    setTotal(String(brand.totalBps / 100));
    setCreators(String(brand.creatorBps / 100));
    setFamilies(brand.families.join(", "));
    setNote(brand.note ?? "");
    setStatus("");
    setError("");
  };

  const stop = async (brandId: Id<"brands">) => {
    setError("");
    try {
      await deactivate({ brandId });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const defaultTotal = limits ? String(limits.defaultTotalBps / 100) : "25";
  const defaultCreators = limits ? String(limits.defaultCreatorBps / 100) : "10";

  return (
    <div className="space-y-6">
      <AdminSection
        title="Brands"
        description={
          limits
            ? `A brand deal is one number: its families' share of each sale, which the brand splits with the families' creators. It comes out of CultRemix's share, so it's the only number that changes what we keep. Deals start at ${percentText(limits.defaultTotalBps)} (${percentText(limits.defaultTotalBps - limits.defaultCreatorBps)} to the brand, ${percentText(limits.defaultCreatorBps)} to creators) and go up to ${percentText(limits.maxTotalBps)}. The brand can move the creators' part on its brand page, never under ${percentText(limits.minCreatorBps)}. Only admins make brands. Orders already paid keep the split they were sold under.`
            : "Loading…"
        }
      >
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Member username</span>
              <input className={adminInput} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="stussy" required />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Brand name</span>
              <input className={adminInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Stüssy" maxLength={60} required />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Families (CR numbers)</span>
              <input className={adminInput} value={families} onChange={(e) => setFamilies(e.target.value)} placeholder="101, 104" required />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-bold">Families' share (%)</span>
                <input className={adminInput} value={total} onChange={(e) => setTotal(e.target.value)} placeholder={defaultTotal} inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-bold">Creators' part (%)</span>
                <input className={adminInput} value={creators} onChange={(e) => setCreators(e.target.value)} placeholder={defaultCreators} inputMode="numeric" />
              </label>
            </div>
            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-bold">What we agreed (only admins see this)</span>
              <textarea
                className={cn(adminInput, "h-auto min-h-20 py-2")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="They promote CultRemix to their followers; reviewed every quarter."
              />
            </label>
          </div>
          <p className={cn("text-sm font-semibold", problem && "text-destructive")}>
            {problem ??
              (split
                ? `The brand gets ${percentText(split.brandBps)} and the families' creators share ${percentText(split.creatorBps)} of each sale.`
                : "")}
          </p>
          {limits && <ShirtMoney split={split} limits={limits} />}
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          {status && <p className="text-sm font-semibold">{status}</p>}
          <button type="submit" className={adminButton} disabled={busy || Boolean(problem)}>
            {busy ? "Saving…" : "Save brand"}
          </button>
        </form>
      </AdminSection>

      <AdminSection title="Brands on CultRemix">
        {!data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : data.brands.length === 0 ? (
          <p className="text-muted-foreground">No brands yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.brands.map((brand) => (
              <li key={brand.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-black">
                    {brand.name} <span className="font-normal text-muted-foreground">@{brand.username}</span>
                    {!brand.active && <span className="ml-2 text-sm font-bold text-muted-foreground">Stopped</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {percentText(brand.totalBps)} of each sale: {percentText(brand.brandBps)} to the brand, {percentText(brand.creatorBps)} to creators
                    {brand.setByBrand ? " (set by the brand)" : ""} · {brand.families.length === 1 ? "family" : "families"} {brand.families.join(", ")}
                  </p>
                  {brand.note && <p className="mt-1 text-sm">{brand.note}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className={adminQuietButton} onClick={() => edit(brand)}>
                    {brand.active ? "Edit" : "Start again"}
                  </button>
                  {brand.active && (
                    <button type="button" className={adminQuietButton} onClick={() => void stop(brand.id)}>
                      Stop
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

// What one shirt pays everyone under the deal being edited, beside the standard split (no brand),
// for each product on offer: Printful's price from its catalog, the card fee, each share, and what
// CultRemix keeps. A share link is counted, the case that leaves us least.
function ShirtMoney({ split, limits }: { split: ShirtSplit | null; limits: Limits }) {
  const products = useQuery(api.merch.offered, {});
  const loadCosts = useAction(api.merch.adminCosts);
  const [costs, setCosts] = useState<Costs | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    loadCosts({})
      .then((rows) => live && setCosts(rows))
      .catch(() => live && setCosts("failed"));
    return () => {
      live = false;
    };
  }, [loadCosts]);

  if (!products || costs === null) return <p className="text-sm text-muted-foreground">Getting Printful's prices…</p>;
  if (costs === "failed") return <p className="text-sm text-muted-foreground">Printful's prices didn't load, so the money per shirt can't be shown.</p>;
  const standard: ShirtSplit = { creatorBps: limits.standardCreatorBps, brandBps: 0, linkBps: limits.affiliateBps };
  const rows = products.flatMap((product) => {
    const sizes = costs.find((row) => row.productId === product.productId)?.sizes ?? [];
    return [
      { label: `${product.name}, S to XL`, priceCents: product.priceCents, costCents: costFor(sizes, REGULAR_SIZES) },
      { label: `${product.name}, 2XL`, priceCents: product.largePriceCents, costCents: costFor(sizes, LARGE_SIZES) },
    ];
  });
  const header = "px-2 py-2 text-right font-bold";
  const cell = "px-2 py-2 text-right tabular-nums";
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-wider">What one shirt pays</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="px-2 py-2 text-left font-bold">Shirt</th>
              <th className={header}>Price</th>
              <th className={header}>Printful</th>
              <th className={header}>Card fee</th>
              <th className={header}>Creators</th>
              <th className={header}>Brand</th>
              <th className={header}>Share link</th>
              <th className={header}>We keep</th>
              <th className={header}>No brand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              if (row.costCents === null) {
                return (
                  <tr key={row.label}>
                    <td className="px-2 py-2">{row.label}</td>
                    <td className={cell}>{formatCents(row.priceCents)}</td>
                    <td colSpan={7} className="px-2 py-2 text-muted-foreground">
                      Printful's catalog has no price for this.
                    </td>
                  </tr>
                );
              }
              const base = shirtMath(row.priceCents, row.costCents, standard);
              const deal = split ? shirtMath(row.priceCents, row.costCents, split) : null;
              const low = (cents: number) => cents < SHOP_COSTS.keepFloorCents;
              return (
                <tr key={row.label}>
                  <td className="px-2 py-2">{row.label}</td>
                  <td className={cell}>{formatCents(row.priceCents)}</td>
                  <td className={cell}>{formatCents(base.printfulCents)}</td>
                  <td className={cell}>{formatCents(base.cardFeeCents)}</td>
                  <td className={cell}>{deal ? formatCents(deal.creatorCents) : "–"}</td>
                  <td className={cell}>{deal ? formatCents(deal.brandCents) : "–"}</td>
                  <td className={cell}>{formatCents(base.linkCents)}</td>
                  <td className={cn(cell, "font-black", deal && low(deal.keepCents) && "text-destructive")}>
                    {deal ? formatCents(deal.keepCents) : "–"}
                  </td>
                  <td className={cn(cell, "text-muted-foreground", low(base.keepCents) && "text-destructive")}>{formatCents(base.keepCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        One shirt in a one-shirt order, front print, with a share link (the case that leaves us least). The buyer pays{" "}
        {formatCents(SHOP_COSTS.shippingChargedCents)} shipping and Printful charges {formatCents(SHOP_COSTS.printfulShippingCents)}; Printful is its
        catalog price for the size (the costliest color) plus that shipping. The card fee is 2.9% + 30¢ of everything the buyer pays. Shares
        are of the shirt's price. Red means we'd keep less than {formatCents(SHOP_COSTS.keepFloorCents)}.
      </p>
    </div>
  );
}
