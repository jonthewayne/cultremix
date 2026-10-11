import { useMutation, useQuery } from "convex/react";
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

  return (
    <div className="space-y-6">
      <AdminSection
        title="What's for sale"
        description="Approve a published work to make its print files and Shopify products. Its creator chose the products and where the design sits."
      >
        {overview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm font-bold">
              <Flag on={overview.checkoutOn} label="Checkout" note={overview.checkoutOn ? "on" : "off: pages say Buying opens soon"} />
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
            <Link to="/admin/products" className="text-sm font-semibold underline underline-offset-4">
              Products and prices
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </AdminSection>

      {(list?.page ?? []).map((row) => (
        <WorkRow key={row.workId} row={row} />
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

function Flag({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <span className={cn("rounded-full px-3 py-1", on ? "bg-emerald-100 text-emerald-900" : "bg-neutral-200 text-neutral-700")}>
      {label}: {note}
    </span>
  );
}

function WorkRow({ row }: { row: Row }) {
  const approve = useMutation(api.sales.approve);
  const pause = useMutation(api.sales.pause);
  const resume = useMutation(api.sales.resume);
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
      title={`CR ${row.cr}${row.title ? ` · ${row.title}` : ""}`}
      description={`@${row.creator ?? "unknown"} · picked ${row.picked.join(", ") || "nothing on offer"}${row.publishedAt ? ` · published ${new Date(row.publishedAt).toLocaleDateString()}` : ""}`}
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
            {approved ? "Approve again" : "Approve for sale"}
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
        </div>
      }
    >
      <div className="flex gap-4">
        {row.thumbUrl && <img src={row.thumbUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-neutral-100 object-contain" />}
        <div className="min-w-0 flex-1 space-y-2">
          {row.step && <p className="text-sm font-semibold">{row.step}…</p>}
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
              {listing.prepError && <span className="w-full font-semibold text-red-700">{listing.prepError}</span>}
              {listing.lastError && <span className="w-full text-red-700">{listing.lastError}</span>}
            </div>
          ))}
          {note && <p className="text-sm font-semibold">{note}</p>}
          <Link to="/cr/$cr" params={{ cr: row.cr }} className="text-sm font-semibold underline underline-offset-4">
            Work page
          </Link>
        </div>
      </div>
    </AdminSection>
  );
}

