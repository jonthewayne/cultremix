import { useConvex, useQuery } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { AdminSection, adminButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/waitlist")({
  component: AdminWaitlist,
});

const PAGE_SIZE = 500;

function AdminWaitlist() {
  const totals = useQuery(api.waitlist.adminTotals, {});
  const overview = useQuery(api.admin.overview, {});
  const convex = useConvex();
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const exportEmails = async () => {
    setExporting(true);
    setStatus("");
    setError("");
    try {
      const rows: Array<Array<string>> = [["email", "cr", "title", "member", "joined_at"]];
      let cursor: string | null = null;
      for (;;) {
        const result: FunctionReturnType<typeof api.waitlist.adminExportPage> = await convex.query(api.waitlist.adminExportPage, {
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        });
        for (const row of result.page) {
          rows.push([
            row.email,
            row.cr ?? "",
            row.title ?? "",
            row.member ? "yes" : "no",
            new Date(row.joinedAt).toISOString(),
          ]);
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      download(`cultremix-early-access-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(csvLine).join("\n"));
      setStatus(`Exported ${(rows.length - 1).toLocaleString()} sign-ups.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="Early access"
        description="People who asked to hear when a design can be bought. No one has been emailed yet."
        action={
          overview?.canManage ? (
            <button type="button" onClick={() => void exportEmails()} disabled={exporting} className={adminButton}>
              {exporting ? "Exporting…" : "Export emails"}
            </button>
          ) : undefined
        }
      >
        <div className="rounded-xl border-2 border-border bg-background p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sign-ups</p>
          <p className="mt-1 text-3xl font-black tabular-nums">{totals ? totals.total.toLocaleString() : "…"}</p>
          {totals && totals.works.length >= 100 && (
            <p className="mt-1 text-xs text-muted-foreground">Across the 100 most wanted designs.</p>
          )}
        </div>
        {overview && !overview.canManage && (
          <p className="mt-3 text-sm text-muted-foreground">Only ops and the owner can export emails.</p>
        )}
        {status && <p className="mt-3 text-sm font-semibold">{status}</p>}
        {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
      </AdminSection>

      <AdminSection title="By design" description="Most wanted first.">
        {totals && totals.works.length === 0 ? (
          <p className="text-muted-foreground">No sign-ups yet.</p>
        ) : (
          <ul className="divide-y-2 divide-border">
            {totals?.works.map((work) => (
              <li key={work.workId} className="flex items-center justify-between gap-4 py-3">
                <Link to="/cr/$cr" params={{ cr: work.cr }} className="min-w-0 hover:underline">
                  <span className="font-cr text-xl">CR {work.cr}</span>
                  {work.title && <span className="ml-3 truncate font-semibold text-muted-foreground">{work.title}</span>}
                </Link>
                <span className="shrink-0 text-2xl font-black tabular-nums">{work.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

// Quoted cells; a leading formula character is defused so spreadsheets show it as text.
function csvLine(cells: Array<string>) {
  return cells
    .map((cell) => {
      const safe = /^[=+\-@\t\r]/u.test(cell) ? `'${cell}` : cell;
      return `"${safe.replace(/"/gu, '""')}"`;
    })
    .join(",");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
