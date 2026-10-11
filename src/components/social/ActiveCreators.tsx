import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { LoadMore } from "./LoadMore";
import { usePagedQuery } from "~/hooks/use-paged-query";

export const ACTIVE_CREATORS_PAGE_SIZE = 8;

// "Who's making things": creators who published lately, newest first, in a row that scrolls
// sideways and loads more as its end comes into view.
export function ActiveCreators() {
  const { items, status, loadMore } = usePagedQuery(api.social.activeCreators, {}, ACTIVE_CREATORS_PAGE_SIZE);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="active-creators" className="mt-20">
      <h2 id="active-creators" className="text-2xl font-black tracking-tight md:text-3xl">
        Who’s making things
      </h2>
      <ul className="-mx-4 mt-5 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:-mx-10 md:scroll-px-10 md:px-10">
        {items.map((member) => (
          <li
            key={member.username}
            className="flex w-40 shrink-0 snap-start flex-col items-center rounded-2xl border-2 border-black p-4 text-center"
          >
            <Link
              to="/u/$username"
              params={{ username: member.username }}
              className="flex w-full min-w-0 flex-col items-center"
            >
              <Avatar username={member.username} image={member.image} className="size-16" />
              <span className="mt-3 w-full truncate font-black hover:underline">@{member.username}</span>
              <span className="font-cr text-sm tabular-nums text-neutral-500">
                {member.creatorNumber === undefined ? " " : `№ ${member.creatorNumber}`}
              </span>
            </Link>
            <FollowButton username={member.username} size="sm" className="mt-3" ownLabel="You" />
          </li>
        ))}
        {status !== "Exhausted" && (
          <li className="flex shrink-0 items-center">
            <LoadMore status={status} loadMore={loadMore} />
          </li>
        )}
      </ul>
    </section>
  );
}
