import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { formatCents } from "~/lib/money";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/me/earnings")({
  beforeLoad: requireAuthenticatedRoute,
  head: () => ({ meta: [{ title: "Earnings · CultRemix" }] }),
  component: EarningsPage,
});

const ROLE_LABEL: Record<string, string> = {
  creator: "Your design",
  family_root: "Your family",
  upstream: "Your original",
};

const KIND_LABEL = { sale: "Sale", refund: "Refund", cancel: "Canceled", dispute: "Chargeback" } as const;

function dateText(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EarningsPage() {
  const result = useQuery(convexQuery(api.earnings.mine, {}));
  // Money sent to you for Available earnings (convex/payouts.ts).
  const payouts = useQuery(convexQuery(api.payouts.mine, {})).data ?? [];
  const data = result.data;
  const hasTest = data ? Object.values(data.testTotals).some((cents) => cents !== 0) : false;

  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main className="max-w-4xl px-4 pb-24 md:px-10">
        <h1 className="pt-6 text-[16vw] font-black leading-[0.8] tracking-[-0.06em] md:pt-10 md:text-[8vw]">Earnings</h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Every time someone buys something with your design on it, a share comes to you. It can be paid out 30 days after the order ships, once returns have had time to come in.
        </p>

        <section className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Total label="Pending" cents={data?.totals.pendingCents} />
          <Total label="Available" cents={data?.totals.availableCents} />
          <Total label="Paid" cents={data?.totals.paidCents} />
        </section>

        {hasTest && data && (
          <p className="mt-4 rounded-2xl border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            <span className="font-bold text-foreground">Test</span> orders add {formatCents(data.testTotals.pendingCents + data.testTotals.availableCents)} here
            for practice. They never pay out.
          </p>
        )}

        {payouts.length > 0 && (
          <section className="mt-14">
            <h2 className="border-t-2 border-foreground pt-4 text-sm font-bold uppercase tracking-wider">Payouts</h2>
            <ul className="mt-2 divide-y-2 divide-border">
              {payouts.map((payout) => (
                <li key={payout.paidAt} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4">
                  <span className="font-mono text-lg font-bold tabular-nums">{formatCents(payout.amountCents)}</span>
                  <span className="text-sm text-muted-foreground">
                    {payout.method === "usdc" ? "USDC on Monad" : payout.method === "bank" ? "Bank transfer" : "Paid"} · {dateText(payout.paidAt)}
                  </span>
                  <span className="w-full break-all font-mono text-xs text-muted-foreground">{payout.reference}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-14">
          <h2 className="border-t-2 border-foreground pt-4 text-sm font-bold uppercase tracking-wider">Activity</h2>
          {result.isLoading ? null : !data || data.entries.length === 0 ? (
            <div className="mt-6">
              <p className="text-lg">Nothing yet. When your designs sell, it shows up here.</p>
              <Link to="/studio" className="mt-4 inline-block font-bold underline underline-offset-4">
                Make something
              </Link>
            </div>
          ) : (
            <ul className="mt-2 divide-y-2 divide-border">
              {data.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {entry.cr ? (
                        <Link to="/cr/$cr" params={{ cr: entry.cr }}>
                          <CrMark cr={entry.cr} className="text-2xl" />
                        </Link>
                      ) : entry.keptId ? (
                        <Link to="/keep/$workId" params={{ workId: entry.keptId }} className="text-2xl font-black underline-offset-4 hover:underline">
                          {entry.title ? `Kept: ${entry.title}` : "Kept design"}
                        </Link>
                      ) : entry.privateRemix ? (
                        <span className="text-2xl font-black">A private remix</span>
                      ) : (
                        <span className="text-2xl font-black">—</span>
                      )}
                      {entry.test && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold uppercase tracking-wider">Test</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {KIND_LABEL[entry.kind]} · {entry.roles.map((role) => ROLE_LABEL[role] ?? role).join(" + ")} · {dateText(entry.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-lg font-bold tabular-nums ${entry.status === "Reversed" ? "text-muted-foreground line-through" : ""}`}>
                      {formatCents(entry.amountCents)}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {entry.status}
                      {entry.maturesAt ? ` · ${dateText(entry.maturesAt)}` : ""}
                      {entry.holdReason === "not_creator" ? " · until you have creator access" : ""}
                      {entry.holdReason === "refund" ? " · refund in progress" : ""}
                      {entry.holdReason === "dispute" ? " · while the buyer's bank reviews a payment dispute" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Total({ label, cents }: { label: string; cents: number | undefined }) {
  return (
    <div className="rounded-2xl border-2 border-foreground bg-card p-5">
      <p className="text-sm font-bold uppercase tracking-wider">{label}</p>
      <p className="mt-2 font-mono text-4xl font-black tabular-nums tracking-tight">{cents === undefined ? "—" : formatCents(cents)}</p>
    </div>
  );
}
