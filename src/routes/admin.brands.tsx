import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AdminSection, adminButton, adminInput, adminQuietButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/brands")({
  component: AdminBrands,
});

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

// Brands and rights holders (economics v2 and v3): a member account paid its rate of every sale in
// the design families it owns or licenses, on top of the creators' share, which its agreement can
// also set for those families (15% unless agreed otherwise).
function AdminBrands() {
  const data = useQuery(api.brands.list, {});
  const save = useMutation(api.brands.save);
  const deactivate = useMutation(api.brands.deactivate);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [creatorRate, setCreatorRate] = useState("");
  const [families, setFamilies] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const defaultRate = data ? String(data.defaultBps / 100) : "10";
  const defaultCreatorRate = data ? String(data.defaultCreatorBps / 100) : "15";
  const minCreatorRate = data ? data.minCreatorBps / 100 : 5;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    const list = parseFamilies(families);
    if (!list) {
      setError("List the brand's families by their CR numbers, like 101, 104.");
      return;
    }
    const percent = Number((rate.trim() || defaultRate).replace(/%$/u, ""));
    if (!Number.isFinite(percent) || percent <= 0) {
      setError("Give a rate above 0%.");
      return;
    }
    // Left empty, creators keep the standard share.
    const creatorText = creatorRate.trim().replace(/%$/u, "");
    const creatorPercent = creatorText ? Number(creatorText) : null;
    if (creatorPercent !== null && (!Number.isInteger(creatorPercent) || creatorPercent < minCreatorRate)) {
      setError(`Give the creators’ share as a whole percent, at least ${minCreatorRate}%.`);
      return;
    }
    setBusy(true);
    try {
      await save({
        username,
        name,
        bps: Math.round(percent * 100),
        ...(creatorPercent !== null ? { creatorBps: creatorPercent * 100 } : {}),
        families: list,
      });
      const creators = creatorPercent !== null ? `${creatorPercent}%` : `${defaultCreatorRate}%`;
      setStatus(
        `Saved ${name.trim()}: ${percentText(Math.round(percent * 100))} of each sale in ${list.length === 1 ? "family" : "families"} ${list.join(", ")}, with creators at ${creators}.`,
      );
      setUsername("");
      setName("");
      setRate("");
      setCreatorRate("");
      setFamilies("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const edit = (brand: { username: string; name: string; bps: number; creatorBps: number | null; families: Array<number> }) => {
    setUsername(brand.username);
    setName(brand.name);
    setRate(String(brand.bps / 100));
    setCreatorRate(brand.creatorBps === null ? "" : String(brand.creatorBps / 100));
    setFamilies(brand.families.join(", "));
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

  return (
    <div className="space-y-6">
      <AdminSection
        title="Brands"
        description={`A brand or rights holder is paid its rate of every sale in the design families it owns or licenses, ${percentText(data?.defaultBps ?? 1000)} unless you agree another. It comes out of CultRemix's share. Creators keep ${defaultCreatorRate}% unless the brand's agreement sets their share in its families (at least ${minCreatorRate}%), and a brand that made a family's original gets that creator share too. The design's page shows the split. Orders already paid keep the split they were sold under.`}
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
              <span className="text-sm font-bold">Rate (% of the price)</span>
              <input className={adminInput} value={rate} onChange={(e) => setRate(e.target.value)} placeholder={defaultRate} inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Creators’ share in its families (% of the price)</span>
              <input
                className={adminInput}
                value={creatorRate}
                onChange={(e) => setCreatorRate(e.target.value)}
                placeholder={defaultCreatorRate}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Families (CR numbers)</span>
              <input className={adminInput} value={families} onChange={(e) => setFamilies(e.target.value)} placeholder="101, 104" required />
            </label>
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          {status && <p className="text-sm font-semibold">{status}</p>}
          <button type="submit" className={adminButton} disabled={busy}>
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
                    {percentText(brand.bps)} of each sale · creators {percentText(brand.creatorBps ?? data.defaultCreatorBps)} ·{" "}
                    {brand.families.length === 1 ? "family" : "families"} {brand.families.join(", ")}
                  </p>
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
