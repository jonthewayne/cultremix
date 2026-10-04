import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { NotFoundPage } from "~/components/app/not-found";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { Avatar } from "~/components/social/Avatar";
import { FollowButton } from "~/components/social/FollowButton";
import { LoadMore } from "~/components/social/LoadMore";
import { ShareButton } from "~/components/social/ShareButton";
import { WorkGrid } from "~/components/social/WorkGrid";
import { useMemberAction } from "~/components/social/useSignIn";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import { profileShareCard, shareMeta } from "~/lib/share";
import { cn } from "~/lib/utils";

type Shelf = "works" | "remixes" | "backed";
const PAGE_SIZE = 12;
const SHELVES: Array<{ id: Shelf; label: string }> = [
  { id: "works", label: "Works" },
  { id: "remixes", label: "Remixes" },
  { id: "backed", label: "Backed" },
];

export const Route = createFileRoute("/u/$username")({
  validateSearch: (search: Record<string, unknown>): { shelf?: "remixes" | "backed" } =>
    search.shelf === "remixes" || search.shelf === "backed" ? { shelf: search.shelf } : {},
  loaderDeps: ({ search }): { shelf: Shelf } => ({ shelf: search.shelf ?? "works" }),
  loader: async ({ context, params, deps }) => {
    const username = params.username;
    const options = convexQuery(api.social.profile, { username });
    if (context.convexQueryClient.serverHttpClient) {
      await Promise.all([
        context.queryClient.fetchQuery(options).catch(() => null),
        deps.shelf === "backed"
          ? prefetchFirstPage(context, api.social.backed, { username }, PAGE_SIZE)
          : prefetchFirstPage(context, api.social.works, { username, shelf: deps.shelf }, PAGE_SIZE),
      ]);
    }
    const profile = context.queryClient.getQueryData(options.queryKey) as
      | FunctionReturnType<typeof api.social.profile>
      | undefined;
    // Null (not undefined) means the server asked and there's no such member: answer 404.
    if (profile === null) throw notFound();
    return { share: profile ? profileShareCard(profile) : null };
  },
  head: ({ params, loaderData }) => ({
    meta: loaderData?.share ? shareMeta(loaderData.share) : [{ title: `@${params.username} · CultRemix` }],
  }),
  component: ProfilePage,
  notFoundComponent: MemberNotFound,
});

function MemberNotFound() {
  const { username } = Route.useParams();
  return <NotFoundPage mark={`@${username}`} message="No one here by that name." mono={false} />;
}

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
  if (!data) return <MemberNotFound />;
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
            <ShareButton path={`/u/${data.username}`} title={`@${data.username} on CultRemix`} />
          </div>
        </section>

        {data.bio && <p className="mt-6 max-w-2xl md:mt-8 text-lg leading-snug md:text-xl">{data.bio}</p>}
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-base">
          <Link to="/u/$username/followers" params={{ username: data.username }} className="hover:underline">
            <strong className="font-black tabular-nums">{data.followers}</strong>{" "}
            {data.followers === 1 ? "follower" : "followers"}
          </Link>
          <Link to="/u/$username/following" params={{ username: data.username }} className="hover:underline">
            <strong className="font-black tabular-nums">{data.following}</strong> following
          </Link>
          <Link
            to="/u/$username"
            params={{ username: data.username }}
            search={{ shelf: "backed" }}
            resetScroll={false}
            className="hover:underline"
          >
            <strong className="font-black tabular-nums">{data.backed}</strong> backed
          </Link>
        </p>

        <nav aria-label="Designs" className="mt-12 flex gap-6 border-b-2 border-black md:mt-16">
          {SHELVES.map(({ id, label }) => (
            <Link
              key={id}
              to="/u/$username"
              params={{ username }}
              search={id === "works" ? {} : { shelf: id }}
              resetScroll={false}
              aria-current={shelf === id ? "page" : undefined}
              className={cn(
                "-mb-0.5 border-b-4 pb-2 text-sm font-bold uppercase tracking-wider",
                shelf === id ? "border-black" : "border-transparent text-neutral-500 hover:text-black",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        {shelf === "backed" ? (
          <BackedGrid key={`${username}:backed`} username={username} isSelf={isSelf} />
        ) : (
          <ShelfGrid key={`${username}:${shelf}`} username={username} shelf={shelf} isSelf={isSelf} />
        )}
      </main>
    </div>
  );
}

function ShelfGrid({ username, shelf, isSelf }: { username: string; shelf: "works" | "remixes"; isSelf: boolean }) {
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

// The works this member has Backed, newest first, each with their backer number.
function BackedGrid({ username, isSelf }: { username: string; isSelf: boolean }) {
  const { items, status, loadMore } = usePagedQuery(api.social.backed, { username }, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <p className="mt-8 text-neutral-500">Loading…</p>;
  if (items.length === 0 && status === "Exhausted") {
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-400">Nothing Backed yet.</p>
        {isSelf && <p className="mt-2 text-neutral-600">Back a work you love from its page. You get 3 Backs a week.</p>}
      </div>
    );
  }
  return (
    <div className="mt-8">
      <WorkGrid items={items} />
      <LoadMore status={status} loadMore={loadMore} className="mt-12" />
    </div>
  );
}
