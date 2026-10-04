import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AdminSection, Toggle, adminButton, adminInput } from "~/components/admin/AdminSection";
import { BudgetCard } from "~/components/admin/BudgetCard";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  const overview = useQuery(api.admin.overview, {});
  if (!overview) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-6">
      <BudgetCard />
      <FlagsSection flags={overview.flags} canManage={overview.canManage} />
      <SettingsSection settings={overview.settings} canManage={overview.canManage} />
    </div>
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
            hint="The most CultRemix spends on images in a day. Not enforced yet: nothing stops at this amount."
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
