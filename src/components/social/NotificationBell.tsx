import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { api } from "../../../convex/_generated/api";

// The header's bell, for members: a count of what's new, and the way to the list.
export function NotificationBell() {
  const unread = useQuery(convexQuery(api.notifications.status, {})).data?.unread ?? 0;
  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-black hover:bg-neutral-100"
      activeProps={{ className: "bg-black text-white hover:bg-black" }}
    >
      <Bell aria-hidden className="size-4" strokeWidth={2.5} />
      {unread > 0 && (
        <span className="absolute -right-2 -top-2 h-5 min-w-5 rounded-full border-2 border-white bg-black px-1 text-center text-[10px] font-black leading-4 text-white tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
