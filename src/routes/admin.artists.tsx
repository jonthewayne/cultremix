import { useMutation, useQuery } from "convex/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AdminSection, adminButton, adminInput, adminQuietButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";
import { formatCents } from "~/lib/money";

export const Route = createFileRoute("/admin/artists")({
  head: () => ({ meta: [{ title: "Artists · Admin · CultRemix" }] }),
  component: AdminArtists,
});

// Outside artists designs credit (docs/decisions.md; convex/artists.ts): claims waiting for a look,
// a design's credits to add or correct, and every artist with what's set aside for them.
function AdminArtists() {
  const data = useQuery(api.artists.adminOverview, {});
  return (
    <div className="space-y-6">
      <AdminSection
        title="Claims"
        description="Someone says they're the artist. Open their link and look for the code (or an email from the site's domain). Approving gives them the page now; after a 14-day review, in which you can still undo it, they get creator access and everything set aside for the artist."
      >
        {!data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : data.claims.length === 0 ? (
          <p className="text-muted-foreground">No claims waiting.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </ul>
        )}
      </AdminSection>
      <CreditEditor />
      <AdminSection title="Artists" description="Credited artists, newest first. Unclaimed artists' shares are held until they claim them.">
        {!data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : data.artists.length === 0 ? (
          <p className="text-muted-foreground">No artists credited yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.artists.map((artist) => (
              <ArtistRow key={artist.id} artist={artist} />
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

type ArtistView = NonNullable<ReturnType<typeof useQuery<typeof api.artists.adminOverview>>>["artists"][number];

// One credited artist: its page, status, and what's held, with a rename and a hide for staff.
function ArtistRow({ artist }: { artist: ArtistView }) {
  const update = useMutation(api.artists.adminUpdateArtist);
  const unclaim = useMutation(api.artists.adminUnclaim);
  const [undoReason, setUndoReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(artist.name);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const id = artist.id as Id<"artists">;
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Link to="/artist/$slug" params={{ slug: artist.slug }} className="font-black hover:underline">
            {artist.name}
          </Link>{" "}
          <span className="text-sm text-muted-foreground">
            {artist.hidden ? "hidden · " : ""}
            {artist.status === "claimed" ? `claimed by @${artist.claimedBy ?? "member"}` : artist.status} ·{" "}
            {artist.credits} {artist.credits === 1 ? "design" : "designs"} · {artist.links.join(", ")}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          {(artist.status === "unclaimed" || artist.reviewUntil !== null) && <span className="font-bold tabular-nums">{formatCents(artist.heldCents)} held</span>}
          <button type="button" className={adminQuietButton} onClick={() => setEditing(!editing)}>
            Rename
          </button>
          <button type="button" className={adminQuietButton} onClick={() => void run(() => update({ artistId: id, hidden: !artist.hidden }))}>
            {artist.hidden ? "Show" : "Hide"}
          </button>
        </div>
      </div>
      {editing && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => update({ artistId: id, name }));
          }}
        >
          <input className={adminInput} value={name} onChange={(e) => setName(e.target.value)} aria-label="Artist name" />
          <button type="submit" className={adminButton}>
            Save
          </button>
        </form>
      )}
      {artist.reviewUntil !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            In review: what's held moves to @{artist.claimedBy ?? "member"} on {new Date(artist.reviewUntil).toLocaleDateString()}.
          </span>
          <input className={adminInput} value={undoReason} onChange={(e) => setUndoReason(e.target.value)} placeholder="Why undo (they'll see it)" />
          <button type="button" className={adminQuietButton} onClick={() => void run(() => unclaim({ artistId: id, reason: undoReason }))}>
            Undo the claim
          </button>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
    </li>
  );
}

type Claim = NonNullable<ReturnType<typeof useQuery<typeof api.artists.adminOverview>>>["claims"][number];

function ClaimRow({ claim }: { claim: Claim }) {
  const approve = useMutation(api.artists.approveClaim);
  const reject = useMutation(api.artists.rejectClaim);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <li className="space-y-2 py-4">
      <p>
        <span className="font-black">@{claim.username}</span> says they're{" "}
        <Link to="/artist/$slug" params={{ slug: claim.artist.slug }} className="font-black hover:underline">
          {claim.artist.name}
        </Link>{" "}
        <span className="text-sm text-muted-foreground">({claim.artist.links.join(", ")})</span>
      </p>
      <p className="text-sm">
        Code <span className="font-mono font-bold">{claim.code}</span> at{" "}
        {claim.proofUrl ? (
          <a href={claim.proofUrl} target="_blank" rel="noreferrer nofollow" className="font-semibold underline underline-offset-2">
            {claim.proofUrl}
          </a>
        ) : (
          "no link"
        )}
      </p>
      {claim.note && <p className="text-sm text-muted-foreground">{claim.note}</p>}
      {claim.proofMatch === "elsewhere" && (
        <p className="text-sm font-semibold text-destructive">
          The proof isn't on any of the artist's own sites. A page anyone can post to isn't proof.
        </p>
      )}
      {claim.proofMatch === "site" && (
        <p className="text-sm font-semibold text-destructive">
          The proof is on the same site but not the artist's credited page. Check who posted it: a comment or a lookalike account isn't proof.
        </p>
      )}
      {claim.creditedBy.length > 0 && (
        <p className={claim.claimantCredited ? "text-sm font-semibold text-destructive" : "text-sm text-muted-foreground"}>
          Credited while publishing by {claim.creditedBy.map((name) => `@${name}`).join(", ")}
          {claim.claimantCredited ? ". The claimant credited this artist themselves." : "."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={adminButton} onClick={() => void run(() => approve({ claimId: claim.id as Id<"artistClaims"> }))}>
          Approve
        </button>
        <input className={adminInput} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not (they'll see it)" />
        <button type="button" className={adminQuietButton} onClick={() => void run(() => reject({ claimId: claim.id as Id<"artistClaims">, reason }))}>
          Reject
        </button>
      </div>
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
    </li>
  );
}

type Row = { name: string; link: string };

function CreditEditor() {
  const [cr, setCr] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const current = useQuery(api.artists.adminWorkCredits, loaded ? { cr: loaded } : "skip");
  const save = useMutation(api.artists.adminSetWorkCredits);
  const [rows, setRows] = useState<Array<Row> | null>(null);
  const [status, setStatus] = useState("");
  const shown = rows ?? current?.artists ?? [];
  const edit = (i: number, patch: Partial<Row>) => setRows(shown.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <AdminSection
      title="A design's credits"
      description="Add or correct the artists a design credits. A credit always comes from that design's creator's share, a fifth of it split among up to three artists, and its remixes inherit it. New sales follow the change."
    >
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRows(null);
          setStatus("");
          setLoaded(cr.trim());
        }}
      >
        <input className={adminInput} value={cr} onChange={(e) => setCr(e.target.value)} placeholder="CR number, like 101-001" />
        <button type="submit" className={adminQuietButton}>
          Open
        </button>
      </form>
      {loaded && current === null && <p className="mt-3 text-sm text-destructive">No design has that CR number.</p>}
      {current && (
        <div className="mt-4 space-y-3">
          <p className="font-black">
            CR {current.cr}
            {current.title ? ` · ${current.title}` : ""}
          </p>
          {shown.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input className={adminInput} aria-label="Artist name" value={row.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Artist's name" />
              <input className={adminInput} aria-label="Artist link" value={row.link} onChange={(e) => edit(i, { link: e.target.value })} placeholder="Link to their work" />
              <button type="button" className={adminQuietButton} onClick={() => setRows(shown.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={adminQuietButton} disabled={shown.length >= 3} onClick={() => setRows([...shown, { name: "", link: "" }])}>
              Add an artist
            </button>
            <button
              type="button"
              className={adminButton}
              onClick={async () => {
                setStatus("");
                try {
                  await save({ cr: current.cr, artists: shown });
                  setRows(null);
                  setStatus("Saved.");
                } catch (err) {
                  setStatus(errorMessage(err));
                }
              }}
            >
              Save credits
            </button>
          </div>
          {status && <p className="text-sm font-semibold">{status}</p>}
        </div>
      )}
    </AdminSection>
  );
}
