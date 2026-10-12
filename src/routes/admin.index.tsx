import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AdminSection, Toggle, adminButton, adminInput, adminQuietButton } from "~/components/admin/AdminSection";
import { BudgetCard } from "~/components/admin/BudgetCard";
import { BrowserErrors } from "~/components/admin/BrowserErrors";
import { GatewayCredit } from "~/components/admin/GatewayCredit";
import { Readiness } from "~/components/admin/Readiness";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  const overview = useQuery(api.admin.overview, {});
  if (!overview) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-6">
      <Readiness />
      <BudgetCard />
      <GatewayCredit />
      <BrowserErrors />
      <FlagsSection flags={overview.flags} canManage={overview.canManage} />
      <SettingsSection settings={overview.settings} canManage={overview.canManage} />
      <TakenDownSection />
    </div>
  );
}

// Designs an admin took down from their pages (convex/moderation.ts), with Put it back up.
function TakenDownSection() {
  const data = useQuery(api.moderation.withdrawn, {});
  const restore = useMutation(api.moderation.restore);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!data) return null;

  const putBack = async (workId: (typeof data.works)[number]["workId"]) => {
    setError("");
    setBusy(workId);
    try {
      await restore({ workId });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminSection
      title="Taken down"
      description="Designs taken down with Take this design down on their pages. Putting one back up publishes it again; selling it takes a new approval in For sale."
    >
      {data.works.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been taken down.</p>
      ) : (
        <ul className="grid gap-3">
          {data.works.map((work) => (
            <li key={work.workId} className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-border p-3">
              {work.thumbUrl && <img src={work.thumbUrl} alt="" className="size-12 shrink-0 rounded-lg object-contain" />}
              {/* At least 12rem, so on a phone Put it back up wraps below rather than squeezing the text. */}
              <div className="min-w-[12rem] flex-1">
                <p className="font-black">
                  CR {work.cr}
                  {work.title ? ` · ${work.title}` : ""}
                  {work.creator && <span className="font-normal text-muted-foreground"> by @{work.creator}</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {work.reason}
                  {work.withdrawnAt ? ` · ${new Date(work.withdrawnAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              {data.canManage && (
                <button type="button" className={adminQuietButton} disabled={busy !== null} onClick={() => void putBack(work.workId)}>
                  {busy === work.workId ? "Putting it back…" : "Put it back up"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
    </AdminSection>
  );
}

type Flag = { key: string; label: string; description: string; notWiredYet?: string; enabled: boolean; isSet: boolean };

function FlagsSection({ flags, canManage }: { flags: Array<Flag>; canManage: boolean }) {
  const setFlag = useMutation(api.admin.setFlag);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const change = async (key: string, enabled: boolean) => {
    setError("");
    setBusy(key);
    try {
      await setFlag({ key, enabled });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminSection
      title="Switches"
      description={canManage ? "Turn parts of CultRemix on and off. Changes apply right away." : "Only ops and the owner can change these."}
    >
      <ul className="divide-y divide-border">
        {flags.map((flag) => (
          <li key={flag.key} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-black">
                {flag.label}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{flag.key}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{flag.description}</p>
              {flag.notWiredYet && <p className="mt-1 text-sm font-semibold">{flag.notWiredYet}</p>}
              {!flag.isSet && <p className="mt-1 text-xs text-muted-foreground">Not set yet, so it uses its default.</p>}
            </div>
            <Toggle
              label={flag.label}
              checked={flag.enabled}
              disabled={!canManage || busy === flag.key}
              onChange={(next) => void change(flag.key, next)}
            />
          </li>
        ))}
      </ul>
      {error && <p className="mt-4 text-sm font-semibold text-destructive">{error}</p>}
    </AdminSection>
  );
}

type Settings = {
  signupGrantEnabled: boolean;
  signupGrantCredits: number;
  dailyBudgetCents: number;
  shootsPerMemberPerDay: number;
  updatedAt: number;
};

function SettingsSection({ settings, canManage }: { settings: Settings; canManage: boolean }) {
  const updateSettings = useMutation(api.admin.updateSettings);
  const [grantOn, setGrantOn] = useState(settings.signupGrantEnabled);
  const [grantCredits, setGrantCredits] = useState(String(settings.signupGrantCredits));
  const [budgetDollars, setBudgetDollars] = useState(String(settings.dailyBudgetCents / 100));
  const [shoots, setShoots] = useState(String(settings.shootsPerMemberPerDay));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGrantOn(settings.signupGrantEnabled);
    setGrantCredits(String(settings.signupGrantCredits));
    setBudgetDollars(String(settings.dailyBudgetCents / 100));
    setShoots(String(settings.shootsPerMemberPerDay));
  }, [settings]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSaving(true);
    try {
      await updateSettings({
        signupGrantEnabled: grantOn,
        signupGrantCredits: Number(grantCredits),
        dailyBudgetCents: Math.round(Number(budgetDollars) * 100),
        shootsPerMemberPerDay: Number(shoots),
      });
      setStatus("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSection
      title="Settings"
      description={settings.updatedAt ? `Last changed ${new Date(settings.updatedAt).toLocaleString()}.` : "Still on the defaults."}
    >
      <form className="space-y-5" onSubmit={save}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-black">Credits for new members</p>
            <p className="mt-1 text-sm text-muted-foreground">Given once, when someone picks a username.</p>
          </div>
          <Toggle label="Credits for new members" checked={grantOn} disabled={!canManage} onChange={setGrantOn} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Signup credits" value={grantCredits} onChange={setGrantCredits} disabled={!canManage} min={0} max={1000} />
          <NumberField
            label="Daily image budget ($)"
            hint="The most CultRemix spends a day (UTC) on each paid image service: the CultRemix Gateway and fal upscales. Each call holds its worst-case cost until it settles; once the day is full, new calls wait until tomorrow."
            value={budgetDollars}
            onChange={setBudgetDollars}
            disabled={!canManage}
            min={0}
            max={10000}
            step={0.01}
          />
          <NumberField
            label="Photo shoots per member a day"
            hint="Model photos each member can start a day (UTC), at publish or a reshoot. The owner has no limit."
            value={shoots}
            onChange={setShoots}
            disabled={!canManage}
            min={0}
            max={100}
          />
        </div>
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        {canManage && (
          <div className="flex items-center gap-4">
            <button type="submit" className={adminButton} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
          </div>
        )}
      </form>
    </AdminSection>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  disabled,
  min,
  max,
  step = 1,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-bold">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        className={adminInput}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        required
      />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
