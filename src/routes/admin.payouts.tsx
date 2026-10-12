import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { AdminSection, adminButton } from "~/components/admin/AdminSection";
import { useCurrentUser } from "~/hooks/use-auth";
import { errorMessage } from "~/lib/imagePrep";
import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";

// Paying creators (convex/payouts.ts), owner only. Send the money first (USDC on Monad to the
// creator's wallet, or a bank transfer), then record it here with its reference.
export const Route = createFileRoute("/admin/payouts")({
  component: AdminPayouts,
});

type Creator = FunctionReturnType<typeof api.payouts.balances>["creators"][number];

const METHODS = [
  { value: "usdc", label: "USDC on Monad" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

function csv(creators: Array<Creator>) {
  const cell = (value: string | number | undefined) => `"${String(value ?? "").replace(/"/gu, '""')}"`;
  const lines = [["username", "email", "creator number", "wallet", "available (USD)", "held for a dispute (USD)", "pending (USD)", "paid (USD)"].map(cell).join(",")];
  for (const c of creators) {
    const usd = (cents: number) => (cents / 100).toFixed(2);
    lines.push(
      [c.username, c.email, c.creatorNumber, c.walletAddress, usd(c.availableCents), usd(c.disputedCents), usd(c.pendingCents), usd(c.paidCents)]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function AdminPayouts() {
  const user = useCurrentUser();
  const isOwner = user?.platformRole === "super_admin_owner";
  if (!isOwner) return <p className="text-muted-foreground">Only the owner can see payouts.</p>;
  return <Payouts />;
}

function Payouts() {
  const balances = useQuery(api.payouts.balances, {});
  const history = useQuery(api.payouts.history, {});
  const due = (balances?.creators ?? []).filter((c) => c.availableCents > 0);
  const totalDue = due.reduce((sum, c) => sum + c.availableCents, 0);

  const download = () => {
    if (!balances) return;
    const url = URL.createObjectURL(new Blob([csv(balances.creators)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cultremix-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="Payouts"
        description="Creators' earnings become Available 30 days after an order ships. Send the money (USDC on Monad to their wallet, or a bank transfer), then record it here; those earnings become Paid, and a later refund comes off the next payout. Earnings on an order with an open payment dispute wait until it's over. Test orders are never paid."
        action={
          <button type="button" disabled={!balances} onClick={download} className={adminButton}>
            Download CSV
          </button>
        }
      >
        {balances ? (
          <p className="text-sm">
            <span className="font-bold">{formatCents(totalDue)}</span> payable to {due.length} creator{due.length === 1 ? "" : "s"}. The
            minimum payout is {formatCents(balances.minimumCents)}; smaller balances carry over.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </AdminSection>

      {(balances?.creators ?? []).map((creator) => (
        <CreatorRow key={creator.recipientId} creator={creator} minimumCents={balances!.minimumCents} />
      ))}
      {balances && balances.creators.length === 0 && <p className="text-muted-foreground">No creator has earnings from real orders yet.</p>}

      <AdminSection title="Recent payouts">
        {history && history.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {history.map((payout) => (
              <li key={payout.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-bold">{formatCents(payout.amountCents)}</span>
                <span>@{payout.username ?? "unknown"}</span>
                <span className="text-muted-foreground">{METHODS.find((m) => m.value === payout.method)?.label}</span>
                <span className="break-all font-mono text-xs">{payout.reference}</span>
                <span className="text-muted-foreground">{new Date(payout.paidAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </AdminSection>
    </div>
  );
}

function CreatorRow({ creator, minimumCents }: { creator: Creator; minimumCents: number }) {
  const markPaid = useMutation(api.payouts.markPaid);
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("usdc");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const below = creator.availableCents > 0 && creator.availableCents < minimumCents;

  const submit = async () => {
    setBusy(true);
    setNote("");
    try {
      const done = await markPaid({ recipientId: creator.recipientId, expectedCents: creator.availableCents, method, reference });
      setNote(`Recorded ${formatCents(done.amountCents)} (${done.rows} earnings).`);
      setReference("");
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminSection
      title={`@${creator.username ?? "unknown"}${creator.creatorNumber !== undefined ? ` · Creator № ${creator.creatorNumber}` : ""}`}
      description={creator.email}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          Available <span className={cn("font-bold", creator.availableCents > 0 && "text-emerald-600 dark:text-emerald-400")}>{formatCents(creator.availableCents)}</span>
        </span>
        {creator.disputedCents !== 0 && (
          <span>
            Held for a dispute <span className="font-bold">{formatCents(creator.disputedCents)}</span>
          </span>
        )}
        <span>
          Pending <span className="font-bold">{formatCents(creator.pendingCents)}</span>
        </span>
        <span>
          Paid <span className="font-bold">{formatCents(creator.paidCents)}</span>
        </span>
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        {creator.walletAddress ? <>Monad wallet <span className="font-mono">{creator.walletAddress}</span></> : "No Monad wallet yet."}
      </p>
      {creator.availableCents > 0 && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className="h-10 rounded-lg border-2 border-border bg-background px-2 text-sm">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Transaction hash or transfer reference"
            className="h-10 min-w-0 flex-1 rounded-lg border-2 border-border bg-background px-2 text-sm"
            aria-label="Reference"
          />
          <button type="submit" disabled={busy || !reference.trim()} className={adminButton}>
            {busy ? "Recording…" : `Record ${formatCents(creator.availableCents)} paid`}
          </button>
        </form>
      )}
      {below && <p className="mt-2 text-xs text-muted-foreground">Below the {formatCents(minimumCents)} minimum; it can still be paid.</p>}
      {creator.disputedCents !== 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {formatCents(creator.disputedCents)} is from orders with an open payment dispute (Admin, Orders). It becomes payable if the store wins;
          if the buyer wins, it's taken back.
        </p>
      )}
      {note && <p className="mt-2 text-sm font-semibold">{note}</p>}
    </AdminSection>
  );
}

