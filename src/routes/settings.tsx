import { useMutation } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { useCurrentUser } from "~/hooks/use-auth";
import { requireAuthenticatedRoute } from "~/lib/route-guards";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/settings")({
  beforeLoad: requireAuthenticatedRoute,
  component: SettingsPage,
});

function SettingsPage() {
  const user = useCurrentUser();
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const bootstrap = useMutation(api.auth.bootstrapFirstSuperAdmin);
  const [message, setMessage] = useState("");
  const isOwner = user?.platformRole === "super_admin_owner";

  const runBootstrap = async () => {
    const result = await bootstrap({});
    setMessage(result.changed ? "You’re the owner and Creator № 1." : (result.reason ?? "No change."));
  };

  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="max-w-3xl px-4 pb-24 md:px-10">
        <h1 className="pt-6 text-[16vw] font-black leading-[0.8] tracking-[-0.06em] md:pt-10 md:text-[8vw]">Settings</h1>
        <dl className="mt-12 divide-y-2 divide-black border-y-2 border-black text-lg">
          <Row label="Username" value={viewer?.username ? `@${viewer.username}` : "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row label="Credits" value={viewer ? (viewer.unlimited ? "Unlimited" : String(viewer.credits)) : "—"} />
          <Row label="Creator" value={viewer?.creatorNumber ? `№ ${viewer.creatorNumber}` : "—"} />
        </dl>
        <section className="mt-12">
          <h2 className="text-2xl font-black tracking-tight">Owner</h2>
          {isOwner ? (
            <p className="mt-3 text-lg">This account owns CultRemix and is Creator № 1.</p>
          ) : (
            <>
              <p className="mt-3 max-w-xl text-neutral-600">
                Claims the owner role and Creator № 1 for the address set in FIRST_SUPER_ADMIN_EMAIL. It works once.
              </p>
              <button
                type="button"
                onClick={() => void runBootstrap()}
                className="mt-5 h-14 rounded-2xl bg-black px-8 text-lg font-black text-white hover:bg-neutral-800"
              >
                Bootstrap my account
              </button>
            </>
          )}
          {message && <p className="mt-4 font-semibold">{message}</p>}
        </section>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-4">
      <dt className="text-sm font-bold uppercase tracking-wider">{label}</dt>
      <dd className="min-w-0 truncate font-semibold">{value}</dd>
    </div>
  );
}
