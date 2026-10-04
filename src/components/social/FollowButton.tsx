import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { showMutationError, useMemberAction } from "./useSignIn";
import { cn } from "~/lib/utils";

// Follow / Following. Flips at once; the server's answer settles it. Hidden on your own name.
export function FollowButton({
  username,
  size = "md",
  className,
}: {
  username: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { signedIn, username: viewerName, signIn } = useMemberAction();
  const self = viewerName !== undefined && viewerName.toLowerCase() === username.toLowerCase();
  const state = useQuery(convexQuery(api.social.followState, signedIn && !self ? { username } : "skip")).data;
  const setFollow = useMutation(api.social.setFollow).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.social.followState, { username: args.username });
    if (current?.self || current?.following === args.follow) return;
    store.setQuery(api.social.followState, { username: args.username }, { following: args.follow, self: false });
    const profile = store.getQuery(api.social.profile, { username: args.username });
    if (profile) {
      store.setQuery(
        api.social.profile,
        { username: args.username },
        { ...profile, followers: Math.max(0, profile.followers + (args.follow ? 1 : -1)) },
      );
    }
  });

  if (self || state?.self) return null;
  const following = state?.following === true;
  const onClick = () => {
    if (signedIn === undefined) return;
    if (!signedIn) return signIn();
    setFollow({ username, follow: !following }).catch(showMutationError);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      className={cn(
        "shrink-0 rounded-full border-2 border-black font-black transition-colors",
        size === "sm" ? "h-8 px-3.5 text-sm" : "h-11 px-6 text-base",
        following ? "bg-white text-black hover:bg-neutral-100" : "bg-black text-white hover:bg-neutral-800",
        className,
      )}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
