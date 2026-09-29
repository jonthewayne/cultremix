import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";

export function SiteHeader() {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-4 md:px-10 md:py-6">
      <Link to="/" className="text-base font-black uppercase tracking-[0.2em] md:text-lg">
        CultRemix
      </Link>
      <nav className="flex items-center gap-4 text-sm font-semibold md:gap-7">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "underline decoration-2 underline-offset-8" }}>
          Feed
        </Link>
        <Link to="/studio" activeProps={{ className: "underline decoration-2 underline-offset-8" }}>
          Studio
        </Link>
        {viewer ? (
          <Link to="/settings" className="hidden tabular-nums sm:inline">
            {viewer.username ? `@${viewer.username}` : "You"} · {viewer.unlimited ? "Unlimited" : `${viewer.credits} credits`}
          </Link>
        ) : (
          <Link to="/login" search={{ redirect: "/studio" }}>
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
