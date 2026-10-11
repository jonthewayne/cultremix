import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { AdminFrame } from "~/components/admin/AdminFrame";
import { AppShell } from "~/components/app/app-shell";
import { isSuperAdminRole, useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · CultRemix" }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: AdminLayout,
});

function AdminLayout() {
  const user = useCurrentUser();
  const isAdmin = isSuperAdminRole(user?.platformRole);

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="max-w-xl space-y-4 py-10">
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
    <AdminFrame>
      <Outlet />
    </AdminFrame>
  );
}
