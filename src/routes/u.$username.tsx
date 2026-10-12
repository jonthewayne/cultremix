import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { NotFoundPage } from "~/components/app/not-found";
import { SiteFooter } from "~/components/cr/SiteFooter";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { ProfileSkeleton, ShelfSkeleton } from "~/components/cr/PageSkeletons";
import { Avatar } from "~/components/social/Avatar";
import { FollowButton } from "~/components/social/FollowButton";
import { LoadMore } from "~/components/social/LoadMore";
import { ShareButton } from "~/components/social/ShareButton";
import { WorkGrid } from "~/components/social/WorkGrid";
import { useMemberAction } from "~/components/social/useSignIn";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import { profileShareCard, shareMeta } from "~/lib/share";
import { cn } from "~/lib/utils";
import { useShowWhenFound } from "~/hooks/use-show-when-found";

type Shelf = "works" | "remixes" | "backed" | "kept";
const PAGE_SIZE = 12;
// Kept is only on your own profile: the designs you kept just for you.
const SHELVES: Array<{ id: Shelf; label: string; selfOnly?: boolean }> = [
  { id: "works", label: "Works" },
  { id: "remixes", label: "Remixes" },
  { id: "backed", label: "Backed" },
  { id: "kept", label: "Kept", selfOnly: true },
];

export const Route = createFileRoute("/u/$username")({
  validateSearch: (search: Record<string, unknown>): { shelf?: "remixes" | "backed" | "kept" } =>
    search.shelf === "remixes" || search.shelf === "backed" || search.shelf === "kept" ? { shelf: search.shelf } : {},
  loaderDeps: ({ search }): { shelf: Shelf } => ({ shelf: search.shelf ?? "works" }),
  loader: async ({ context, params, deps }) => {
    const username = params.username;
    const options = convexQuery(api.social.profile, { username });
    if (context.convexQueryClient.serverHttpClient) {
      await Promise.all([
        context.queryClient.fetchQuery(options).catch(() => null),
        deps.shelf === "backed"
          ? prefetchFirstPage(context, api.social.backed, { username }, PAGE_SIZE)
          : deps.shelf === "kept"
            ? Promise.resolve()
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
  useShowWhenFound(useQuery(convexQuery(api.social.profile, { username })).data);
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
        <ProfileSkeleton />
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
          {SHELVES.filter((item) => !item.selfOnly || isSelf).map(({ id, label }) => (
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
        {shelf === "kept" ? (
          isSelf ? (
            <KeptGrid />
          ) : (
            <p className="mt-8 text-xl font-semibold text-neutral-500">Kept designs are only shown to their creator.</p>
          )
        ) : shelf === "backed" ? (
          <BackedGrid key={`${username}:backed`} username={username} isSelf={isSelf} />
        ) : (
          <ShelfGrid key={`${username}:${shelf}`} username={username} shelf={shelf} isSelf={isSelf} />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ShelfGrid({ username, shelf, isSelf }: { username: string; shelf: "works" | "remixes"; isSelf: boolean }) {
  const { items, status, loadMore } = usePagedQuery(api.social.works, { username, shelf }, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <ShelfSkeleton />;
  if (items.length === 0 && status === "Exhausted") {
    if (shelf === "works") return <NoOriginals username={username} isSelf={isSelf} />;
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-500">No remixes yet.</p>
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

// An empty Works shelf: a member whose designs are all remixes shows those here instead of
// "nothing published".
function NoOriginals({ username, isSelf }: { username: string; isSelf: boolean }) {
  const { items, status, loadMore } = usePagedQuery(api.social.works, { username, shelf: "remixes" }, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <ShelfSkeleton />;
  if (items.length === 0) {
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-500">No designs published yet.</p>
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
      <p className="text-xl font-semibold text-neutral-500">{isSelf ? "No originals yet. Your remixes:" : "No originals yet. Their remixes:"}</p>
      <div className="mt-6">
        <WorkGrid items={items} showCreator={false} />
        <LoadMore status={status} loadMore={loadMore} className="mt-12" />
      </div>
    </div>
  );
}

// Your kept designs ("Keep it just for you"), newest first. Only you see this shelf.
function KeptGrid() {
  const { items, status, loadMore } = usePagedQuery(api.keeps.mine, {}, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <ShelfSkeleton />;
  if (items.length === 0 && status === "Exhausted") {
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-500">Nothing kept yet.</p>
        <p className="mt-2 text-neutral-600">When you publish, choose Keep it just for you, and it waits here, private to you.</p>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.workId}>
            <Link to="/keep/$workId" params={{ workId: item.workId }} className="block">
              <span className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl p-[10%]" style={{ background: item.backgroundColor }}>
                {item.thumbUrl && <img src={item.thumbUrl} alt="" className="h-full w-auto max-w-full object-contain" />}
              </span>
              <span className="mt-2 block truncate text-sm font-bold">{item.title ?? "Untitled"}</span>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={loadMore} className="mt-12" />
    </div>
  );
}

// The works this member has Backed, newest first, each with their backer number.
function BackedGrid({ username, isSelf }: { username: string; isSelf: boolean }) {
  const { items, status, loadMore } = usePagedQuery(api.social.backed, { username }, PAGE_SIZE);
  if (status === "LoadingFirstPage") return <ShelfSkeleton />;
  if (items.length === 0 && status === "Exhausted") {
    return (
      <div className="mt-8">
        <p className="text-xl font-semibold text-neutral-500">Nothing Backed yet.</p>
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
