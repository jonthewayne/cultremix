import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Art } from "~/components/cr/Art";
import { crParts, hexOf, readMonadRecord } from "~/lib/monadRecord";
import type { MonadRecord } from "~/lib/monadRecord";
import { cn } from "~/lib/utils";

// Drop a design's original file (or paste a fingerprint) to find the CultRemix design it is. The
// file is hashed in the browser with SHA-256; only the hash is sent (provenance.byFingerprint).
// Any change to the file, even resaving it, changes its fingerprint.
export function FingerprintCheck() {
  const [hash, setHash] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const found = useQuery(convexQuery(api.provenance.byFingerprint, hash ? { contentHash: hash } : "skip"));

  const check = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      setFileName(file.name);
      setPasted("");
      setHash(hexOf(digest));
    } finally {
      setBusy(false);
    }
  };
  const checkPasted = (value: string) => {
    setPasted(value);
    const cleaned = value.trim().toLowerCase().replace(/^0x/u, "");
    setFileName(null);
    setHash(/^[0-9a-f]{64}$/u.test(cleaned) ? cleaned : null);
  };

  return (
    <div className="space-y-4">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void check(event.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black px-4 py-8 text-center transition-colors hover:bg-neutral-50",
          dragging && "bg-neutral-100",
        )}
      >
        <span className="text-lg font-black">{busy ? "Checking…" : "Drop a design's original file here"}</span>
        <span className="mt-1 text-sm text-neutral-600">or click to pick it. The file stays on your device; only its fingerprint is checked.</span>
        <input type="file" accept="image/png" className="sr-only" onChange={(event) => void check(event.target.files?.[0])} />
      </label>
      <label className="block text-sm">
        <span className="font-bold">Or paste a fingerprint</span>
        <input
          value={pasted}
          onChange={(event) => checkPasted(event.target.value)}
          placeholder="SHA-256, 64 characters"
          spellCheck={false}
          className="mt-1 h-11 w-full rounded-xl border-2 border-black px-3 font-mono text-xs"
        />
      </label>
      {hash && (
        <div className="rounded-2xl bg-neutral-100 p-4" role="status">
          <p className="break-all font-mono text-xs text-neutral-600">
            {fileName ? <span className="font-sans font-semibold text-black">{fileName} · </span> : null}SHA-256 {hash}
          </p>
          {found.data === undefined ? (
            <p className="mt-2 font-semibold">Looking it up…</p>
          ) : found.data === null ? (
            <p className="mt-2 font-semibold">
              No CultRemix design has this exact file. Any change to the file, even resaving it, changes its fingerprint, so use the
              original from the design's page.
            </p>
          ) : (
            <Link to="/cr/$cr" params={{ cr: found.data.cr }} className="mt-3 flex items-center gap-4 hover:underline">
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
                <Art url={found.data.thumbUrl} alt={'CR ' + found.data.cr} className="max-h-full max-w-full object-contain" />
              </span>
              <span>
                <span className="block font-black">
                  It matches CR {found.data.cr}
                  {found.data.title ? ' · ' + found.data.title : ""}
                </span>
                <span className="block text-sm text-neutral-600">
                  {KIND[found.data.kind]}
                  {found.data.creator ? ' by @' + found.data.creator : ""}
                  {found.data.publishedAt ? ', published ' + new Date(found.data.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
                </span>
              </span>
            </Link>
          )}
          {found.data && <ChainCheck key={found.data.cr} cr={found.data.cr} hash={hash} />}
        </div>
      )}
    </div>
  );
}

type ChainState =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "done"; record: MonadRecord | null }
  | { step: "error"; message: string };

// Once the registry is deployed: reads the design's record from Monad's public RPC, in the browser,
// and compares its fingerprint with the file's. Nothing goes through CultRemix's servers.
function ChainCheck({ cr, hash }: { cr: string; hash: string }) {
  const registry = useQuery(convexQuery(api.provenance.registry, {})).data;
  const [state, setState] = useState<ChainState>({ step: "idle" });
  if (!registry?.address) return null;
  const run = async () => {
    setState({ step: "reading" });
    try {
      const record = await readMonadRecord({ rpcUrl: registry.publicRpcUrl, registry: registry.address!, ...crParts(cr) });
      setState({ step: "done", record });
    } catch (error) {
      setState({ step: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="mt-4 border-t border-neutral-300 pt-4 text-sm">
      {state.step === "idle" || state.step === "reading" ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.step === "reading"}
          className="min-h-10 rounded-xl border-2 border-black bg-white px-3 font-bold disabled:opacity-50"
        >
          {state.step === "reading" ? "Asking Monad…" : "Check it on Monad yourself"}
        </button>
      ) : state.step === "error" ? (
        <p>Couldn't reach Monad: {state.message} Try again in a moment.</p>
      ) : state.record === null ? (
        <p>Monad has no record of CR {cr} yet. A new design is recorded within a minute or two of publishing.</p>
      ) : state.record.contentHash === hash ? (
        <p className="font-semibold">
          Monad's record of CR {cr} has this exact fingerprint
          {state.record.registeredAt ? `, recorded ${new Date(state.record.registeredAt * 1000).toLocaleString()}` : ""}. Your browser
          read it from {registry.networkName} directly.
        </p>
      ) : (
        <p className="font-semibold text-red-700">
          Monad's record of CR {cr} has a different fingerprint ({state.record.contentHash.slice(0, 12)}…). Write to
          hey@cultremix.com.
        </p>
      )}
    </div>
  );
}

const KIND = { original: "An original", variation: "A variation", fork: "A fork" } as const;
