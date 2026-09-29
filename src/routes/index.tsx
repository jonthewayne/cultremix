import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";

export const Route = createFileRoute("/")({
  component: FeedPage,
});

type FeedItem = FunctionReturnType<typeof api.feed.list>[number];

function FeedPage() {
  const feed = useQuery(convexQuery(api.feed.list, {}));
  const items = feed.data ?? [];
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <section className="pt-6 md:pt-10">
          <h1 className="text-[17vw] font-black leading-[0.8] tracking-[-0.06em] md:text-[11vw]">
            Wear the
            <br />
            remix.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-snug md:text-xl">
            Every design gets a CR number. Anyone can remix it into the next one.
          </p>
          <Link to="/studio" className="mt-8 inline-block rounded-2xl bg-black px-8 py-4 text-lg font-black text-white transition-transform hover:-translate-y-0.5">
            Open the studio
          </Link>
        </section>
        <section className="mt-20 flex flex-col gap-16 md:gap-24">
          {feed.isLoading && <p className="text-neutral-500">Loading…</p>}
          {!feed.isLoading && items.length === 0 && (
            <div>
              <p className="text-2xl font-semibold text-neutral-400">Nothing published yet. The first one gets CR 101-001.</p>
              <Link to="/studio" className="mt-4 inline-block text-lg font-bold underline underline-offset-4">
                Make it in the studio
              </Link>
            </div>
          )}
          {items.map((item, i) => (
            <FeedRow key={item.workId} item={item} index={i} />
          ))}
        </section>
      </main>
    </div>
  );
}

function FeedRow({ item, index }: { item: FeedItem; index: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: Math.min(index, 3) * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Link to="/cr/$cr" params={{ cr: item.cr }} className="group block">
        <div className="grid grid-cols-2 gap-2 md:gap-4">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[7%]" style={{ background: item.backgroundColor }}>
            <Art url={item.artUrl} alt={item.title ?? `CR ${item.cr}`} className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]" />
          </div>
          <PhotoSquare item={item} />
        </div>
        <div className="mt-4 flex flex-col gap-2 md:mt-6 md:flex-row md:items-end md:justify-between md:gap-8">
          <CrMark cr={item.cr} className="text-[13vw] md:text-[7.5vw]" />
          <div className="md:pb-2 md:text-right">
            {item.title && <p className="text-2xl font-bold leading-tight md:text-3xl">{item.title}</p>}
            <p className="mt-1 text-base">
              by <span className="font-semibold">@{item.creator.username}</span>
              {item.creator.creatorNumber === 1 && <span className="text-neutral-500"> · Creator № 1</span>}
              {item.parentCr && <span className="text-neutral-500"> · Remix of CR {item.parentCr}</span>}
            </p>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}

export function PhotoSquare({ item, large = false }: { item: FeedItem; large?: boolean }) {
  if (item.photoUrl) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-100">
        {item.photoUrl.startsWith("fake:") ? (
          <div className="flex h-full w-full items-center justify-center" style={{ background: item.backgroundColor }}>
            <span className="text-sm font-bold opacity-60">Model photo (dev placeholder)</span>
          </div>
        ) : (
          <Art url={item.photoUrl} alt={`Model wearing CR ${item.cr}`} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
        )}
      </div>
    );
  }
  const failed = item.photoState === "failed";
  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-neutral-950 text-white">
      {!failed && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-neutral-800 via-neutral-950 to-neutral-800"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      )}
      <span className={large ? "relative text-3xl font-black tracking-tight" : "relative text-lg font-black tracking-tight md:text-2xl"}>
        {failed ? "No photo this time" : "Developing…"}
      </span>
    </div>
  );
}
