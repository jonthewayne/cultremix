import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PublicFrame } from "~/components/app/public-frame";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";
import { getPreauthClient } from "~/lib/convex-preauth";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

type VerifyPhoneSearch = {
  phone: string;
  attemptId?: string;
  redirect?: string;
};

export const Route = createFileRoute("/verify-phone")({
  validateSearch: (search: Record<string, unknown>): VerifyPhoneSearch => ({
    phone: typeof search.phone === "string" ? search.phone : "",
    attemptId: typeof search.attemptId === "string" ? search.attemptId : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: VerifyPhonePage,
});

function VerifyPhonePage() {
  const { phone, attemptId, redirect: redirectTo } = useSearch({
    from: "/verify-phone",
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const expiresAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!attemptId) return;
    return getPreauthClient().onUpdate(
      api.phoneVerification.getPhoneAuthAttemptStatus,
      { attemptId: attemptId as Id<"phoneVerificationAttempts"> },
      (result) => {
        expiresAtRef.current = result?.expiresAtMs ?? null;
        if (result?.status === "verified" && result.crossDeviceMagicLinkUrl) {
          window.location.assign(result.crossDeviceMagicLinkUrl);
        }
        if (result?.status === "failed") {
          setError(
            result.failureReason === "opted_out"
              ? "SMS is blocked for this number. Text START to re-enable it."
              : "Could not deliver this code.",
          );
        }
      },
    );
  }, [attemptId]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (expiresAtRef.current && Date.now() > expiresAtRef.current) {
        setError("This code has expired.");
        return;
      }
      const result = await authClient.phoneNumber.verify({
        phoneNumber: phone,
        code,
      });
      if (result.error) {
        setError("Invalid code.");
        return;
      }
      window.location.assign(sanitizeRedirect(redirectTo));
    } catch {
      setError("Could not verify this code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicFrame>
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle>Check your phone</CardTitle>
          <CardDescription>Enter the code sent to {phone}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={verify}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="h-12 text-center text-xl tracking-[0.5em]"
              autoFocus
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" type="submit" disabled={loading || code.length !== 6}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PublicFrame>
  );
}
