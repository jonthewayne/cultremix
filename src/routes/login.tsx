import {
  Link,
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Mail, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { PublicFrame } from "~/components/app/public-frame";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { getPreauthClient } from "~/lib/convex-preauth";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

type LoginSearch = {
  redirect?: string;
  inviteId?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo, inviteId } = useSearch({ from: "/login" });
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [emailDelivered, setEmailDelivered] = useState(true);
  const [instantSignIn, setInstantSignIn] = useState(false);

  useEffect(() => {
    let active = true;
    getPreauthClient()
      .query(api.auth.getAuthFeatureFlags, {})
      .then((flags) => {
        if (active) {
          setPhoneEnabled(flags.phoneEnabled);
          setEmailDelivered(flags.emailDelivered);
          setInstantSignIn(flags.instantSignIn);
        }
      })
      .catch(() => {
        // Email sign-in remains available if feature flags cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, []);

  const destination = sanitizeRedirect(redirectTo);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.includes("@")) {
        setError("Enter a valid email address.");
        return;
      }

      const attemptId = await getPreauthClient().mutation(
        api.authVerification.createEmailAuthAttempt,
        {
          email: normalizedEmail,
          redirect: destination,
          source: inviteId ? "invite" : "login",
          inviteId: inviteId as any,
        },
      );

      try {
        await authClient.signIn.magicLink({
          email: normalizedEmail,
          callbackURL: `/auth/complete?attemptId=${attemptId}&redirect=${encodeURIComponent(destination)}${inviteId ? `&inviteId=${inviteId}` : ""}`,
        });
      } catch {
        // OTP still works when optional magic link storage fails.
      }

      const result = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: "sign-in",
      });
      if (result.error) {
        setError(result.error.message ?? "Could not send a code.");
        return;
      }

      navigate({
        to: "/verify-email",
        search: {
          email: normalizedEmail,
          attemptId,
          redirect: destination,
          inviteId,
        },
      });
    } catch (err) {
      setError(readableAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const attemptId = await getPreauthClient().mutation(
        api.phoneVerification.createPhoneAuthAttempt,
        { phone, redirect: destination, source: "login" },
      );
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber: phone,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not send a code.");
        return;
      }
      navigate({
        to: "/verify-phone",
        search: { phone, attemptId, redirect: destination },
      });
    } catch (err) {
      setError(readableAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicFrame>
      <Card className="w-full border-0 bg-transparent shadow-none">
        <CardHeader className="p-0">
          <CardTitle className="text-6xl font-black leading-[0.9] tracking-tighter md:text-8xl">Sign in</CardTitle>
          <CardDescription className="mt-4 text-lg text-neutral-600">
            {phoneEnabled
              ? "Use an email code or phone code."
              : instantSignIn
                ? "Enter your email to sign in."
                : emailDelivered
                  ? "We’ll email you a 6-digit code."
                  : "Sign in with a 6-digit code."}
          </CardDescription>
          {instantSignIn ? (
            <p className="mt-6 rounded-2xl bg-neutral-100 p-4 text-base">
              <span className="font-bold">Early access.</span> Just enter your email and you’re in. No code needed
              while email is off.
            </p>
          ) : !emailDelivered ? (
            <p className="mt-6 rounded-2xl bg-neutral-100 p-4 text-base">
              <span className="font-bold">Early access.</span> Sign-in codes aren’t emailed yet, so sign-in is open to
              the CultRemix team for now. Everyone can browse the feed and shop pages.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="mt-10 p-0">
          {phoneEnabled && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === "email" ? "default" : "outline"}
                onClick={() => setMode("email")}
              >
                <Mail className="size-4" />
                Email
              </Button>
              <Button
                type="button"
                variant={mode === "phone" ? "default" : "outline"}
                onClick={() => setMode("phone")}
              >
                <Phone className="size-4" />
                Phone
              </Button>
            </div>
          )}

          {mode === "email" ? (
            <form className="space-y-4" onSubmit={submitEmail}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="h-14 rounded-xl border-2 border-black px-4 text-lg"
                  required
                />
              </div>
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <Button className="h-14 w-full rounded-2xl bg-black text-lg font-black text-white hover:bg-neutral-800" type="submit" disabled={loading}>
                {loading ? "Sending…" : instantSignIn ? "Sign in" : emailDelivered ? "Email me a code" : "Get a code"}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={submitPhone}>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555 555 1234"
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Sending..." : "Continue"}
              </Button>
            </form>
          )}

          <p className="mt-5 text-center text-xs text-muted-foreground">
            <Link to="/" className="underline underline-offset-4">
              Back to app
            </Link>
          </p>
        </CardContent>
      </Card>
    </PublicFrame>
  );
}

function readableAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Too many attempts")) return message;
  if (message.includes("Phone authentication is not enabled")) {
    return "Phone sign-in is not enabled for this environment.";
  }
  return "Something went wrong. Try again.";
}
