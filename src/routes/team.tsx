import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "~/components/app/app-shell";
import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isSuperAdminRole, useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";

export const Route = createFileRoute("/team")({
  head: () => ({ meta: [{ title: "Team · CultRemix" }] }),
  beforeLoad: requireAuthenticatedRoute,
  component: TeamPage,
});

function TeamPage() {
  const user = useCurrentUser();
  const invites = useQuery(
    api.invites.listPendingInvites,
    isSuperAdminRole(user?.platformRole) ? {} : "skip",
  );
  const createInvite = useMutation(api.invites.createInvite);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const inviteSupportAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    await createInvite({
      inviteType: "platform_admin",
      email,
      grants: [{ scopeType: "platform", role: "super_admin_support" }],
    });
    setEmail("");
    setMessage("Invite sent.");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title="Team" description="Members and invite workflows." />

        {isSuperAdminRole(user?.platformRole) ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardHeader>
                <CardTitle>Pending invites</CardTitle>
                <CardDescription>Invites are accepted through magic links.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(invites ?? []).map((invite: any) => (
                    <div
                      key={invite._id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <span className="truncate">{invite.email}</span>
                      <span className="text-muted-foreground">{invite.inviteType}</span>
                    </div>
                  ))}
                  {invites?.length === 0 && (
                    <p className="text-sm text-muted-foreground">No pending invites.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invite admin</CardTitle>
                <CardDescription>Create a support admin invite.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={inviteSupportAdmin}>
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      required
                    />
                  </div>
                  <Button className="w-full" type="submit">Send invite</Button>
                  {message && <p className="text-sm text-muted-foreground">{message}</p>}
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Team access</CardTitle>
              <CardDescription>
                Organization admins can extend this route for scoped team management.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
