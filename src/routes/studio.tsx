import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/studio")({
  validateSearch: (search: Record<string, unknown>): { remix?: string } => ({
    remix: typeof search.remix === "string" ? search.remix : undefined,
  }),
  beforeLoad: requireAuthenticatedRoute,
  component: StudioPage,
});

function StudioPage() {
  const viewer = useQuery(convexQuery(api.identity.viewer, {}));
  const me = viewer.data;
  return (
    <main className="min-h-svh bg-white px-6 py-8 text-black md:px-12">
      <header className="flex items-baseline justify-between gap-4">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.25em]">
          CultRemix
        </Link>
        <span className="text-sm font-medium">
          {me?.username ? `@${me.username}` : ""}
          {me ? (me.unlimited ? " · Unlimited" : ` · ${me.credits} credits`) : ""}
        </span>
      </header>
      <h1 className="mt-16 text-7xl font-black tracking-tighter md:text-9xl">Studio</h1>
    </main>
  );
}
