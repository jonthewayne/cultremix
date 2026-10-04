import { Link, createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
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
  head: () => ({ meta: [{ title: "Check your email · CultRemix" }] }),
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    email: typeof search.email === "string" ? search.email : "",
    attemptId: typeof search.attemptId === "string" ? search.attemptId : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
  }),
  component: VerifyEmailPage,
});

const RESEND_WAIT_SECONDS = 30;

function VerifyEmailPage() {
  const { email, attemptId, redirect: redirectTo, inviteId } = useSearch({
    from: "/verify-email",
  });
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [wait, setWait] = useState(RESEND_WAIT_SECONDS);
  const [emailDelivered, setEmailDelivered] = useState(true);
  const expiresAtRef = useRef<number | null>(null);
  // The last code submitted on its own, so a failed code isn't retried in a loop.
  const autoSubmittedRef = useRef<string | null>(null);

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
        if (active) setEmailDelivered(flags.emailDelivered);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const submitCode = async (otp: string) => {
    setError("");
    setNotice("");
    setLoading(true);

    try {
      if (expiresAtRef.current && Date.now() > expiresAtRef.current) {
        setError("This code has expired. Send a new one below.");
        return;
      }
      const result = await authClient.signIn.emailOtp({ email, otp });
      if (result.error) {
        setError("That code didn’t work. Check the newest email, or send a new code.");
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
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitCode(code);
  };

  // Six digits (pasted, typed, or filled in from a phone's code suggestion) submit on their own.
  const onCodeChange = (value: string) => {
    const next = value.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length === 6 && !loading && autoSubmittedRef.current !== next) {
      autoSubmittedRef.current = next;
      void submitCode(next);
    }
  };

  // A new code starts a new attempt, exactly like the sign-in page, so the
  // 10-minute window restarts. Only the newest code works.
  const sendNewCode = async () => {
    setError("");
    setNotice("");
    setResending(true);
    try {
      const destination = sanitizeRedirect(redirectTo);
      const newAttemptId = await getPreauthClient().mutation(
        api.authVerification.createEmailAuthAttempt,
        {
          email,
          redirect: destination,
          source: inviteId ? "invite" : "login",
          inviteId: inviteId as Id<"invites"> | undefined,
        },
      );
      const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) {
        setError(result.error.message ?? "Could not send a new code.");
        return;
      }
      setCode("");
      setWait(RESEND_WAIT_SECONDS);
      setNotice("New code sent. Only the newest code works.");
      await navigate({
        to: "/verify-email",
        search: { email, attemptId: newAttemptId, redirect: destination, inviteId },
        replace: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.includes("Too many attempts")
          ? "Too many codes requested. Wait a few minutes, then try again."
          : "Could not send a new code. Try again in a minute.",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <PublicFrame>
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader className="p-0">
          <CardTitle className="text-6xl font-black leading-[0.9] tracking-tighter md:text-8xl">Check your email</CardTitle>
          <CardDescription className="mt-4 text-lg text-neutral-600">
            {emailDelivered
              ? `We sent a 6-digit code to ${email}. It works for 10 minutes.`
              : `Enter the 6-digit code for ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-10 p-0">
          <form className="space-y-4" onSubmit={verify}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              className="font-cr h-20 rounded-xl border-2 border-black text-center text-4xl tracking-[0.4em]"
              aria-label="6-digit code"
              autoFocus
              required
            />
            {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
            {notice && !error && <p className="text-sm font-semibold">{notice}</p>}
            <Button
              className="h-14 w-full rounded-2xl bg-black text-lg font-black text-white hover:bg-neutral-800"
              type="submit"
              disabled={loading || code.length !== 6}
            >
              {loading ? "Checking…" : "Sign in"}
            </Button>
          </form>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold">
            <button
              type="button"
              onClick={() => void sendNewCode()}
              disabled={resending || wait > 0}
              className="underline underline-offset-4 disabled:no-underline disabled:opacity-50"
            >
              {resending ? "Sending…" : wait > 0 ? `Send a new code in ${wait} s` : "Send a new code"}
            </button>
            <Link to="/login" search={{ redirect: redirectTo, inviteId }} className="underline underline-offset-4">
              Use a different email
            </Link>
          </div>
        </CardContent>
      </Card>
    </PublicFrame>
  );
}

function destinationFor(redirectTo?: string, inviteId?: string) {
  return inviteId
    ? `/invite/accept?inviteId=${encodeURIComponent(inviteId)}`
    : sanitizeRedirect(redirectTo);
}
