import { useMutation } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "~/components/app/app-shell";
import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/settings")({
  beforeLoad: requireAuthenticatedRoute,
  component: SettingsPage,
});

function SettingsPage() {
  const user = useCurrentUser();
  const bootstrap = useMutation(api.auth.bootstrapFirstSuperAdmin);
  const [message, setMessage] = useState("");

  const runBootstrap = async () => {
    const result = await bootstrap({});
    setMessage(result.changed ? "Super admin enabled." : result.reason ?? "No change.");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title="Settings" description="Profile and bootstrap controls." />

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your app user record is synced from Better Auth.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Info label="Email" value={user?.email ?? "Not set"} />
            <Info label="Phone" value={user?.phone ?? "Not set"} />
            <Info label="Platform role" value={user?.platformRole ?? "user"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>First super admin</CardTitle>
            <CardDescription>
              Uses FIRST_SUPER_ADMIN_EMAIL and only works before an owner exists.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={runBootstrap}>Bootstrap my account</Button>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  );
}
