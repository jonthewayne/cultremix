import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CrMark } from "~/components/cr/CrMark";
import { useCurrentUser } from "~/hooks/use-auth";
import { formatCents } from "~/lib/money";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders · CultRemix" }] }),
  component: AdminOrdersPage,
});

const STATE_LABEL: Record<string, string> = {
  waiting: "Waiting for payment",
  creating: "Sending to print",
  draft: "Print draft (on hold)",
  submitted: "Sent to print",
  on_hold: "Print on hold",
  in_production: "Printing",
  partial: "Partly shipped",
  shipped: "Shipped",
  canceled: "Canceled",
  needs_attention: "Needs attention",
  manual_required: "Manual",
  test_ignored: "Test (ignored)",
};

const ALERT = new Set(["needs_attention", "manual_required"]);

function AdminOrdersPage() {
  const user = useCurrentUser();
  const isOwner = user?.platformRole === "super_admin_owner";
  const result = useQuery({ ...convexQuery(api.orders.adminList, {}), enabled: isOwner });
  const data = result.data;
  const privacy = useQuery({ ...convexQuery(api.privacy.requests, {}), enabled: isOwner }).data;
  const markDone = useMutation(api.privacy.markDone);

  return (
    <div className="pb-24">
        {!isOwner ? (
          <div className="mt-10">
            <p className="text-lg">Only the owner can see orders.</p>
            <Link to="/" className="mt-4 inline-block font-bold underline underline-offset-4">
              Back to the feed
            </Link>
          </div>
        ) : (
          <>
            {privacy && privacy.length > 0 && (
              <section className="mt-2">
                <h2 className="border-t-2 border-foreground pt-4 text-sm font-bold uppercase tracking-wider">Privacy requests</h2>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                  From Shopify. A data request asks for what CultRemix holds about a customer: send them what's listed here within 30
                  days, then mark it sent. Removal requests are handled automatically.
                </p>
                <ul className="mt-3 grid gap-3">
                  {privacy.map((request) => (
                    <li key={request.id} className="rounded-2xl border-2 border-border bg-card p-4 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-bold">
                          {request.topic === "customers/data_request"
                            ? "Data request"
                            : request.topic === "customers/redact"
                              ? "Customer removal"
                              : "Store removal"}
                          {request.customerId ? ` · customer ${request.customerId}` : ""}
                        </span>
                        <span className="text-muted-foreground">{new Date(request.receivedAt).toLocaleString()}</span>
                      </div>
                      {request.note && <p className="mt-1 text-muted-foreground">{request.note}</p>}
                      {request.status === "open" && (
                        <>
                          {request.held.length === 0 ? (
                            <p className="mt-2">CultRemix holds nothing for the orders named.</p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {request.held.map((order) => (
                                <li key={order.shopifyOrderId}>
                                  <span className="font-mono font-bold">{order.name ?? order.shopifyOrderId}</span>
                                  {" · "}
                                  {order.recipient
                                    ? `${order.recipient.name}, ${order.recipient.address}${order.recipient.email ? `, ${order.recipient.email}` : ""}${order.recipient.phone ? `, ${order.recipient.phone}` : ""}`
                                    : order.redacted
                                      ? "address already removed"
                                      : "no address"}
                                  {" · "}
                                  {order.lines.map((line) => `${line.cr ? `CR ${line.cr}` : "item"} × ${line.quantity}`).join(", ")}
                                </li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            onClick={() => void markDone({ id: request.id })}
                            className="mt-3 rounded-xl border-2 border-foreground px-3 py-1.5 font-bold"
                          >
                            Mark sent
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data && data.inbox.length > 0 && (
              <section className="mt-10">
                <h2 className="border-t-2 border-foreground pt-4 text-sm font-bold uppercase tracking-wider">Still loading from Shopify</h2>
                <ul className="mt-2 divide-y-2 divide-border">
                  {data.inbox.map((row) => (
                    <li key={row.shopifyOrderId} className="py-3 text-sm">
                      <span className="font-mono font-bold">{row.shopifyOrderId}</span>
                      <span className="text-muted-foreground"> · {row.hydration} · {row.attempts} tries</span>
                      {row.lastError && <p className="mt-1 break-words text-muted-foreground">{row.lastError}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-10">
              <h2 className="border-t-2 border-foreground pt-4 text-sm font-bold uppercase tracking-wider">Latest 50</h2>
              {result.isLoading ? null : !data || data.orders.length === 0 ? (
                <p className="mt-6 text-lg">No orders yet.</p>
              ) : (
                <ul className="mt-4 grid gap-3">
                  {data.orders.map((order) => (
                    <li key={order.id} className="rounded-2xl border-2 border-foreground bg-card p-4 md:p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-baseline gap-3">
                          <span className="text-2xl font-black">{order.name}</span>
                          {order.test && (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold uppercase tracking-wider">
                              {order.simulated ? "Test" : "Test · no earnings"}
                            </span>
                          )}
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-bold ${
                            ALERT.has(order.fulfillmentState) ? "bg-destructive text-white" : "bg-muted text-foreground"
                          }`}
                        >
                          {STATE_LABEL[order.fulfillmentState] ?? order.fulfillmentState}
                        </span>
                      </div>
                      {order.attentionReason && <p className="mt-2 font-semibold">{order.attentionReason}</p>}
                      <ul className="mt-3 space-y-1">
                        {order.lines.map((line, index) => (
                          <li key={index} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                            {line.cr ? <CrMark cr={line.cr} className="text-lg" /> : <span className="font-bold">Unknown design</span>}
                            <span className="font-mono text-muted-foreground">{line.sku ?? "no SKU"}</span>
                            <span>× {line.quantity}</span>
                            {line.refunded > 0 && <span className="text-muted-foreground">({line.refunded} refunded)</span>}
                          </li>
                        ))}
                      </ul>
                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                        <div>
                          <dt className="inline">Total </dt>
                          <dd className="inline font-mono text-foreground">{formatCents(order.totalCents)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Creators </dt>
                          <dd className="inline font-mono text-foreground">{formatCents(order.poolCents)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Payment </dt>
                          <dd className="inline text-foreground">{order.paid ? "Paid" : order.financialState.toLowerCase()}</dd>
                        </div>
                        {order.cancelled && (
                          <div>
                            <dt className="sr-only">Status</dt>
                            <dd className="inline font-bold text-foreground">Canceled</dd>
                          </div>
                        )}
                        {order.printfulStatus && (
                          <div>
                            <dt className="inline">Printful </dt>
                            <dd className="inline text-foreground">{order.printfulStatus}</dd>
                          </div>
                        )}
                        {order.refunds.map((refund, index) => (
                          <div key={index}>
                            <dt className="inline">Refund </dt>
                            <dd className="inline font-mono text-foreground">
                              {formatCents(refund.amountCents)} {refund.status}
                            </dd>
                          </div>
                        ))}
                        {order.ref && (
                          <div>
                            <dt className="inline">Ref </dt>
                            <dd className="inline text-foreground">{order.ref}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="sr-only">Placed</dt>
                          <dd className="inline">{new Date(order.createdAt).toLocaleString()}</dd>
                        </div>
                      </dl>
                      {order.shipments.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {order.shipments.map((shipment, index) => (
                            <li key={index}>
                              Shipped{shipment.carrier ? ` by ${shipment.carrier}` : ""}
                              {shipment.trackingNumber &&
                                (shipment.trackingUrl ? (
                                  <>
                                    {" · "}
                                    <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
                                      {shipment.trackingNumber}
                                    </a>
                                  </>
                                ) : (
                                  <span className="font-mono"> · {shipment.trackingNumber}</span>
                                ))}
                              <span className="text-muted-foreground">
                                {" · "}
                                {shipment.shopify === "done"
                                  ? "buyer emailed by Shopify"
                                  : shipment.shopify === "skipped"
                                    ? "already fulfilled in Shopify"
                                    : shipment.shopify === "failed"
                                      ? "Shopify fulfillment failed: mark it fulfilled in Shopify"
                                      : "sending the tracking to Shopify"}
                              </span>
                              {shipment.shopifyError && shipment.shopify !== "done" && (
                                <span className="block text-muted-foreground">{shipment.shopifyError}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
    </div>
  );
}
