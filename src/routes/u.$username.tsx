import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { Avatar } from "~/components/social/Avatar";
import { FollowButton } from "~/components/social/FollowButton";
import { LoadMore } from "~/components/social/LoadMore";
import { WorkGrid } from "~/components/social/WorkGrid";
import { useMemberAction } from "~/components/social/useSignIn";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import { cn } from "~/lib/utils";

type Shelf = "works" | "remixes";
const PAGE_SIZE = 12;

export const Route = createFileRoute("/u/$username")({
  validateSearch: (search: Record<string, unknown>): { shelf?: "remixes" } =>
    search.shelf === "remixes" ? { shelf: "remixes" } : {},
  loaderDeps: ({ search }): { shelf: Shelf } => ({ shelf: search.shelf ?? "works" }),
  loader: async ({ context, params, deps }) => {
    if (!context.convexQueryClient.serverHttpClient) return;
    const username = params.username;
    await Promise.all([
      context.queryClient.fetchQuery(convexQuery(api.social.profile, { username })).catch(() => null),
      prefetchFirstPage(context, api.social.works, { username, shelf: deps.shelf }, PAGE_SIZE),
    ]);
  },
  head: ({ params }) => ({ meta: [{ title: `@${params.username} · CultRemix` }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();
  const shelf: Shelf = Route.useSearch().shelf ?? "works";
  const profile = useQuery(convexQuery(api.social.profile, { username }));
  const { username: viewerName } = useMemberAction();

  if (profile.isLoading) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
      </div>
    );
  }
  const data = profile.data;
  if (!data) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="px-4 pt-16 md:px-10">
          <p className="break-words text-5xl font-black tracking-tight text-neutral-300 md:text-7xl">@{username}</p>
          <p className="mt-6 text-xl">No one here by that name.</p>
          <Link to="/" className="mt-6 inline-block font-bold underline underline-offset-4">
            Back to the feed
          </Link>
        </main>
      </div>
    );
  }
  const isSelf = viewerName?.toLowerCase() === data.username.toLowerCase();

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="px-4 pb-24 md:px-10">
        <section className="flex flex-col gap-6 pt-6 md:flex-row md:items-end md:justify-between md:gap-10 md:pt-10">
          <div className="flex min-w-0 items-center gap-4 md:gap-7">
            <Avatar username={data.username} image={data.image} className="size-20 md:size-32" />
            <div className="min-w-0">
              <h1 className="truncate pt-[0.06em] pb-[0.04em] text-[11vw] font-black leading-[0.95] tracking-[-0.05em] md:text-[6vw]">
                @{data.username}
              </h1>
              {data.creatorNumber !== undefined && (
                <p className="mt-2 flex items-baseline gap-2 md:mt-3">
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">Creator</span>
                  <span className="font-cr text-2xl leading-none tabular-nums md:text-3xl">
                    № {data.creatorNumber}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isSelf ? (
              <Link
                to="/settings"
                className="flex h-11 items-center rounded-full border-2 border-black px-6 font-black hover:bg-neutral-100"
              >
                Edit profile
              </Link>
            ) : (
              <FollowButton username={username} />
            )}
          </div>
        </section>

        {data.bio && <p className="mt-6 max-w-2xl md:mt-8 text-lg leading-snug md:text-xl">{data.bio}</p>}
        <p className="mt-4 flex gap-5 text-base">
          <span>
            <strong className="font-black tabular-nums">{data.followers}</strong>{" "}
            {data.followers === 1 ? "follower" : "followers"}
          </span>
          <span>
            <strong className="font-black tabular-nums">{data.following}</strong> following
          </span>
        </p>

        <nav aria-label="Designs" className="mt-12 flex gap-6 border-b-2 border-black md:mt-16">
          {(["works", "remixes"] as const).map((id) => (
            <Link
              key={id}
              to="/u/$username"
              params={{ username }}
              search={id === "remixes" ? { shelf: "remixes" } : {}}
              resetScroll={false}
              aria-current={shelf === id ? "page" : undefined}
              className={cn(
                "-mb-0.5 border-b-4 pb-2 text-sm font-bold uppercase tracking-wider",
                shelf === id ? "border-black" : "border-transparent text-neutral-500 hover:text-black",
              )}
            >
              {id === "works" ? "Works" : "Remixes"}
            </Link>
          ))}
        </nav>
        <ShelfGrid key={`${username}:${shelf}`} username={username} shelf={shelf} isSelf={isSelf} />
      </main>
    </div>
  );
}

function ShelfGrid({ username, shelf, isSelf }: { username: string; shelf: Shelf; isSelf: boolean }) {
  const { items, status, loadMore } = usePagedQuery(api.social.works, { username, shelf }, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <p className="mt-8 text-neutral-500">Loading…</p>;
  if (items.length === 0 && status === "Exhausted") {
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-400">
          {shelf === "works" ? "No designs published yet." : "No remixes yet."}
        </p>
        {isSelf && (
          <Link to="/studio" className="mt-3 inline-block font-bold underline underline-offset-4">
            Make one in the studio
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="mt-8">
      <WorkGrid items={items} showCreator={false} />
      <LoadMore status={status} loadMore={loadMore} className="mt-12" />
    </div>
  );
}
