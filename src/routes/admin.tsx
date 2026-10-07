import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/app/app-shell";
import { isSuperAdminRole, useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · CultRemix" }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: AdminLayout,
});

const tabs = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/members", label: "Members", exact: false },
  { to: "/admin/metrics", label: "Metrics", exact: false },
  { to: "/admin/judges", label: "Judges", exact: false },
  { to: "/admin/lineage", label: "Lineage", exact: false },
  { to: "/admin/products", label: "Products", exact: false },
  { to: "/admin/waitlist", label: "Waitlist", exact: false },
] as const;

function AdminLayout() {
  const user = useCurrentUser();
  const isAdmin = isSuperAdminRole(user?.platformRole);

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl space-y-4 py-10">
          <h1 className="text-4xl font-black tracking-tight">Not for you, sorry</h1>
          <p className="text-muted-foreground">This area is for the CultRemix team.</p>
          <Link to="/studio" className="inline-block font-bold underline underline-offset-4">
            Back to the studio
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-4xl font-black tracking-tight md:text-5xl">Admin</h1>
        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.exact }}
              className="shrink-0 rounded-full border-2 border-border px-4 py-2 text-sm font-bold"
              activeProps={{ className: "border-foreground bg-foreground text-background" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <Outlet />
      </div>
    </AppShell>
  );
}
