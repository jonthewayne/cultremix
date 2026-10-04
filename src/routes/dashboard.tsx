import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Boxes, Building2, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "~/components/app/app-shell";
import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

const organizationsQuery = convexQuery(api.organizations.listMine, {});
const resourcesQuery = convexQuery(api.resources.listMine, {});

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · CultRemix" }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: DashboardPage,
});

function DashboardPage() {
  const user = useCurrentUser();
  const organizations = useQuery({ ...organizationsQuery });
  const resources = useQuery({ ...resourcesQuery });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={user?.email ?? "Your authenticated starter workspace."}
        />

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            icon={Building2}
            label="Organizations"
            value={organizations.data?.length ?? 0}
          />
          <MetricCard
            icon={Boxes}
            label="Resources"
            value={resources.data?.length ?? 0}
          />
          <MetricCard
            icon={UsersRound}
            label="Role"
            value={user?.platformRole ?? "user"}
          />
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              Create your first scoped organization or resource, then invite members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-3">
              <Button asChild variant="outline">
                <Link to="/team">Manage team</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/settings">Profile settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-card to-muted/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
          <Icon className="size-4 text-muted-foreground" />
        </span>
      </CardHeader>
      <CardContent>
        <div className="truncate text-3xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
