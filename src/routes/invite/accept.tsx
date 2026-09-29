import { useConvexAuth, useMutation } from "convex/react";
import { Link, createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PublicFrame } from "~/components/app/public-frame";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

type InviteSearch = { inviteId?: string };

export const Route = createFileRoute("/invite/accept")({
  validateSearch: (search: Record<string, unknown>): InviteSearch => ({
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { inviteId } = useSearch({ from: "/invite/accept" });
  const { isAuthenticated, isLoading } = useConvexAuth();
  const acceptInvite = useMutation(api.invites.acceptInvite);
  const [message, setMessage] = useState("Preparing invite...");

  useEffect(() => {
    if (!inviteId || isLoading || !isAuthenticated) return;
    acceptInvite({ inviteId: inviteId as Id<"invites"> })
      .then((result) => {
        if (result.success) {
          window.location.assign(result.redirectPath);
        } else {
          setMessage(result.error ?? "Could not accept this invite.");
        }
      })
      .catch(() => {
        setMessage(
          "Could not accept this invite. Check the link and try again.",
        );
      });
  }, [acceptInvite, inviteId, isAuthenticated, isLoading]);

  if (!inviteId) {
    return (
      <InviteFrame
        title="Invite missing"
        message="This invite link is incomplete."
      />
    );
  }

  if (!isLoading && !isAuthenticated) {
    return (
      <InviteFrame title="Sign in to accept">
        <Button asChild>
          <Link to="/login" search={{ inviteId, redirect: "/dashboard" }}>
            Sign in
          </Link>
        </Button>
      </InviteFrame>
    );
  }

  return (
    <InviteFrame title="Accepting invite" message={message}>
      {message !== "Preparing invite..." && (
        <Button type="button" onClick={() => window.location.reload()}>
          Try again
        </Button>
      )}
    </InviteFrame>
  );
}

function InviteFrame({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <PublicFrame>
      <Card className="w-full text-center">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {message && <CardDescription>{message}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </PublicFrame>
  );
}
