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
import { markEmailAttemptVerified } from "~/lib/mark-email-attempt-verified";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

type VerifyEmailSearch = {
  email: string;
  attemptId?: string;
  redirect?: string;
  inviteId?: string;
};

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    email: typeof search.email === "string" ? search.email : "",
    attemptId: typeof search.attemptId === "string" ? search.attemptId : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { email, attemptId, redirect: redirectTo, inviteId } = useSearch({
    from: "/verify-email",
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Early access: the code is filled in and submitted for you (AUTH_INSTANT_SIGNIN).
  const [instant, setInstant] = useState(false);
  const [manual, setManual] = useState(false);
  const submittedRef = useRef(false);
  const expiresAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!attemptId) return;
    return getPreauthClient().onUpdate(
      api.authVerification.getEmailAuthAttemptStatus,
      { attemptId: attemptId as Id<"authVerificationAttempts"> },
      (result) => {
        expiresAtRef.current = result?.expiresAtMs ?? null;
        if (result?.status === "verified") {
          window.location.assign(destinationFor(redirectTo, inviteId));
        }
      },
    );
  }, [attemptId, inviteId, redirectTo]);

  useEffect(() => {
    let active = true;
    getPreauthClient()
      .query(api.auth.getAuthFeatureFlags, {})
      .then((flags) => {
        if (active) setInstant(flags.instantSignIn);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const submitCode = async (value: string) => {
    setError("");
    setLoading(true);

    try {
      if (expiresAtRef.current && Date.now() > expiresAtRef.current) {
        setError("This code has expired. Send a new one from the login screen.");
        setManual(true);
        return;
      }
      const result = await authClient.signIn.emailOtp({ email, otp: value });
      if (result.error) {
        setError("Invalid code.");
        setManual(true);
        return;
      }
      if (attemptId) {
        try {
          await markEmailAttemptVerified(
            attemptId as Id<"authVerificationAttempts">,
          );
        } catch {
          // The current-device session is valid; this only updates cross-device status.
        }
      }
      window.location.assign(destinationFor(redirectTo, inviteId));
    } catch {
      setError("Could not verify this code.");
      setManual(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!instant || !attemptId) return;
    // The owner and admins get no instant code; show the code box after a moment.
    const timer = window.setTimeout(() => setManual(true), 8000);
    const unsubscribe = getPreauthClient().onUpdate(
      api.authVerification.instantSignInCode,
      { attemptId: attemptId as Id<"authVerificationAttempts"> },
      (value) => {
        if (!value || submittedRef.current) return;
        if ("manual" in value) {
          window.clearTimeout(timer);
          setManual(true);
          return;
        }
        submittedRef.current = true;
        window.clearTimeout(timer);
        setCode(value.code);
        void submitCode(value.code);
      },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
    // submitCode reads only values from the URL, which do not change on this page.
  }, [instant, attemptId]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitCode(code);
  };

  const automatic = instant && !manual;

  return (
    <PublicFrame>
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader className="p-0">
          <CardTitle className="text-6xl font-black leading-[0.9] tracking-tighter md:text-8xl">
            {automatic ? "Signing you in" : "Check your email"}
          </CardTitle>
          <CardDescription className="mt-4 text-lg text-neutral-600">
            {automatic ? `One moment, ${email}.` : `Enter the 6-digit code for ${email}.`}
          </CardDescription>
        </CardHeader>
        {!automatic && (
          <CardContent className="mt-10 p-0">
            <form className="space-y-4" onSubmit={verify}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="font-cr h-20 rounded-xl border-2 border-black text-center text-4xl tracking-[0.4em]"
                autoFocus
                required
              />
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <Button className="h-14 w-full rounded-2xl bg-black text-lg font-black text-white hover:bg-neutral-800" type="submit" disabled={loading || code.length !== 6}>
                {loading ? "Checking…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </PublicFrame>
  );
}

function destinationFor(redirectTo?: string, inviteId?: string) {
  return inviteId
    ? `/invite/accept?inviteId=${encodeURIComponent(inviteId)}`
    : sanitizeRedirect(redirectTo);
}
