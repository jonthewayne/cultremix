import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BuyBox } from "~/components/commerce/BuyBox";
import { Art } from "~/components/cr/Art";
import { SiteFooter } from "~/components/cr/SiteFooter";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { errorMessage, inkOn } from "~/lib/imagePrep";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { designFilename, saveImage } from "~/lib/saveImage";
import { cn } from "~/lib/utils";

// A kept design ("Keep it just for you"): only its creator can open this page. It shows the design
// on its shirt colors, credits the design it remixes, gets it printed (the creator asks, an admin
// approves it for them alone, and then it sells here to them only), and can share it with the
// world, which gives it a public CR number.
export const Route = createFileRoute("/keep/$workId")({
  beforeLoad: requireAuthenticatedRoute,
  head: () => ({ meta: [{ title: "Kept design · CultRemix" }, { name: "robots", content: "noindex" }] }),
  component: KeptPage,
});

function KeptPage() {
  const { workId } = Route.useParams();
  const navigate = useNavigate();
  const kept = useQuery(convexQuery(api.keeps.get, { workId: workId as Id<"works"> })).data;
  // Once it's approved and checkout is open: what it sells on, to its creator alone.
  const offer = useQuery(convexQuery(api.shopify.keptOffer, { workId: workId as Id<"works"> })).data;
  const share = useMutation(api.publish.shareKeep);
  const [shown, setShown] = useState<string | null>(null);
  const [productKey, setProductKey] = useState<string | null>(null);
  const [colorKey, setColorKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (kept === undefined) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="px-4 pt-10 md:px-10">
          <div className="h-[60svh] w-full max-w-3xl animate-pulse rounded-3xl bg-neutral-100" />
        </main>
      </div>
    );
  }
  if (kept === null) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 pt-16 md:px-10">
          <h1 className="text-5xl font-black tracking-tight">This design isn't here.</h1>
          <p className="mt-4 text-lg text-neutral-600">Kept designs open only for the person who kept them.</p>
          <Link to="/studio" className="mt-8 inline-block rounded-2xl bg-black px-6 py-3 font-black text-white">
            Back to the studio
          </Link>
        </main>
      </div>
    );
  }

  const product = offer ? (offer.products.find((p) => p.key === productKey) ?? offer.products[0]) : undefined;
  const saleColor = product ? (product.colors.find((c) => c.key === colorKey) ?? product.colors[0]) : undefined;
  const background = shown ?? saleColor?.hex ?? kept.backgroundColor;
  const shareIt = async () => {
    setSharing(true);
    setError(null);
    try {
      const result = await share({ workId: kept.workId });
      await navigate({ to: "/cr/$cr", params: { cr: result.cr } });
    } catch (err) {
      setError(errorMessage(err));
      setSharing(false);
    }
  };

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="grid grid-cols-1 gap-8 px-4 pb-24 pt-6 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12 md:px-10 md:pt-10">
        <div
          className="relative flex aspect-square items-center justify-center rounded-3xl p-[8%] transition-colors duration-300"
          style={{ background, color: inkOn(background) }}
        >
          {kept.preparing ? (
            <p className="animate-pulse text-lg font-bold">Saving…</p>
          ) : (
            <Art url={kept.mediumUrl ?? kept.url} alt={kept.title ?? "Kept design"} className="h-full w-auto max-w-full object-contain" />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider">Kept just for you</p>
            {/* Only its creator sees this page, and a kept design has no CR number to go by. */}
            <h1 className="mt-2 text-5xl font-black leading-[0.9] tracking-tight md:text-6xl">
              {kept.title ?? (kept.parent ? "Your remix" : "Your design")}
            </h1>
            {kept.description && <p className="mt-3 text-lg">{kept.description}</p>}
            <p className="mt-3 text-sm text-neutral-600">Only you can see this page. It has no CR number and isn't in the feed.</p>
          </div>
          {kept.parent && (
            <p className="text-base">
              A remix of{" "}
              <Link to="/cr/$cr" params={{ cr: kept.parent.cr }} className="font-cr font-bold underline underline-offset-4">
                CR {kept.parent.cr}
              </Link>
              {kept.parent.title ? ` “${kept.parent.title}”` : ""}
              {kept.parent.username ? ` by @${kept.parent.username}` : ""}. Its creator still gets credit.
            </p>
          )}
          {offer && product ? (
            <BuyBox
              offer={{ ...offer, keep: kept.workId }}
              product={product}
              onProductChange={setProductKey}
              colorKey={saleColor?.key ?? ""}
              onColorChange={(key) => {
                setColorKey(key);
                setShown(null);
              }}
              artUrl={kept.mediumUrl ?? kept.url}
            />
          ) : kept.colors.length > 0 && (
            <div>
              <p className="text-sm font-bold uppercase tracking-wider">Shirt colors</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {kept.colors.map((color) => (
                  <button
                    key={color.key}
                    type="button"
                    onClick={() => setShown(color.hex)}
                    aria-pressed={background === color.hex}
                    className={cn("h-10 w-10 rounded-full border border-black/30", background === color.hex && "ring-2 ring-black ring-offset-2")}
                    style={{ background: color.hex }}
                    aria-label={color.name}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          )}
          {!offer && !kept.preparing && <GetItPrinted workId={kept.workId} ordering={kept.ordering} parentWithdrawn={kept.parentWithdrawn} />}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => saveImage(kept.url, designFilename({ generationId: kept.workId }))}
              className="rounded-2xl border-2 border-black px-5 py-3 text-base font-black"
            >
              Download
            </button>
            {kept.parentWithdrawn ? null : !confirming ? (
              <button type="button" onClick={() => setConfirming(true)} className="rounded-2xl bg-black px-5 py-3 text-base font-black text-white">
                Share with the world
              </button>
            ) : (
              <div className="w-full rounded-2xl border-2 border-black p-4">
                <p className="font-bold">Share it with the world?</p>
                <p className="mt-1 text-sm text-neutral-600">
                  It gets a CR number{kept.parent ? " as a variation of the original" : ""} and a spot in the feed, and anyone can order it or remix it. This can't be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" disabled={sharing} onClick={() => void shareIt()} className="rounded-xl bg-black px-4 py-2 font-black text-white disabled:opacity-40">
                    {sharing ? "Sharing…" : "Share it"}
                  </button>
                  <button type="button" disabled={sharing} onClick={() => setConfirming(false)} className="text-sm font-semibold underline underline-offset-4">
                    Not now
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="font-semibold text-red-600">
              {error}
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

type Ordering = "ask" | "requested" | "preparing" | "ready";

// Getting a kept design printed: ask, and an admin gets it ready (print files and products, for
// this creator alone); then the buy box above takes its place once checkout is open.
function GetItPrinted({ workId, ordering, parentWithdrawn }: { workId: Id<"works">; ordering: Ordering; parentWithdrawn: boolean }) {
  const request = useMutation(api.keeps.requestPrint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One already being made or ready stays so; nothing new starts.
  if (parentWithdrawn && (ordering === "ask" || ordering === "requested")) {
    return <p className="text-sm font-semibold">The design you remixed was taken down, so this one can't be printed or shared. It stays here for you.</p>;
  }
  if (ordering !== "ask") {
    return (
      <p className="text-sm font-semibold">
        {ordering === "ready"
          ? "It's ready to print. Ordering opens soon, right here."
          : "We're getting it ready to print. You'll order it here."}
      </p>
    );
  }
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      await request({ workId });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl border-2 border-black p-4">
      <p className="font-bold">Want it on a shirt?</p>
      <p className="mt-1 text-sm text-neutral-600">We'll get it ready to print, then you can order it here. No one else can.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void ask()}
        className="mt-3 rounded-xl bg-black px-4 py-2 font-black text-white disabled:opacity-40"
      >
        {busy ? "Asking…" : "Get it printed"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
