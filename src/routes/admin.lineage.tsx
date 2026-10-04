import { useMutation, useQuery } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useCurrentUser } from "~/hooks/use-auth";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/lineage")({
  head: () => ({ meta: [{ title: "Lineage corrections · CultRemix" }] }),
  component: LineageAdminPage,
});

type Kind = "original" | "variation" | "fork";
type Amendment = FunctionReturnType<typeof api.lineage.adminHistory>["amendments"][number];

const KIND_LABEL: Record<Kind, string> = { original: "Original", variation: "Variation", fork: "Fork" };

function describe(kind: Kind, parentCr?: string) {
  return parentCr ? `${KIND_LABEL[kind]} of CR ${parentCr}` : KIND_LABEL[kind];
}

// Matches the server's lineage admin check (convex/lineage.ts).
function isLineageAdmin(role: string | undefined) {
  return role === "super_admin_owner" || role === "super_admin_ops";
}

function LineageAdminPage() {
  const user = useCurrentUser();
  const isAdmin = isLineageAdmin(user?.platformRole);
  if (!isAdmin) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Unauthorized</CardTitle>
            <CardDescription>Lineage corrections are for the owner and operations admins.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/studio">Back to the studio</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }
  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title="Lineage corrections"
          description="Correct a work's parent or kind. The original record stays as published, and descendants keep their own parents."
        />
        <RequestCard />
        <HistoryCard />
      </div>
    </>
  );
}

function RequestCard() {
  const [lookup, setLookup] = useState("");
  const [cr, setCr] = useState("");
  const work = useQuery(api.lineage.adminWork, cr ? { cr } : "skip");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a correction</CardTitle>
        <CardDescription>Look up the work by its CR number.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setCr(lookup.trim());
          }}
        >
          <div className="grid min-w-0 flex-1 gap-2 sm:max-w-xs">
            <Label htmlFor="lineage-cr">CR number</Label>
            <Input id="lineage-cr" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="101-002" className="font-cr" />
          </div>
          <Button type="submit" variant="outline">
            Look up
          </Button>
        </form>
        {cr && work === null && <p className="text-sm text-muted-foreground">No work has that CR number.</p>}
        {work && <RequestForm key={work.cr} work={work} />}
      </CardContent>
    </Card>
  );
}

function RequestForm({ work }: { work: NonNullable<FunctionReturnType<typeof api.lineage.adminWork>> }) {
  const request = useMutation(api.lineage.requestAmendment);
  const [newKind, setNewKind] = useState<Kind>(work.allowedKinds[0] ?? "variation");
  const [newParentCr, setNewParentCr] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await request({
        cr: work.cr,
        newKind,
        newParentCr: newKind === "original" ? undefined : newParentCr.trim() || undefined,
        reason,
      });
      setDone(true);
      setReason("");
      setNewParentCr("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const amended = work.effectiveKind !== work.kind || work.effectiveParentCr !== work.parentCr;
  return (
    <div className="space-y-4 rounded-md border bg-background p-4">
      <div className="text-sm">
        <div className="font-medium">
          <span className="font-cr">CR {work.cr}</span>
          {work.title && <span> · {work.title}</span>} <span className="text-muted-foreground">by @{work.username}</span>
        </div>
        <div className="mt-1 text-muted-foreground">
          Family {work.family} · {work.status} · published as {describe(work.kind, work.parentCr)}
          {amended && <span> · now {describe(work.effectiveKind, work.effectiveParentCr)}</span>}
        </div>
      </div>
      {work.open ? (
        <p className="text-sm">This work already has a correction in progress. See the history below.</p>
      ) : done ? (
        <p className="text-sm">Requested. Confirm or cancel it in the history below.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="lineage-kind">New kind</Label>
              <select
                id="lineage-kind"
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as Kind)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {work.allowedKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {work.effectiveKind === "variation"
                  ? "A variation can only move to another design in its family."
                  : "A family root can become an original or a fork, but not a variation."}
              </p>
            </div>
            {newKind !== "original" && (
              <div className="grid gap-2">
                <Label htmlFor="lineage-parent">New parent CR</Label>
                <Input
                  id="lineage-parent"
                  value={newParentCr}
                  onChange={(event) => setNewParentCr(event.target.value)}
                  placeholder="101-001"
                  className="font-cr"
                  required
                />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lineage-reason">Reason (shown on the work page)</Label>
            <Input
              id="lineage-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={280}
              placeholder="The creator remixed CR 101-001, not CR 101-003."
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={saving}>
            {saving ? "Requesting…" : "Request correction"}
          </Button>
        </form>
      )}
    </div>
  );
}

function HistoryCard() {
  const history = useQuery(api.lineage.adminHistory, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          {history === undefined
            ? "Loading…"
            : history.chainWrites
              ? "Chain writes are on. Requested corrections go to Monad and confirm from there."
              : "Chain writes are off. You can confirm a request here, offchain only: it changes CultRemix, not Monad."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {history?.amendments.length === 0 && <p className="text-sm text-muted-foreground">No corrections yet.</p>}
        {history?.amendments.map((row) => (
          <HistoryRow key={row.amendmentId} row={row} chainWrites={history.chainWrites} />
        ))}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ row, chainWrites }: { row: Amendment; chainWrites: boolean }) {
  const confirm = useMutation(api.lineage.confirmOffchain);
  const cancel = useMutation(api.lineage.cancelAmendment);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: (args: { amendmentId: Id<"lineageAmendments"> }) => Promise<null>) {
    setBusy(true);
    setError(null);
    try {
      await action({ amendmentId: row.amendmentId });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const status =
    row.status === "confirmed" && row.offchainOnly
      ? "confirmed · offchain only"
      : row.status === "rejected" && row.rejectReason === "cancelled"
        ? "cancelled"
        : row.status;
  return (
    <div className="space-y-2 rounded-md border bg-background px-3 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-cr font-medium">CR {row.cr}</span>{" "}
          <span className="text-muted-foreground">
            #{row.sequence}: {describe(row.fromKind, row.fromParentCr)} → {describe(row.newKind, row.newParentCr)}
          </span>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-xs font-medium">{status}</span>
      </div>
      <p>{row.reason}</p>
      <p className="text-xs text-muted-foreground">
        @{row.admin} · {new Date(row.requestedAt).toLocaleString()}
        {row.decidedAt && <> · decided {new Date(row.decidedAt).toLocaleString()}</>}
        {row.status === "rejected" && row.rejectReason && row.rejectReason !== "cancelled" && <> · {row.rejectReason}</>}
      </p>
      {row.status === "requested" && (
        <div className="flex flex-wrap gap-2">
          {!chainWrites && (
            <Button size="sm" disabled={busy} onClick={() => run(confirm)}>
              Confirm offchain only (not recorded on Monad)
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(cancel)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
