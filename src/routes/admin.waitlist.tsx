import { useConvex, useMutation, useQuery } from "convex/react";
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
        description="People who asked to hear when a design can be bought."
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

      <EmailTheList canManage={overview?.canManage === true} />

      <AdminSection title="By design" description="Most wanted first.">
        {totals && totals.works.length === 0 ? (
          <p className="text-muted-foreground">No sign-ups yet.</p>
        ) : (
          <ul className="divide-y-2 divide-border">
            {totals?.works.map((work) => (
              <li key={work.workId} className="flex items-center justify-between gap-4 py-3">
                <Link to="/cr/$cr" params={{ cr: work.cr }} className="flex min-w-0 items-baseline gap-3 hover:underline">
                  <span className="shrink-0 whitespace-nowrap font-cr text-xl">CR {work.cr}</span>
                  {work.title && <span className="min-w-0 truncate font-semibold text-muted-foreground">{work.title}</span>}
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

function people(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "person" : "people"}`;
}

// The one email the list was promised (convex/waitlist.ts emailOpen). It goes out when ops or the
// owner press Email them with Checkout on, never on its own, so a test order with Checkout on for a
// moment doesn't tell anyone buying is open.
function EmailTheList({ canManage }: { canManage: boolean }) {
  const summary = useQuery(api.waitlist.emailSummary, {});
  const emailOpen = useMutation(api.waitlist.emailOpen);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!summary) return null;

  const send = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await emailOpen({});
      setNote(
        result.more
          ? `Emailing ${people(result.sent)} now; the rest follow within a minute.`
          : result.sent > 0
            ? `Emailed ${people(result.sent)}.`
            : "Nobody was waiting on a design on sale.",
      );
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminSection
      title="Tell them it's open"
      description="Each person on the list gets one email naming every design they asked about that can be bought now. It goes out when you press Email them with Checkout on, so turning Checkout on for a test order doesn't send it."
      action={
        canManage ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !summary.checkoutOpen || summary.readyPeople === 0}
            className={adminButton}
          >
            {busy ? "Emailing…" : "Email them"}
          </button>
        ) : undefined
      }
    >
      <p className="text-sm">
        {summary.readyPeople > 0
          ? `${people(summary.readyPeople)} waiting on ${summary.readyDesigns} ${summary.readyDesigns === 1 ? "design" : "designs"} on sale now.`
          : "Nobody is waiting on a design that's on sale."}
        {!summary.checkoutOpen && summary.readyPeople > 0 ? " Turn Checkout on first." : ""}
      </p>
      {summary.waiting > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.waiting.toLocaleString()} more {summary.waiting === 1 ? "sign-up is" : "sign-ups are"} for designs not on sale yet. Approve
          them in For sale, then press Email them again.
        </p>
      )}
      {summary.notified > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.notified.toLocaleString()} {summary.notified === 1 ? "sign-up has" : "sign-ups have"} had their email.
        </p>
      )}
      {!canManage && <p className="mt-1 text-sm text-muted-foreground">Only ops and the owner can send it.</p>}
      {note && <p className="mt-3 text-sm font-semibold">{note}</p>}
    </AdminSection>
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
