import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AdminSection } from "~/components/admin/AdminSection";
import { cn } from "~/lib/utils";

// Cents as dollars: 1234 -> "$12.34"; fractions of a cent round to the nearest cent.
export function formatDollars(cents: number) {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

const PROVIDER_LABEL = { gateway: "Studio images", fal: "Upscales" } as const;

// Today's image spend against the daily cap (convex/budget.ts today).
export function BudgetCard() {
  const today = useQuery(api.budget.today, {});
  if (!today) return null;
  return (
    <AdminSection
      title="Today's spend"
      description={`Image calls since midnight UTC (${today.dayUtc}). Open holds are each call's worst case until it settles.`}
    >
      <div className="space-y-6">
        {today.providers
          .filter((day) => day.provider === "gateway" || day.settledCents > 0 || day.openCount > 0)
          .map((day) => {
            const used = day.settledCents + day.openCents;
            const share = day.capCents > 0 ? Math.min(100, (used / day.capCents) * 100) : 100;
            return (
              <div key={day.provider} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-black">{PROVIDER_LABEL[day.provider]}</p>
                  {!day.on && (
                    <p className="rounded-lg bg-foreground px-2 py-0.5 text-xs font-black text-background">Switched off</p>
                  )}
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${share}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Spent" value={formatDollars(day.settledCents)} />
                  <Stat label={`Open holds (${day.openCount})`} value={formatDollars(day.openCents)} />
                  <Stat label="Left" value={formatDollars(day.leftCents)} />
                  <Stat label="Daily cap" value={formatDollars(day.capCents)} />
                </dl>
                <p className="text-xs text-muted-foreground">
                  {day.reportedCount} {day.reportedCount === 1 ? "call" : "calls"} settled at the reported cost,{" "}
                  {day.worstCaseCount} at the worst case.
                </p>
                {day.overageCents > 0 && (
                  <p className="text-sm font-semibold text-destructive">
                    Calls cost {formatDollars(day.overageCents)} more than their holds today
                    {day.on ? "." : ", so this was switched off. Check the prices, then turn it back on in Switches."}
                  </p>
                )}
              </div>
            );
          })}
      </div>
    </AdminSection>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border-2 border-border bg-background p-3", className)}>
      <dt className="text-xs font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-black tabular-nums">{value}</dd>
    </div>
  );
}
