import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { AdminSection, adminQuietButton } from "~/components/admin/AdminSection";
import { formatDollars } from "~/components/admin/BudgetCard";

import { BATCH_CENTS, LOW_CREDIT_CENTS } from "../../../shared/config/gatewayCredit";

// The CultRemix Gateway account's balance (convex/gatewayCredit.ts). Every design, note, and model
// photo is paid from it, and when it runs out every new design fails.
export function GatewayCredit() {
  const read = useAction(api.gatewayCredit.balance);
  const [credit, setCredit] = useState<{ balanceCents: number; usedCents: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setCredit(await read({}));
    } catch {
      setCredit(null);
    } finally {
      setBusy(false);
    }
  }, [read]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const low = credit ? credit.balanceCents < LOW_CREDIT_CENTS : false;
  return (
    <AdminSection
      title="Gateway credit"
      description="What's left on the CultRemix Gateway account. Every design, image note, and model photo is paid from it, and when it runs out, new designs fail until credit is added."
      action={
        <button type="button" className={adminQuietButton} disabled={busy} onClick={() => void refresh()}>
          {busy ? "Checking…" : "Check again"}
        </button>
      }
    >
      {credit === undefined ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : credit === null ? (
        <p className="text-sm text-muted-foreground">Couldn't read the balance. The gateway key may not be set here.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-3xl font-black tabular-nums">{formatDollars(credit.balanceCents)}</p>
          <p className="text-sm text-muted-foreground">
            About {Math.max(0, Math.floor(credit.balanceCents / BATCH_CENTS))} batches of four designs. {formatDollars(credit.usedCents)} used so far.
          </p>
          {low && (
            <p className="rounded-lg bg-destructive px-3 py-2 text-sm font-bold text-white">
              Low: add credit to the gateway account before more people make designs.
            </p>
          )}
        </div>
      )}
    </AdminSection>
  );
}
