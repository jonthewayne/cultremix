import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { LoadMore } from "./LoadMore";
import type { PagedStatus } from "~/hooks/use-paged-query";

export type MemberCard = FunctionReturnType<typeof api.social.followers>["page"][number];

// People, one row each: picture, name, creator number, bio, and a follow button.
export function MemberList({
  members,
  status,
  loadMore,
  empty,
}: {
  members: Array<MemberCard>;
  status: PagedStatus;
  loadMore: () => void;
  empty: string;
}) {
  if (status === "LoadingFirstPage") return <p className="mt-8 text-neutral-500">Loading…</p>;
  if (members.length === 0 && status === "Exhausted") {
    return <p className="mt-8 text-xl font-semibold text-neutral-500">{empty}</p>;
  }
  return (
    <div className="mt-4">
      <ul className="divide-y-2 divide-neutral-100">
        {members.map((member) => (
          <li key={member.username} className="flex items-center gap-3 py-4 md:gap-5">
            <Link
              to="/u/$username"
              params={{ username: member.username }}
              className="flex min-w-0 flex-1 items-center gap-3 md:gap-5"
            >
              <Avatar username={member.username} image={member.image} className="size-12 md:size-14" />
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-lg font-black leading-tight hover:underline">@{member.username}</span>
                  {member.creatorNumber !== undefined && (
                    <span className="shrink-0 font-cr text-sm tabular-nums text-neutral-500">
                      № {member.creatorNumber}
                    </span>
                  )}
                </span>
                {member.bio && <span className="mt-0.5 block truncate text-neutral-600">{member.bio}</span>}
              </span>
            </Link>
            <FollowButton username={member.username} size="sm" />
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={loadMore} className="mt-10" />
    </div>
  );
}
