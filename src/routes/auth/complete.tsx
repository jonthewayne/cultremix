import { Link, createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PublicFrame } from "~/components/app/public-frame";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/auth-client";
import { getPreauthClient } from "~/lib/convex-preauth";
import { markEmailAttemptVerified } from "~/lib/mark-email-attempt-verified";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

type CompleteSearch = {
  attemptId?: string;
  redirect?: string;
  inviteId?: string;
  error?: string;
};

export const Route = createFileRoute("/auth/complete")({
  validateSearch: (search: Record<string, unknown>): CompleteSearch => ({
    attemptId: typeof search.attemptId === "string" ? search.attemptId : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: AuthCompletePage,
});

function AuthCompletePage() {
  const { attemptId, redirect: redirectTo, inviteId, error } = useSearch({
    from: "/auth/complete",
  });
  const [status, setStatus] = useState<"processing" | "used" | "error">(
    "processing",
  );
  const destination = inviteId
    ? `/invite/accept?inviteId=${encodeURIComponent(inviteId)}`
    : sanitizeRedirect(redirectTo);

  useEffect(() => {
    if (error) {
      authClient.getSession().then((session) => {
        if (session.data?.session) {
          window.location.assign(destination);
        } else {
          setStatus("used");
        }
      });
      return;
    }

    const complete = async () => {
      try {
        if (attemptId) {
          try {
            await markEmailAttemptVerified(
              attemptId as Id<"authVerificationAttempts">,
            );
          } catch {
            // The magic link already authenticated this device; this is cross-device status only.
          }
        }
        window.location.assign(destination);
      } catch {
        setStatus("error");
      }
    };
    complete();
  }, [attemptId, destination, error]);

  return (
    <PublicFrame>
      <Card className="w-full text-center">
        <CardHeader>
          <CardTitle>
            {status === "used"
              ? "This link has already been used"
              : status === "error"
                ? "Sign-in could not finish"
                : "Completing sign-in"}
          </CardTitle>
          <CardDescription>
            {status === "processing"
              ? "Please wait while your session is prepared."
              : "Request a fresh code to continue."}
          </CardDescription>
        </CardHeader>
        {status !== "processing" && (
          <CardContent>
            <Button asChild>
              <Link to="/login" search={{ redirect: destination }}>
                Back to sign in
              </Link>
            </Button>
          </CardContent>
        )}
      </Card>
    </PublicFrame>
  );
}
