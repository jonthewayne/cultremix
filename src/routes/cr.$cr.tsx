import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { NotFoundPage } from "~/components/app/not-found";
import { Art } from "~/components/cr/Art";
import { ChainStatus } from "~/components/cr/ChainStatus";
import { ColorSwatches } from "~/components/cr/ColorSwatches";
import { CrMark } from "~/components/cr/CrMark";
import { DirectRemixes } from "~/components/cr/DirectRemixes";
import { EarlyAccess } from "~/components/cr/EarlyAccess";
import { EconomicsPanel } from "~/components/cr/EconomicsPanel";
import { FamilyView } from "~/components/cr/FamilyView";
import { LineageNote, LineageSection } from "~/components/cr/LineageTrail";
import { PhotoRetry } from "~/components/cr/PhotoRetry";
import { RemixableWords, WordChangesNote } from "~/components/cr/RemixableWords";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { Backers } from "~/components/work/Backers";
import { FollowButton } from "~/components/social/FollowButton";
import { HeartButton } from "~/components/social/HeartButton";
import { ShareButton } from "~/components/social/ShareButton";
import { PrintEntry } from "~/components/print/PrintEntry";
import { pageColors, selectedColor, type PickedColor } from "~/lib/pickedColor";
import { shareMeta, workShareCard } from "~/lib/share";
import { PhotoSquare } from "./index";
import { BuyBox } from "~/components/commerce/BuyBox";

export const Route = createFileRoute("/cr/$cr")({
  loader: async ({ context, params }) => {
    const options = convexQuery(api.feed.byCr, { cr: params.cr });
    if (context.convexQueryClient.serverHttpClient) {
      await context.queryClient.fetchQuery(options).catch(() => null);
    }
    // The link preview comes from the page data already fetched (or cached, in the browser).
    const data = context.queryClient.getQueryData(options.queryKey) as
      | FunctionReturnType<typeof api.feed.byCr>
      | undefined;
    // Null (not undefined) means the server asked and there's no such work: answer 404.
    if (data === null) throw notFound();
    return { share: data ? workShareCard(data.item) : null };
  },
  head: ({ params, loaderData }) => ({
    meta: loaderData?.share ? shareMeta(loaderData.share) : [{ title: `CR ${params.cr} · CultRemix` }],
  }),
  component: ShopPage,
  notFoundComponent: WorkNotFound,
});

function WorkNotFound() {
  const { cr } = Route.useParams();
  return <NotFoundPage mark={`CR ${cr}`} message="This design isn’t published." />;
}

const SIZES = ["S", "M", "L", "XL", "2XL"];

function ShopPage() {
  const { cr } = Route.useParams();
  const page = useQuery(convexQuery(api.feed.byCr, { cr }));
  // Null until checkout opens and this work is on sale; the page is unchanged until then.
  const offer = useQuery(convexQuery(api.shopify.offer, { cr })).data;
  const data = page.data;
  // The picked shirt color, remembered per work so moving to another CR starts on its lead. The
  // one selection for the art square, the swatches, and the buy box.
  const [picked, setPicked] = useState<PickedColor>(null);

  if (page.isLoading) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
      </div>
    );
  }
  if (!data) return <WorkNotFound />;
  const { item, contentHash, description } = data;
  const colors = pageColors(data.colors, offer);
  const color = selectedColor(colors, picked, item.cr);
  const pick = (key: string) => setPicked({ cr: item.cr, key });
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <div className="grid grid-cols-1 gap-2 pt-4 sm:grid-cols-2 md:gap-4">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[7%] transition-colors duration-300" style={{ background: color?.hex ?? item.backgroundColor }}>
            <Art url={item.artMediumUrl ?? item.artUrl} fullUrl={item.artUrl} alt={item.title ?? `CR ${item.cr}`} className="h-full w-auto max-w-full object-contain" />
          </div>
          <PhotoSquare item={item} large />
        </div>
        <PhotoRetry cr={item.cr} />

        <section className="mt-8 grid gap-10 md:mt-12 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16">
          <div>
            <CrMark cr={item.cr} className="text-[13vw] md:text-[6.5vw]" />
            {item.title && <h1 className="mt-4 text-4xl font-black leading-none tracking-tight md:text-6xl">{item.title}</h1>}
            {description && <p className="mt-4 max-w-prose whitespace-pre-line text-lg leading-snug">{description}</p>}
            <p className="mt-4 text-xl">
              by{" "}
              <Link to="/u/$username" params={{ username: item.creator.username }} className="font-bold hover:underline">
                @{item.creator.username}
              </Link>
              {item.creator.creatorNumber === 1 && <span className="text-neutral-500"> · Creator № 1</span>}
            </p>
            <LineageNote cr={item.cr} />
            <WordChangesNote workId={item.workId} />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <HeartButton workId={item.workId} count={item.hearts} />
              <FollowButton username={item.creator.username} />
              <ShareButton path={`/cr/${item.cr}`} title={item.title ? `CR ${item.cr} · ${item.title}` : `CR ${item.cr}`} />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {offer ? (
              <BuyBox offer={offer} colorKey={color?.key ?? ""} onColorChange={pick} />
            ) : (
              <>
                <div className="flex items-baseline justify-between border-t-2 border-black pt-4">
                  <span className="text-5xl font-black tracking-tight">$36</span>
                  <span className="text-sm font-semibold">Heavyweight garment-dyed tee</span>
                </div>
                {color && <ColorSwatches colors={colors} value={color.key} onChange={pick} />}
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
                <EarlyAccess workId={item.workId} />
              </>
            )}
            <Link
              to="/studio"
              search={{ remix: item.cr }}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-black text-lg font-black text-white transition-transform hover:-translate-y-0.5"
            >
              Remix this
            </Link>
            <RemixableWords workId={item.workId} />
            <EconomicsPanel cr={item.cr} />
            {contentHash && (
              <div className="border-t-2 border-black pt-4 text-sm">
                <p className="font-bold uppercase tracking-wider">Fingerprint</p>
                <p className="mt-1 break-all font-mono text-xs">SHA-256 {contentHash}</p>
                <ChainStatus workId={item.workId} />
              </div>
            )}
            <Backers workId={item.workId} cr={item.cr} />
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
