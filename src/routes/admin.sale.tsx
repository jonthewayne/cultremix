import { useAction, useMutation, useQuery } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { GARMENT_KINDS, formatPrice } from "../../shared/config/print-products";
import type { FunctionReturnType } from "convex/server";
import { AdminSection, adminButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

// Putting works on sale (convex/sales.ts). Approving a work makes a print file for each product its
// creator picked, the design placed where they chose, then a Shopify product for each. The work page
// sells them once they're live and checkout is on.
export const Route = createFileRoute("/admin/sale")({
  component: AdminSale,
});

type Row = FunctionReturnType<typeof api.sales.list>["page"][number];
type ListingRow = Row["listings"][number];

const STATUS: Record<ListingRow["status"], { label: string; tone: string }> = {
  preparing: { label: "Making its print file", tone: "bg-amber-100 text-amber-900" },
  pending: { label: "Going to Shopify", tone: "bg-sky-100 text-sky-900" },
  live: { label: "On sale", tone: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Shopify refused", tone: "bg-red-100 text-red-900" },
  paused: { label: "Off sale", tone: "bg-neutral-200 text-neutral-700" },
};

function AdminSale() {
  const overview = useQuery(api.sales.overview, {});
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1];
  const list = useQuery(api.sales.list, { cursor });
  // Kept designs whose creators asked to have them printed (keeps.requestPrint).
  const kept = useQuery(api.sales.keptRequests, {});
  const approve = useMutation(api.sales.approve);
  const [batch, setBatch] = useState<string | null>(null);
  const waiting = (list?.page ?? []).filter((row) => row.listings.length === 0 && row.picked.length > 0);
  // Approves every work on this page that isn't on sale yet, one at a time.
  const approveWaiting = async () => {
    let done = 0;
    const problems: Array<string> = [];
    for (const row of waiting) {
      setBatch(`Approving CR ${row.cr} (${done + 1} of ${waiting.length})…`);
      try {
        await approve({ workId: row.workId });
        done++;
      } catch (err) {
        problems.push(`CR ${row.cr}: ${errorMessage(err)}`);
      }
    }
    setBatch(`Approved ${done} of ${waiting.length}.${problems.length ? ` ${problems.join(" ")}` : ""}`);
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="What's for sale"
        description="Approve a published work to make its print files and Shopify products. Its creator chose the products and where the design sits."
      >
        {overview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm font-bold">
              <Flag on={overview.checkoutOn} label="Checkout" note={overview.checkoutOn ? "on" : "off: pages say Buying opens soon, and Shopify keeps the products as drafts"} />
              <Flag on={overview.upscaleOn} label="Print-size art" note={overview.upscaleOn ? "on" : "off: approvals stop at the upscale"} />
              <Flag on={overview.shopify} label="Shopify" note={overview.shopify ? "connected" : "not set up: products wait"} />
              <Flag on={overview.printful} label="Printful" note={overview.printful ? "connected" : "not set up: orders wait"} />
            </div>
            <ul className="text-sm">
              {overview.products.map((product) => (
                <li key={product.name}>
                  <span className="font-bold">{product.name}</span> · {GARMENT_KINDS[product.kind].label} · {formatPrice(product.priceCents)} (2XL{" "}
                  {formatPrice(product.largePriceCents)}){product.back ? ` · back +${formatPrice(product.backExtraCents)}` : " · front only"} · {product.colors} colors
                  {product.isDefault ? " · default" : ""}
                  {product.fromAdmin ? "" : " · launch shirt"}
                </li>
              ))}
            </ul>
            <Connections />
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/admin/products" className="text-sm font-semibold underline underline-offset-4">
                Products and prices
              </Link>
              {waiting.length > 1 && (
                <button type="button" disabled={batch?.endsWith("…")} onClick={() => void approveWaiting()} className={adminButton}>
                  Approve the {waiting.length} below that aren't on sale
                </button>
              )}
            </div>
            {batch && <p className="text-sm font-semibold">{batch}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </AdminSection>

      {kept && kept.length > 0 && (
        <div className="space-y-1 pt-2">
          <h2 className="text-lg font-black">Kept designs to print</h2>
          <p className="text-sm text-muted-foreground">
            Their creators asked to have them printed. Approving one makes its print files and products, sold to its creator alone from
            their kept page.
          </p>
        </div>
      )}
      {(kept ?? []).map((row) => (
        <WorkRow key={row.workId} row={row} canSimulate={false} />
      ))}
      {kept && kept.length > 0 && <h2 className="pt-2 text-lg font-black">Published works</h2>}
      {(list?.page ?? []).map((row) => (
        <WorkRow key={row.workId} row={row} canSimulate={overview?.canSimulate ?? false} />
      ))}
      {list && list.page.length === 0 && <p className="text-muted-foreground">Nothing published yet.</p>}
      <div className="flex gap-3">
        {cursors.length > 1 && (
          <button type="button" onClick={() => setCursors(cursors.slice(0, -1))} className={adminButton}>
            Newer
          </button>
        )}
        {list && !list.isDone && (
          <button type="button" onClick={() => setCursors([...cursors, list.continueCursor])} className={adminButton}>
            Older
          </button>
        )}
      </div>
    </div>
  );
}

// Connect Printful and Connect Shopify (convex/integrations.ts): once their keys are in the env,
// each sets up its webhooks to this deployment. Safe to run again.
function Connections() {
  const status = useQuery(api.integrations.status, {});
  const connectPrintful = useAction(api.integrations.connectPrintful);
  const connectShopify = useAction(api.integrations.connectShopify);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!status) return null;
  const run = async (name: string, work: () => Promise<string>) => {
    setBusy(name);
    setNote("");
    try {
      setNote(await work());
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border-2 border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || !status.printful.configured}
          title={status.printful.configured ? undefined : "Needs PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID"}
          onClick={() =>
            void run("printful", async () => {
              const done = await connectPrintful({});
              return `Printful: ${done.store}, ${done.events} webhooks to ${done.url}. Signing key stored.`;
            })
          }
          className={adminButton}
        >
          {busy === "printful" ? "Connecting…" : status.printful.connectedAt ? "Connect Printful again" : "Connect Printful"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !status.shopify.configured}
          title={status.shopify.configured ? undefined : "Needs SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET"}
          onClick={() =>
            void run("shopify", async () => {
              const done = await connectShopify({});
              return `Shopify: ${done.shop}. ${done.created.length ? `Subscribed ${done.created.join(", ")}.` : "Its webhooks were already there."}${done.headless ? "" : " Add the Headless sales channel before approving works."}${done.disputesWarning ? ` ${done.disputesWarning}` : ""}`;
            })
          }
          className={adminButton}
        >
          {busy === "shopify" ? "Connecting…" : status.shopify.connectedAt ? "Connect Shopify again" : "Connect Shopify"}
        </button>
      </div>
      {status.printful.note && (
        <p className="text-muted-foreground">
          Printful, {new Date(status.printful.connectedAt!).toLocaleString()}: {status.printful.note}
        </p>
      )}
      {status.shopify.note && (
        <p className="text-muted-foreground">
          Shopify, {new Date(status.shopify.connectedAt!).toLocaleString()}: {status.shopify.note}
        </p>
      )}
      {status.printful.configured && status.printful.signingKey === "none" && (
        <p className="font-semibold text-amber-700 dark:text-amber-400">Printful's webhooks need connecting before orders can update.</p>
      )}
      {note && <p className="font-semibold">{note}</p>}
    </div>
  );
}

function Flag({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <span className={cn("rounded-full px-3 py-1", on ? "bg-emerald-100 text-emerald-900" : "bg-neutral-200 text-neutral-700")}>
      {label}: {note}
    </span>
  );
}

function WorkRow({ row, canSimulate }: { row: Row; canSimulate: boolean }) {
  const approve = useMutation(api.sales.approve);
  const pause = useMutation(api.sales.pause);
  const resume = useMutation(api.sales.resume);
  const simulateSale = useMutation(api.orders.simulateSale);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setNote("");
    try {
      const result = await work();
      setNote(typeof result === "string" ? result : "");
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const approved = row.listings.length > 0;
  const paused = row.listings.filter((listing) => listing.status === "paused");
  const selling = row.listings.filter((listing) => listing.status !== "paused");

  return (
    <AdminSection
      title={row.kept ? `Kept design${row.title ? ` · ${row.title}` : ""}` : `CR ${row.cr}${row.title ? ` · ${row.title}` : ""}`}
      description={`@${row.creator ?? "unknown"} · picked ${row.picked.join(", ") || "nothing on offer"}${
        row.kept && row.requestedAt
          ? ` · asked to print it ${new Date(row.requestedAt).toLocaleDateString()}`
          : row.publishedAt
            ? ` · published ${new Date(row.publishedAt).toLocaleDateString()}`
            : ""
      }`}
      action={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await approve({ workId: row.workId });
                const names = result.products.map((product) => product.name).join(", ");
                return result.skipped.length > 0
                  ? `Approved on ${names}. Skipped ${result.skipped.join(", ")}: none of its colors come on it.`
                  : `Approved on ${names}.`;
              })
            }
            className={adminButton}
          >
            {approved ? "Approve again" : row.kept ? "Approve for its creator" : "Approve for sale"}
          </button>
          {selling.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void run(() => pause({ workId: row.workId }))} className={adminButton}>
              Take off sale
            </button>
          )}
          {paused.length > 0 && selling.length === 0 && (
            <button type="button" disabled={busy} onClick={() => void run(() => resume({ workId: row.workId }))} className={adminButton}>
              Put back on sale
            </button>
          )}
          {canSimulate && (
            <button
              type="button"
              disabled={busy}
              title="Dev and staging only: a Test order with Test earnings and notifications, never paid or printed"
              onClick={() =>
                void run(async () => {
                  const sale = await simulateSale({ workId: row.workId });
                  const shared =
                    sale.recipients === 1
                      ? "for its creator, who got a notification"
                      : `split among ${sale.recipients} creators, each notified`;
                  return `Simulated a ${formatPrice(sale.totalCents)} sale: ${formatPrice(sale.poolCents)} in Test earnings ${shared}.`;
                })
              }
              className={adminButton}
            >
              Simulate a sale
            </button>
          )}
        </div>
      }
    >
      <div className="flex gap-4">
        {row.thumbUrl && <img src={row.thumbUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-neutral-100 object-contain" />}
        <div className="min-w-0 flex-1 space-y-2">
          {row.step && <p className="text-sm font-semibold">{row.step}…</p>}
          {row.changed && (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Its creator changed what it comes on or where it sits. Approve again to remake its print files.</p>
          )}
          {!row.creatorAccess && !row.kept && (
            <p className="text-sm text-muted-foreground">
              @{row.creator ?? "Its creator"} doesn't have creator access, so their share of each sale waits until they do (Admin, Members, Make a
              creator).
            </p>
          )}
          {!approved && <p className="text-sm text-muted-foreground">Not approved yet.</p>}
          {row.listings.map((listing) => (
            <div key={listing.productKey} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{listing.name}</span>
              <span className="text-muted-foreground">
                {listing.side === "back" ? "back" : "front"} · {formatPrice(listing.priceCents)} · {listing.colors.length} colors
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", STATUS[listing.status].tone)}>{STATUS[listing.status].label}</span>
              {listing.printFile && (
                <a
                  href={listing.printFile.url ?? listing.printFile.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline underline-offset-4"
                >
                  Print file · {listing.printFile.widthIn} in · {listing.printFile.dpi} DPI
                </a>
              )}
              {listing.prepError && <span className="w-full font-semibold text-destructive">{listing.prepError}</span>}
              {listing.lastError && <span className="w-full text-destructive">{listing.lastError}</span>}
            </div>
          ))}
          {note && <p className="text-sm font-semibold">{note}</p>}
          {row.kept ? (
            <p className="text-sm text-muted-foreground">Its page is its creator's alone; once it's on sale, they order it there.</p>
          ) : (
            <Link to="/cr/$cr" params={{ cr: row.cr }} className="text-sm font-semibold underline underline-offset-4">
              Work page
            </Link>
          )}
        </div>
      </div>
    </AdminSection>
  );
}

