import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { AdminSection, adminQuietButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/admin/metrics")({
  component: AdminMetrics,
});

const COLUMNS = [
  { key: "members", label: "Members" },
  { key: "generators", label: "Made designs" },
  { key: "batches", label: "Batches" },
  { key: "designs", label: "Designs" },
  { key: "publishedWorks", label: "Published" },
  { key: "remixes", label: "Remixes" },
  { key: "families", label: "Families" },
  { key: "creditsUsed", label: "Credits used" },
  { key: "modelPhotos", label: "Model photos" },
] as const;

const RANGES = [7, 14, 30, 90] as const;

function AdminMetrics() {
  const [days, setDays] = useState<number>(14);
  const summary = useQuery(api.metrics.summary, { days });
  const overview = useQuery(api.admin.overview, {});
  const recount = useMutation(api.metrics.recount);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const startRecount = async () => {
    setError("");
    setStatus("");
    try {
      await recount({ days });
      setStatus(`Counting the last ${days} days. The numbers fill in as it goes.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="All time"
        description={
          summary?.lastComputedAt
            ? `Counted by UTC day, every hour. Last count ${new Date(summary.lastComputedAt).toLocaleString()}.`
            : "Counted by UTC day, every hour. Nothing counted yet."
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {COLUMNS.map((column) => (
            <div key={column.key} className="rounded-xl border-2 border-border bg-background p-3">
              <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{column.label}</dt>
              <dd className="mt-1 text-3xl font-black tabular-nums">
                {summary ? summary.totals[column.key].toLocaleString() : "…"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Totals add up every counted day{summary ? ` (${summary.countedDays})` : ""}. “Made designs” counts each
          member once, on the day they first made something.
        </p>
      </AdminSection>

      <AdminSection
        title="By day"
        action={
          <div className="flex flex-wrap gap-2">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDays(range)}
                className={cn(
                  "h-9 rounded-full border-2 border-border px-3 text-sm font-bold",
                  days === range && "border-foreground bg-foreground text-background",
                )}
              >
                {range} days
              </button>
            ))}
          </div>
        }
      >
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left">
                <th className="sticky left-0 bg-card py-2 pr-4 font-black">Day</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="px-2 py-2 text-right font-black">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary?.days.map((day) => (
                <tr key={day.day} className="border-b border-border">
                  <td className="sticky left-0 bg-card py-2 pr-4 font-mono">
                    {day.day}
                    {!day.complete && (
                      <span className="ml-2 text-xs text-muted-foreground">{day.computedAt ? "counting" : "not counted"}</span>
                    )}
                  </td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-2 py-2 text-right tabular-nums">
                      {day[column.key].toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overview?.canManage && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className={adminQuietButton} onClick={() => void startRecount()}>
              Recount these {days} days
            </button>
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
          </div>
        )}
        {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
      </AdminSection>
    </div>
  );
}
