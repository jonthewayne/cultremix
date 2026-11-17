import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { SiteFooter } from "~/components/cr/SiteFooter";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { errorMessage } from "~/lib/imagePrep";
import { formatCents } from "~/lib/money";
import { pageMeta } from "~/lib/share";

// /artist/<slug>: an outside artist designs credit as an inspiration (convex/artists.ts). It lists
// the designs that credit them and what's been set aside for them, and the artist claims it here.
export const Route = createFileRoute("/artist/$slug")({
  head: ({ params }) => ({
    meta: pageMeta("Artist", `/artist/${params.slug}`, "An artist whose style inspired designs on CultRemix, credited with a share of each sale."),
  }),
  component: ArtistPage,
});

const linkClass = "font-bold underline underline-offset-4";

function host(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./u, "") + new URL(link).pathname.replace(/\/$/u, "");
  } catch {
    return link;
  }
}

function ArtistPage() {
  const { slug } = Route.useParams();
  const data = useQuery(convexQuery(api.artists.page, { slug })).data;
  if (data === undefined) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="px-4 pb-24 md:px-10" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-svh bg-white text-black">
        <SiteHeader />
        <main className="max-w-3xl px-4 pb-24 md:px-10">
          <h1 className="pt-8 text-5xl font-black tracking-tight">No artist here</h1>
          <p className="mt-4 text-lg">
            <Link to="/" className={linkClass}>
              Back to the feed
            </Link>
          </p>
        </main>
        <SiteFooter />
      </div>
    );
  }
  return (
    <div className="min-h-svh bg-white text-black">
      <SiteHeader />
      <main className="max-w-5xl px-4 pb-24 md:px-10">
        <p className="pt-8 text-sm font-bold uppercase tracking-wider">Artist</p>
        <h1 className="mt-2 text-5xl font-black leading-none tracking-tight md:text-7xl">{data.name}</h1>
        <p className="mt-4 text-lg">
          {data.links.map((link, i) => (
            <span key={link}>
              {i > 0 && " · "}
              <a href={link} target="_blank" rel="noreferrer nofollow" className={linkClass}>
                {host(link)}
              </a>
            </span>
          ))}
        </p>
        <p className="mt-4 max-w-prose text-lg leading-snug">
          {data.status === "claimed"
            ? `Designs on CultRemix credit ${data.name} as an inspiration, and ${data.name} gets a share of each sale${data.claimedBy ? ` as @${data.claimedBy}` : ""}.`
            : data.status === "declined"
              ? `${data.name} has turned this credit down.`
              : `Creators on CultRemix credit ${data.name} as an inspiration. A share of each sale of these designs is set aside for ${data.name}, waiting to be claimed.`}
        </p>
        {data.status === "unclaimed" && (
          <p className="mt-4 text-2xl font-black">
            {formatCents(data.heldCents)} <span className="text-base font-semibold text-neutral-600">set aside so far</span>
          </p>
        )}

        {data.status === "unclaimed" && <ClaimBox artistId={data.id} name={data.name} viewer={data.viewer} slug={slug} />}
        {data.viewer.isClaimant && <ArtistSettings artistId={data.id} name={data.name} declined={data.status === "declined"} />}

        <h2 className="mt-12 text-sm font-bold uppercase tracking-wider">Designs that credit {data.name}</h2>
        {data.works.length === 0 ? (
          <p className="mt-3 text-neutral-600">None shared yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {data.works.map((work) => (
              <li key={work.cr}>
                <Link to="/cr/$cr" params={{ cr: work.cr }} className="block">
                  <div className="flex aspect-square items-center justify-center rounded-2xl p-[10%]" style={{ background: work.backgroundColor }}>
                    {work.thumbUrl && <Art url={work.thumbUrl} alt={work.title ?? `CR ${work.cr}`} className="h-full w-auto max-w-full object-contain" />}
                  </div>
                  <p className="mt-2 font-bold">CR {work.cr}</p>
                  {work.title && <p className="text-sm text-neutral-600">{work.title}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-12 max-w-prose text-sm text-neutral-600">
          A credit is recognition of an influence. It doesn't license the artist's work, and a style can't be owned. If a design copies a
          specific artwork of yours, write to{" "}
          <a href="mailto:hey@cultremix.com" className="underline underline-offset-2">
            hey@cultremix.com
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

type Viewer = {
  signedIn: boolean;
  isClaimant: boolean;
  claim: null | { id: string; code: string; status: "started" | "submitted" | "approved" | "rejected"; proofUrl: string | null; reason: string | null };
};

function ClaimBox({ artistId, name, viewer, slug }: { artistId: string; name: string; viewer: Viewer; slug: string }) {
  const start = useMutation(api.artists.startClaim);
  const submit = useMutation(api.artists.submitClaim);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const claim = viewer.claim;
  const box = "mt-8 max-w-2xl rounded-2xl border-2 border-black p-5";

  if (!viewer.signedIn) {
    return (
      <div className={box}>
        <p className="font-black">Are you {name}?</p>
        <p className="mt-1 text-neutral-700">Sign in or make an account, then claim this page to receive what's been set aside.</p>
        <Link to="/login" search={{ redirect: `/artist/${slug}` }} className="mt-3 inline-flex h-11 items-center rounded-xl bg-black px-5 font-black text-white">
          Sign in to claim
        </Link>
      </div>
    );
  }
  if (!claim || claim.status === "rejected") {
    return (
      <div className={box}>
        <p className="font-black">Are you {name}?</p>
        {claim?.reason && <p className="mt-1 text-sm text-red-700">Your last claim wasn't approved: {claim.reason}</p>}
        <p className="mt-1 text-neutral-700">Claim this page to receive what's set aside and to choose how you're credited.</p>
        {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await start({ artistId: artistId as never });
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 inline-flex h-11 items-center rounded-xl bg-black px-5 font-black text-white disabled:opacity-40"
        >
          Claim this page
        </button>
      </div>
    );
  }
  if (claim.status === "submitted") {
    return (
      <div className={box} role="status">
        <p className="font-black">Thanks. We're checking it.</p>
        <p className="mt-1 text-neutral-700">
          We'll look for <span className="font-mono font-bold">{claim.code}</span> at {claim.proofUrl}. Once it's confirmed, this page is yours and
          what's been set aside moves to your account.
        </p>
      </div>
    );
  }
  return (
    <div className={box}>
      <p className="font-black">Show us it's you</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-800">
        <li>
          Post this code where your work lives (a post, your bio, or a page on your site), or email it to hey@cultremix.com from your site's
          domain: <span className="select-all font-mono font-bold">{claim.code}</span>
        </li>
        <li>Paste the link to it here.</li>
      </ol>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await submit({ claimId: claim.id as never, proofUrl: proof });
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Link to the code"
          value={proof}
          onChange={(e) => setProof(e.target.value)}
          placeholder="https://instagram.com/p/…"
          inputMode="url"
          className="h-11 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 px-3 outline-none focus:border-black"
        />
        <button type="submit" disabled={busy || !proof.trim()} className="h-11 rounded-xl bg-black px-5 font-black text-white disabled:opacity-40">
          Send for review
        </button>
      </form>
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

function ArtistSettings({ artistId, name, declined }: { artistId: string; name: string; declined: boolean }) {
  const update = useMutation(api.artists.updateMine);
  const [value, setValue] = useState(name);
  const [note, setNote] = useState("");
  const run = async (args: { name?: string; decline?: boolean }, done: string) => {
    setNote("");
    try {
      await update({ artistId: artistId as never, ...args });
      setNote(done);
    } catch (err) {
      setNote(errorMessage(err));
    }
  };
  return (
    <div className="mt-8 max-w-2xl rounded-2xl border-2 border-black p-5">
      <p className="font-black">Your artist page</p>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run({ name: value }, "Saved.");
        }}
      >
        <input
          aria-label="How you're credited"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          className="h-11 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 px-3 outline-none focus:border-black"
        />
        <button type="submit" className="h-11 rounded-xl bg-black px-5 font-black text-white">
          Save name
        </button>
      </form>
      <button
        type="button"
        onClick={() => void run({ decline: !declined }, declined ? "You're credited again." : "Done. Designs no longer credit you, and new sales don't set anything aside.")}
        className="mt-3 text-sm font-semibold underline underline-offset-4"
      >
        {declined ? "Accept the credit again" : "Turn the credit down"}
      </button>
      {note && (
        <p role="status" className="mt-2 text-sm">
          {note}
        </p>
      )}
    </div>
  );
}
