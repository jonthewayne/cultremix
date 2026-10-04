import { createFileRoute } from "@tanstack/react-router";
import { FollowListPage, prefetchFollowList } from "~/components/social/FollowListPage";

export const Route = createFileRoute("/u/$username_/followers")({
  loader: ({ context, params }) => prefetchFollowList(context, params.username, "followers"),
  head: ({ params }) => ({ meta: [{ title: `@${params.username}’s followers · CultRemix` }] }),
  component: FollowersPage,
});

function FollowersPage() {
  const { username } = Route.useParams();
  return <FollowListPage username={username} list="followers" />;
}
