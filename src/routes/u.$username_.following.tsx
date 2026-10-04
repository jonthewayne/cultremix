import { createFileRoute } from "@tanstack/react-router";
import { FollowListPage, prefetchFollowList } from "~/components/social/FollowListPage";
import { pageMeta } from "~/lib/share";

export const Route = createFileRoute("/u/$username_/following")({
  loader: ({ context, params }) => prefetchFollowList(context, params.username, "following"),
  head: ({ params }) => ({ meta: pageMeta(`@${params.username} follows`, `/u/${params.username}/following`) }),
  component: FollowingPage,
});

function FollowingPage() {
  const { username } = Route.useParams();
  return <FollowListPage username={username} list="following" />;
}
