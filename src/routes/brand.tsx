import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { errorMessage } from "~/lib/imagePrep";
import { formatCents } from "~/lib/money";
import { CONTACT_EMAIL } from "~/lib/policies";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/brand")({
  beforeLoad: requireAuthenticatedRoute,
  head: () => ({ meta: [{ title: "Your brand · CultRemix" }] }),
  component: BrandPage,
});

type Deal = NonNullable<FunctionReturnType<typeof api.brands.mine>>;

function percent(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// A brand's own page (convex/brands.ts mine): its deal with CultRemix, and how it splits its
// families' share of each sale with the creators who make and remix designs in them.
function BrandPage() {
  const result = useQuery(convexQuery(api.brands.mine, {}));
  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main className="max-w-3xl px-4 pb-24 md:px-10">
        {result.data === undefined ? (
          <p className="pt-10 text-muted-foreground">Loading…</p>
        ) : result.data === null ? (
          <>
            <h1 className="pt-6 text-[14vw] font-black leading-[0.85] tracking-[-0.05em] md:pt-10 md:text-[6vw]">Brands</h1>
            <p className="mt-6 max-w-xl text-lg">
              This page is for brands on CultRemix. If your brand owns or licenses designs here, write to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold underline underline-offset-4">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </>
        ) : (
          <DealView deal={result.data} />
        )}
      </main>
    </div>
  );
}

function DealView({ deal }: { deal: Deal }) {
  const setShare = useMutation(api.brands.setCreatorShare);
  const [value, setValue] = useState(deal.creatorBps / 100);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setValue(deal.creatorBps / 100), [deal.creatorBps]);
  const creatorBps = value * 100;
  const brandBps = deal.totalBps - creatorBps;
  const part = (bps: number) => Math.floor((deal.examplePriceCents * bps) / 10000);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await setShare({ creatorBps });
      setMessage("Saved. New sales in your families use it.");
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="pt-6 text-[14vw] font-black leading-[0.85] tracking-[-0.05em] md:pt-10 md:text-[6vw]">{deal.name}</h1>
      <p className="mt-6 max-w-xl text-lg">
        Every sale of a design in your families pays {percent(deal.totalBps)} of the shirt's price to you and the creators who made it. You
        decide how it's split.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Your {deal.families.length === 1 ? "family" : "families"}:{" "}
        {deal.families.map((family, i) => (
          <span key={family}>
            {i > 0 && ", "}
            <Link to="/family/$family" params={{ family: String(family) }} className="font-bold text-foreground underline underline-offset-4">
              CR {family}
            </Link>
          </span>
        ))}
      </p>

      <section className="mt-10 rounded-2xl border-2 border-black p-5">
        <label htmlFor="creator-share" className="text-sm font-bold uppercase tracking-wider">
          Creators' share
        </label>
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <p>
            <span className="font-cr text-4xl tabular-nums">{percent(creatorBps)}</span>
            <span className="ml-2">to creators</span>
          </p>
          <p className="text-right">
            <span className="font-cr text-4xl tabular-nums">{percent(brandBps)}</span>
            <span className="ml-2">to you</span>
          </p>
        </div>
        <input
          id="creator-share"
          type="range"
          min={deal.minCreatorBps / 100}
          max={deal.totalBps / 100}
          step={1}
          value={value}
          onChange={(event) => {
            setValue(Number(event.target.value));
            setMessage(null);
          }}
          aria-valuetext={`${value}% to creators, ${(deal.totalBps - value * 100) / 100}% to you`}
          className="mt-4 w-full accent-black"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          From {percent(deal.minCreatorBps)} to {percent(deal.totalBps)}. We suggest {percent(deal.suggestedCreatorBps)}, so the people remixing
          your designs keep earning from them.
        </p>
        <p className="mt-4">
          On a {formatCents(deal.examplePriceCents)} {deal.exampleName}, its creators share {formatCents(part(creatorBps))} and you get{" "}
          {formatCents(part(brandBps))}.
        </p>
        <button
          type="button"
          disabled={busy || creatorBps === deal.creatorBps}
          onClick={() => void save()}
          className="mt-5 h-12 rounded-2xl bg-black px-6 font-black text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {message && <p className="mt-3 font-semibold">{message}</p>}
      </section>

      <p className="mt-6 max-w-xl text-sm text-muted-foreground">
        A change applies to new sales; orders already paid keep their split. Each design's page shows its split, and what you earn is on{" "}
        <Link to="/me/earnings" className="font-bold text-foreground underline underline-offset-4">
          Earnings
        </Link>
        . To change your families' share, write to {CONTACT_EMAIL}.
      </p>
    </>
  );
}
