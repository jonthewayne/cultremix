import { useMutation } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
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
          {viewer?.creatorNumber ? <Row label="Creator" value={`№ ${viewer.creatorNumber}`} /> : null}
        </dl>
        {viewer?.username && <BioEditor username={viewer.username} />}
        {(isOwner || viewer?.canClaimOwner || message) && (
          <section className="mt-12">
            <h2 className="text-2xl font-black tracking-tight">Owner</h2>
            {isOwner ? (
              <p className="mt-3 text-lg">This account owns CultRemix and is Creator № 1.</p>
            ) : viewer?.canClaimOwner ? (
              <>
                <p className="mt-3 max-w-xl text-neutral-600">
                  This account can claim the owner role and Creator № 1. It works once.
                </p>
                <button
                  type="button"
                  onClick={() => void runBootstrap()}
                  className="mt-5 h-14 rounded-2xl bg-black px-8 text-lg font-black text-white hover:bg-neutral-800"
                >
                  Claim ownership
                </button>
              </>
            ) : null}
            {message && <p className="mt-4 font-semibold">{message}</p>}
          </section>
        )}
      </main>
    </div>
  );
}

const BIO_MAX = 160;

function BioEditor({ username }: { username: string }) {
  const profile = useQuery(convexQuery(api.social.profile, { username })).data;
  const setBio = useMutation(api.social.setBio);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = profile?.bio ?? "";
  const value = draft ?? saved;

  useEffect(() => {
    if (status?.tone !== "ok") return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const save = async () => {
    setSaving(true);
    try {
      const bio = await setBio({ bio: value });
      setDraft(null);
      setStatus({ tone: "ok", text: bio ? "Saved." : "Bio cleared." });
    } catch (err) {
      const message = err instanceof ConvexError ? (err.data as { message?: string }).message : undefined;
      setStatus({ tone: "error", text: message ?? "That didn’t save. Try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-black tracking-tight">Profile</h2>
        <Link to="/u/$username" params={{ username }} className="font-bold underline underline-offset-4">
          View profile
        </Link>
      </div>
      <label htmlFor="bio" className="mt-5 block text-sm font-bold uppercase tracking-wider">
        Bio
      </label>
      <textarea
        id="bio"
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        maxLength={BIO_MAX + 40}
        placeholder="A line about you and what you make."
        className="mt-2 w-full resize-none rounded-2xl border-2 border-black px-4 py-3 text-lg outline-none focus-visible:ring-4 focus-visible:ring-black/15"
      />
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || profile === undefined || value === saved || value.trim().length > BIO_MAX}
          className="h-12 rounded-2xl bg-black px-7 font-black text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
        >
          {saving ? "Saving…" : "Save bio"}
        </button>
        <span className={value.trim().length > BIO_MAX ? "text-sm font-bold text-red-600" : "text-sm text-neutral-500"}>
          {value.trim().length}/{BIO_MAX}
        </span>
        {status && (
          <span role="status" className={status.tone === "error" ? "font-semibold text-red-600" : "font-semibold"}>
            {status.text}
          </span>
        )}
      </div>
    </section>
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
