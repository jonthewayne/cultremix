import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { api } from "../../convex/_generated/api";
import { hasCapability } from "../../convex/lib/authz";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell } from "~/components/app/app-shell";
import { AdminFrame } from "~/components/admin/AdminFrame";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { isSuperAdminRole, useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/admin_/chain")({
  head: () => ({ meta: [{ title: "Monad · Admin · CultRemix" }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: ChainAdminPage,
});

type RelayerStatus = typeof api.chain.relayerStatus._returnType;

const STATUS_LABELS: Record<string, string> = {
  waiting_wallet: "Waiting for wallet",
  waiting_parent: "Waiting for parent",
  pending: "Ready",
  submitted: "Sent",
  confirmed: "Confirmed",
  rejected: "Rejected",
  failed: "Failed",
};

function errorMessage(error: unknown) {
  if (error instanceof ConvexError) return (error.data as { message?: string } | undefined)?.message ?? "Something went wrong.";
  return error instanceof Error ? error.message : String(error);
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function ChainAdminPage() {
  const user = useCurrentUser();
  const isAdmin = isSuperAdminRole(user?.platformRole);
  const canManage = hasCapability(user?.platformRole ?? "user", "chain:manage");
  const overview = useQuery(api.chainAdmin.overview, isAdmin ? {} : "skip");
  const loadRelayer = useAction(api.chain.relayerStatus);
  const clearStuckNonce = useAction(api.chain.clearStuckNonce);
  const setWritesEnabled = useMutation(api.chainAdmin.setWritesEnabled);
  const registerEconomicConfig = useMutation(api.chainAdmin.registerEconomicConfig);
  const retryWrite = useMutation(api.chainAdmin.retryWrite);
  const queueEarlierWorks = useMutation(api.chainAdmin.queueEarlierWorks);
  const [relayer, setRelayer] = useState<RelayerStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshRelayer = useCallback(() => {
    loadRelayer({})
      .then(setRelayer)
      .catch((error: unknown) => setMessage(errorMessage(error)));
  }, [loadRelayer]);

  useEffect(() => {
    if (isAdmin) refreshRelayer();
  }, [isAdmin, refreshRelayer]);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await task());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle>Unauthorized</CardTitle>
            <CardDescription>You do not have access to this area.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/studio">Back to the studio</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const stalled = overview?.relayers.find((row) => row.stalled);

  return (
    <AdminFrame>
      <div className="space-y-6">
        <p className="text-muted-foreground">The relayer that registers works, Backs, and lineage corrections on Monad.</p>
        {message && <p className="rounded-md border bg-background px-3 py-2 text-sm">{message}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Relayer</CardTitle>
            <CardDescription>
              {overview?.deployment.env ? `${overview.deployment.env} · ${overview.deployment.networkName ?? "unknown network"}` : "Loading…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Address">
              {relayer?.relayerAddress ? <AddressLink address={relayer.relayerAddress} url={relayer.relayerUrl} /> : "—"}
            </Row>
            <Row label="Balance">{relayer?.balance ? `${formatEther(BigInt(relayer.balance))} MON` : "—"}</Row>
            <Row label="Registry">
              {relayer?.registryAddress ? <AddressLink address={relayer.registryAddress} url={relayer.registryUrl} /> : "Not deployed"}
            </Row>
            <Row label="Lists this relayer">{relayer?.listed === null || !relayer ? "—" : relayer.listed ? "Yes" : "No"}</Row>
            <Row label="Registry admin">{relayer?.registryAdmin ? <span className="font-mono text-xs">{relayer.registryAdmin}</span> : "—"}</Row>
            {(relayer?.problem || overview?.deployment.problem) && (
              <p className="font-semibold text-destructive">{relayer?.problem ?? overview?.deployment.problem}</p>
            )}
            <Button variant="outline" size="sm" onClick={refreshRelayer}>
              Refresh
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Writes</CardTitle>
            <CardDescription>
              {overview?.enabled ? "Chain writes are on." : "Chain writes are off. Writes already sent are still followed; nothing new goes out."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {(overview?.counts ?? []).map((row) => (
                <span key={row.status} className="rounded-md border px-2 py-1">
                  {STATUS_LABELS[row.status]}: {row.count}
                  {row.capped ? "+" : ""}
                </span>
              ))}
            </div>
            {canManage && overview && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={overview.enabled ? "outline" : "default"}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await setWritesEnabled({ enabled: !overview.enabled });
                      return overview.enabled ? "Chain writes are off." : "Chain writes are on.";
                    })
                  }
                >
                  {overview.enabled ? "Turn writes off" : "Turn writes on"}
                </Button>
                {overview.unqueuedWorks.count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await queueEarlierWorks({});
                        return `Queued ${result.queued} registration${result.queued === 1 ? "" : "s"}.${result.more ? " Run it again for the rest." : ""}`;
                      })
                    }
                  >
                    Queue registrations for earlier works ({overview.unqueuedWorks.count}
                    {overview.unqueuedWorks.capped ? "+" : ""})
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stuck nonce</CardTitle>
            <CardDescription>
              When a transaction won't go through after three fee increases, later writes are held until it's cleared.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {stalled?.stalled ? (
              <>
                <p className="font-semibold">
                  Nonce {stalled.stalled.nonce}
                  {stalled.stalled.subject ? ` (${stalled.stalled.subject})` : ""} has been stuck since {when(stalled.stalled.since)}.
                </p>
                <p className="text-muted-foreground">{stalled.stalled.reason}</p>
                {stalled.clearing && (
                  <p>
                    A replacement ({shortHash(stalled.clearing.hash)}) was sent {when(stalled.clearing.sentAt)}.
                  </p>
                )}
              </>
            ) : (
              <p>Nothing is stuck.</p>
            )}
            {(overview?.relayers ?? []).map((row) =>
              row.lastError ? (
                <p key={row.key} className="text-muted-foreground">
                  Last relayer note: {row.lastError}
                </p>
              ) : null,
            )}
            {canManage && (
              <Button
                variant={stalled ? "destructive" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => run(async () => (await clearStuckNonce({})).message)}
              >
                Clear stuck nonce
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Economic config</CardTitle>
            <CardDescription>The registry records the SHA-256 of each config version's canonical JSON.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {overview && (
              <>
                <Row label={`v${overview.config.version}`}>
                  <span className="break-all font-mono text-xs">{overview.config.hash}</span>
                </Row>
                <Row label="Status">{overview.config.status ? STATUS_LABELS[overview.config.status] : "Not queued"}</Row>
                {canManage && !overview.config.status && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await registerEconomicConfig({});
                        return `Queued economic config v${result.version}.`;
                      })
                    }
                  >
                    Register economic config v{overview.config.version}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent writes</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {overview?.recent.length === 0 && <p>No writes yet.</p>}
            {(overview?.recent ?? []).map((write) => (
              <div key={write._id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">{write.subject}</div>
                  <div className="text-muted-foreground">
                    {STATUS_LABELS[write.status]}
                    {write.nonce !== null && ` · nonce ${write.nonce}`}
                    {write.replacements > 0 && ` · ${write.replacements} fee increase${write.replacements === 1 ? "" : "s"}`}
                    {write.result && ` · Backer #${write.result.ordinal}, week ${write.result.week}`}
                    {` · ${when(write.updatedAt)}`}
                  </div>
                  {write.txHash && (
                    <div className="font-mono text-xs">
                      {write.txUrl ? (
                        <a href={write.txUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          {shortHash(write.txHash)}
                        </a>
                      ) : (
                        shortHash(write.txHash)
                      )}
                    </div>
                  )}
                  {write.problem && <div className="text-destructive">{write.problem}</div>}
                </div>
                {canManage && write.status === "failed" && write.retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await retryWrite({ writeId: write._id });
                        return `Queued ${write.subject} again.`;
                      })
                    }
                  >
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AdminFrame>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function AddressLink({ address, url }: { address: string; url: string | null }) {
  if (!url) return <span className="break-all font-mono text-xs">{address}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline underline-offset-4">
      {address}
    </a>
  );
}
