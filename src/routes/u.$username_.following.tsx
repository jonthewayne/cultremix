import { createFileRoute } from "@tanstack/react-router";
import { FollowListPage, prefetchFollowList } from "~/components/social/FollowListPage";

export const Route = createFileRoute("/u/$username_/following")({
  loader: ({ context, params }) => prefetchFollowList(context, params.username, "following"),
  head: ({ params }) => ({ meta: [{ title: `@${params.username} follows · CultRemix` }] }),
  component: FollowingPage,
});

function FollowingPage() {
  const { username } = Route.useParams();
  return <FollowListPage username={username} list="following" />;
}
