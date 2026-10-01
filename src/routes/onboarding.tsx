import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { validateUsername } from "../../convex/lib/username";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: requireAuthenticatedRoute,
  // Loads the starting credits with the page, so the line that mentions them doesn't pop in.
  loader: ({ context }) => context.queryClient.ensureQueryData(convexQuery(api.identity.signupCredits, {})),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const viewer = useQuery(convexQuery(api.identity.viewer, {}));
  const startingCredits = useQuery(convexQuery(api.identity.signupCredits, {})).data;
  const complete = useMutation(api.identity.completeOnboarding);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const destination = sanitizeRedirect(redirect, "/studio");

  // Leaves once the saved name reaches this page's live viewer, so the next page's check already
  // sees it (leaving right after the save could beat that update and bounce back here).
  useEffect(() => {
    if (viewer.data && !viewer.data.needsUsername) {
      router.history.replace(destination);
    }
  }, [viewer.data, destination, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const check = validateUsername(username);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await complete({ username: check.username });
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? (err.data as { message?: string }).message
          : undefined;
      setError(message ?? "Something went wrong. Try again.");
      setSaving(false);
    }
  };

  return (
    <main className="min-h-svh bg-white px-6 py-10 text-black md:px-12">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em]">CultRemix</p>
        <h1 className="mt-16 text-6xl font-black leading-[0.9] tracking-tighter md:text-9xl">
          Pick your name.
        </h1>
        <p className="mt-8 max-w-md text-lg leading-snug">
          It goes on every design you publish.
          {startingCredits ? ` You start with ${startingCredits} credits, one per design.` : ""}
        </p>
        <form onSubmit={submit} className="mt-14 flex flex-col gap-6 md:flex-row md:items-end">
          <label className="flex-1">
            <span className="sr-only">Username</span>
            <span className="flex items-baseline border-b-4 border-black">
              <span className="text-4xl font-black md:text-6xl">@</span>
              <input
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full bg-transparent py-2 text-4xl font-black tracking-tight outline-none placeholder:text-neutral-300 md:text-6xl"
                placeholder="yourname"
                maxLength={21}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="h-16 rounded-2xl bg-black px-10 text-lg font-bold text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-5 text-base font-semibold text-red-600">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
