import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { DirectRemixes } from "~/components/cr/DirectRemixes";
import { EconomicsPanel } from "~/components/cr/EconomicsPanel";
import { FamilyView } from "~/components/cr/FamilyView";
import { LineageNote, LineageSection } from "~/components/cr/LineageTrail";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { FollowButton } from "~/components/social/FollowButton";
import { HeartButton } from "~/components/social/HeartButton";
import { PrintEntry } from "~/components/print/PrintEntry";
import { colorName } from "../../convex/lib/colors";
import { PhotoSquare } from "./index";

export const Route = createFileRoute("/cr/$cr")({
  loader: async ({ context, params }) => {
    if (!context.convexQueryClient.serverHttpClient) return;
    await context.queryClient.fetchQuery(convexQuery(api.feed.byCr, { cr: params.cr })).catch(() => null);
  },
  head: ({ params }) => ({ meta: [{ title: `CR ${params.cr} · CultRemix` }] }),
  component: ShopPage,
});

const SIZES = ["S", "M", "L", "XL", "2XL"];

function ShopPage() {
  const { cr } = Route.useParams();
  const page = useQuery(convexQuery(api.feed.byCr, { cr }));
  const data = page.data;

  if (page.isLoading) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="px-4 pt-16 md:px-10">
          <CrMark cr={cr} className="text-7xl text-neutral-300" />
          <p className="mt-6 text-xl">This design isn’t published.</p>
          <Link to="/" className="mt-6 inline-block font-bold underline underline-offset-4">Back to the feed</Link>
        </main>
      </div>
    );
  }
  const { item, contentHash } = data;
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <div className="grid grid-cols-1 gap-2 pt-4 sm:grid-cols-2 md:gap-4">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[7%]" style={{ background: item.backgroundColor }}>
            <Art url={item.artMediumUrl ?? item.artUrl} fullUrl={item.artUrl} alt={item.title ?? `CR ${item.cr}`} className="h-full w-auto max-w-full object-contain" />
          </div>
          <PhotoSquare item={item} large />
        </div>

        <section className="mt-8 grid gap-10 md:mt-12 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16">
          <div>
            <CrMark cr={item.cr} className="text-[20vw] md:text-[10vw]" />
            {item.title && <h1 className="mt-4 text-4xl font-black leading-none tracking-tight md:text-6xl">{item.title}</h1>}
            <p className="mt-4 text-xl">
              by{" "}
              <Link to="/u/$username" params={{ username: item.creator.username }} className="font-bold hover:underline">
                @{item.creator.username}
              </Link>
              {item.creator.creatorNumber === 1 && <span className="text-neutral-500"> · Creator № 1</span>}
            </p>
            <LineageNote cr={item.cr} />
            <div className="mt-4 flex items-center gap-2">
              <HeartButton workId={item.workId} count={item.hearts} />
              <FollowButton username={item.creator.username} />
            </div>
                      </div>

          <div className="flex flex-col gap-6">
            <div className="flex items-baseline justify-between border-t-2 border-black pt-4">
              <span className="text-5xl font-black tracking-tight">$36</span>
              <span className="text-sm font-semibold">Heavyweight garment-dyed tee</span>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-wider">Color</p>
              <p className="mt-2 flex items-center gap-3 text-lg">
                <span className="h-7 w-7 rounded-full border-2 border-black" style={{ background: item.backgroundColor }} />
                <span className="capitalize">{colorName(item.backgroundColor)}</span>
              </p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-wider">Size</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SIZES.map((size) => (
                  <span key={size} className="flex h-11 min-w-11 items-center justify-center rounded-xl border-2 border-black px-3 font-bold">
                    {size}
                  </span>
                ))}
              </div>
            </div>
            <button type="button" disabled className="h-14 w-full cursor-not-allowed rounded-2xl bg-neutral-200 text-lg font-black text-neutral-500">
              Buying opens soon
            </button>
            <Link
              to="/studio"
              search={{ remix: item.cr }}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-black text-lg font-black text-white transition-transform hover:-translate-y-0.5"
            >
              Remix this
            </Link>
            <EconomicsPanel cr={item.cr} />
            {contentHash && (
              <div className="border-t-2 border-black pt-4 text-sm">
                <p className="font-bold uppercase tracking-wider">Fingerprint</p>
                <p className="mt-1 break-all font-mono text-xs">SHA-256 {contentHash}</p>
                <p className="mt-2 font-semibold">Verified on Monad — coming soon</p>
              </div>
            )}
            <PrintEntry cr={item.cr} />
          </div>
        </section>

        <LineageSection cr={item.cr} />
        <DirectRemixes cr={item.cr} />
        <FamilyView cr={item.cr} />
      </main>
    </div>
  );
}
