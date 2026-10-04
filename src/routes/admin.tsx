import { useMutation, useQuery } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { canGrantPlatformRole, hasCapability } from "../../convex/lib/authz";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell } from "~/components/app/app-shell";
import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { isSuperAdminRole, useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/admin")({
  beforeLoad: requireAuthenticatedRoute,
  component: AdminPage,
});

function AdminPage() {
  const user = useCurrentUser();
  const isAdmin = isSuperAdminRole(user?.platformRole);
  const users = useQuery(api.auth.listUsers, isAdmin ? {} : "skip");
  const updateRole = useMutation(api.auth.updatePlatformRole);

  if (!isAdmin) {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle>Unauthorized</CardTitle>
            <CardDescription>
              You do not have access to this area.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/studio">Back to the studio</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Admin"
          description="Platform users and DB-authoritative roles."
        />
        {(user.platformRole === "super_admin_owner" ||
          user.platformRole === "super_admin_ops") && (
          <Button asChild variant="outline">
            <Link to="/admin/lineage">Lineage corrections</Link>
          </Button>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              Roles are stored in Convex app tables.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(users ?? []).map((row: any) => (
              <div
                key={row._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {row.email ?? "No email"}
                  </div>
                  <div className="text-muted-foreground">
                    {row.platformRole ?? "user"}
                  </div>
                </div>
                {hasCapability(user.platformRole ?? "user", "users:invite") &&
                  canGrantPlatformRole(
                    user.platformRole ?? "user",
                    row.platformRole ?? "user",
                  ) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateRole({
                          userId: row._id as Id<"users">,
                          role:
                            row.platformRole === "super_admin_support"
                              ? "user"
                              : "super_admin_support",
                        })
                      }
                    >
                      Toggle support
                    </Button>
                  )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
