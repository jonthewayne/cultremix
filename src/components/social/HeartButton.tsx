import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { Heart } from "lucide-react";
import { motion } from "motion/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { showMutationError, useMemberAction } from "./useSignIn";
import { cn } from "~/lib/utils";

// A heart and its count. Fills at once; the server's answer settles it.
export function HeartButton({
  workId,
  count: initialCount,
  size = "md",
  className,
}: {
  workId: Id<"works">;
  count?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const { signedIn, signIn } = useMemberAction();
  const state = useQuery(convexQuery(api.social.heartState, { workId })).data;
  const setHeart = useMutation(api.social.setHeart).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.social.heartState, { workId: args.workId });
    if (!current || current.hearted === args.heart) return;
    store.setQuery(
      api.social.heartState,
      { workId: args.workId },
      { hearted: args.heart, count: Math.max(0, current.count + (args.heart ? 1 : -1)) },
    );
  });

  const hearted = state?.hearted === true;
  const count = state?.count ?? initialCount ?? 0;
  const onClick = () => {
    if (signedIn === undefined) return;
    if (!signedIn) return signIn();
    setHeart({ workId, heart: !hearted }).catch(showMutationError);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={hearted}
      aria-label={hearted ? "Remove heart" : "Heart this design"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-black font-black tabular-nums transition-colors hover:bg-neutral-100",
        size === "sm" ? "h-10 px-3.5 text-sm" : "h-11 px-4 text-base",
        className,
      )}
    >
      <motion.span
        key={hearted ? "on" : "off"}
        initial={hearted ? { scale: 0.6 } : false}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
        className="flex"
      >
        <Heart
          aria-hidden
          className={size === "sm" ? "size-4" : "size-5"}
          strokeWidth={2.5}
          fill={hearted ? "currentColor" : "none"}
          color={hearted ? "#e11d48" : "currentColor"}
        />
      </motion.span>
      <span>{count}</span>
    </button>
  );
}
