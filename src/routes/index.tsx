import { Link, createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { CrMark } from "~/components/cr/CrMark";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { FollowButton } from "~/components/social/FollowButton";
import { HeartButton } from "~/components/social/HeartButton";
import { LoadMore } from "~/components/social/LoadMore";
import type { FeedItem } from "~/components/social/WorkGrid";
import { useMemberAction } from "~/components/social/useSignIn";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import type { PagedStatus } from "~/hooks/use-paged-query";
import { cn } from "~/lib/utils";

type FeedTab = "latest" | "following";
const PAGE_SIZE = 6;

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: "following" } =>
    search.tab === "following" ? { tab: "following" } : {},
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ context, deps }) =>
    deps.tab === "following"
      ? prefetchFirstPage(context, api.feed.following, {}, PAGE_SIZE)
      : prefetchFirstPage(context, api.feed.latest, {}, PAGE_SIZE),
  component: FeedPage,
});

function FeedPage() {
  const { tab: requested } = Route.useSearch();
  const { signedIn } = useMemberAction();
  // Following is for members; signed out, everyone sees Latest.
  const tab: FeedTab = requested === "following" && signedIn !== false ? "following" : "latest";
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <section className="pt-6 md:pt-10">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] md:mb-6 md:text-sm md:tracking-[0.2em]">
            The social creative-commerce platform
          </p>
          <h1 className="text-[17vw] font-black leading-[0.8] tracking-[-0.06em] md:text-[11vw]">
            Remix culture,
            <br />
            get paid.
          </h1>
          <p className="mt-10 max-w-2xl text-xl font-medium leading-snug md:mt-14 md:text-2xl">
            <span className="block sm:inline">Remix anything you see.</span> Wear it, share it, sell it.
          </p>
          <Link to="/studio" className="mt-8 inline-block rounded-2xl bg-black px-8 py-4 text-lg font-black text-white transition-transform hover:-translate-y-0.5">
            Open the studio
          </Link>
        </section>
        <section className="mt-20">
          {signedIn && <FeedTabs tab={tab} />}
          {tab === "following" ? <FollowingFeed /> : <LatestFeed />}
        </section>
      </main>
    </div>
  );
}

function FeedTabs({ tab }: { tab: FeedTab }) {
  const tabs: Array<{ id: FeedTab; label: string }> = [
    { id: "latest", label: "Latest" },
    { id: "following", label: "Following" },
  ];
  return (
    <nav aria-label="Feed" className="mb-10 flex gap-2 md:mb-14">
      {tabs.map(({ id, label }) => (
        <Link
          key={id}
          to="/"
          search={id === "following" ? { tab: "following" } : {}}
          resetScroll={false}
          aria-current={tab === id ? "page" : undefined}
          className={cn(
            "rounded-full border-2 border-black px-5 py-2 text-base font-black transition-colors",
            tab === id ? "bg-black text-white" : "bg-white hover:bg-neutral-100",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function LatestFeed() {
  const { items, status, loadMore } = usePagedQuery(api.feed.latest, {}, PAGE_SIZE);
  return (
    <FeedList items={items} status={status} loadMore={loadMore}>
      <p className="text-2xl font-semibold text-neutral-400">Nothing published yet. The first one gets CR 101-001.</p>
      <Link to="/studio" className="mt-4 inline-block text-lg font-bold underline underline-offset-4">
        Make it in the studio
      </Link>
    </FeedList>
  );
}

function FollowingFeed() {
  const { signedIn } = useMemberAction();
  const { items, status, loadMore } = usePagedQuery(api.feed.following, signedIn ? {} : "skip", PAGE_SIZE);
  return (
    <FeedList items={items} status={status} loadMore={loadMore}>
      <p className="max-w-xl text-2xl font-semibold text-neutral-400">
        New designs from the people you follow land here.
      </p>
      <Link to="/" search={{}} resetScroll={false} className="mt-4 inline-block text-lg font-bold underline underline-offset-4">
        Find someone to follow
      </Link>
    </FeedList>
  );
}

function FeedList({
  items,
  status,
  loadMore,
  children,
}: {
  items: Array<FeedItem>;
  status: PagedStatus;
  loadMore: () => void;
  children: ReactNode;
}) {
  if (status === "LoadingFirstPage") return <p className="text-neutral-500">Loading…</p>;
  if (items.length === 0 && status === "Exhausted") return <div>{children}</div>;
  return (
    <div className="flex flex-col gap-16 md:gap-24">
      {items.map((item, i) => (
        <FeedRow key={item.workId} item={item} index={i} />
      ))}
      <LoadMore status={status} loadMore={loadMore} />
    </div>
  );
}

function FeedRow({ item, index }: { item: FeedItem; index: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: Math.min(index % PAGE_SIZE, 3) * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Link to="/cr/$cr" params={{ cr: item.cr }} className="group block">
        <div className="grid grid-cols-2 gap-2 md:gap-4">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[7%]" style={{ background: item.backgroundColor }}>
            <Art url={item.artMediumUrl ?? item.artUrl} alt={item.title ?? `CR ${item.cr}`} className="h-full w-auto max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.04]" />
          </div>
          <PhotoSquare item={item} />
        </div>
      </Link>
      <div className="mt-4 flex flex-col gap-2 md:mt-6 md:flex-row md:items-end md:justify-between md:gap-8">
        <Link to="/cr/$cr" params={{ cr: item.cr }} className="self-start">
          <CrMark cr={item.cr} className="text-[13vw] md:text-[7.5vw]" />
        </Link>
        <div className="md:pb-2 md:text-right">
          {item.title && (
            <Link to="/cr/$cr" params={{ cr: item.cr }} className="block text-2xl font-bold leading-tight md:text-3xl">
              {item.title}
            </Link>
          )}
          <p className="mt-1 text-base">
            by{" "}
            <Link to="/u/$username" params={{ username: item.creator.username }} className="font-semibold hover:underline">
              @{item.creator.username}
            </Link>
            {item.creator.creatorNumber === 1 && <span className="text-neutral-500"> · Creator № 1</span>}
            {item.parentCr && <span className="text-neutral-500"> · Remix of CR {item.parentCr}</span>}
          </p>
          <div className="mt-3 flex items-center gap-2 md:justify-end">
            <HeartButton workId={item.workId} count={item.hearts} size="sm" />
            <FollowButton username={item.creator.username} size="sm" />
          </div>
        </div>
      </div>
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
          <Art url={item.photoMediumUrl ?? item.photoUrl} alt={`Model wearing CR ${item.cr}`} className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]" />
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
