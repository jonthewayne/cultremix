import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import { MemberList } from "./MemberList";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { prefetchFirstPage, usePagedQuery } from "~/hooks/use-paged-query";
import { cn } from "~/lib/utils";

export type FollowList = "followers" | "following";
const PAGE_SIZE = 24;

const queries = { followers: api.social.followers, following: api.social.following };

export async function prefetchFollowList(
  context: { queryClient: QueryClient; convexQueryClient: ConvexQueryClient },
  username: string,
  list: FollowList,
) {
  if (!context.convexQueryClient.serverHttpClient) return;
  await Promise.all([
    context.queryClient.fetchQuery(convexQuery(api.social.profile, { username })).catch(() => null),
    prefetchFirstPage(context, queries[list], { username }, PAGE_SIZE),
  ]);
}

// /u/<username>/followers and /u/<username>/following.
export function FollowListPage({ username, list }: { username: string; list: FollowList }) {
  const profile = useQuery(convexQuery(api.social.profile, { username })).data;
  const { items, status, loadMore } = usePagedQuery(queries[list], { username }, PAGE_SIZE);
  const name = profile?.username ?? username;

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:px-10 md:pt-10">
        <Link
          to="/u/$username"
          params={{ username: name }}
          className="inline-block max-w-full truncate text-lg font-bold hover:underline"
        >
          ← @{name}
        </Link>
        <nav aria-label="People" className="mt-6 flex gap-6 border-b-2 border-black">
          {(["followers", "following"] as const).map((id) => (
            <Link
              key={id}
              to={id === "followers" ? "/u/$username/followers" : "/u/$username/following"}
              params={{ username: name }}
              replace
              resetScroll={false}
              aria-current={list === id ? "page" : undefined}
              className={cn(
                "-mb-0.5 border-b-4 pb-2 text-sm font-bold uppercase tracking-wider",
                list === id ? "border-black" : "border-transparent text-neutral-500 hover:text-black",
              )}
            >
              {id === "followers" ? "Followers" : "Following"}
              {profile && (
                <span className="ml-2 tabular-nums">{id === "followers" ? profile.followers : profile.following}</span>
              )}
            </Link>
          ))}
        </nav>
        {profile === null ? (
          <p className="mt-8 text-xl">No one here by that name.</p>
        ) : (
          <MemberList
            members={items}
            status={status}
            loadMore={loadMore}
            empty={list === "followers" ? "No followers yet." : "Not following anyone yet."}
          />
        )}
      </main>
    </div>
  );
}
