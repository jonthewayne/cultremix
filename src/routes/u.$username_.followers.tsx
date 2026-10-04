import { createFileRoute } from "@tanstack/react-router";
import { FollowListPage, prefetchFollowList } from "~/components/social/FollowListPage";
import { pageMeta } from "~/lib/share";

export const Route = createFileRoute("/u/$username_/followers")({
  loader: ({ context, params }) => prefetchFollowList(context, params.username, "followers"),
  head: ({ params }) => ({ meta: pageMeta(`@${params.username}’s followers`, `/u/${params.username}/followers`) }),
  component: FollowersPage,
});

function FollowersPage() {
  const { username } = Route.useParams();
  return <FollowListPage username={username} list="followers" />;
}
