import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { crParts, hexOf, readMonadRecord } from "~/lib/monadRecord";
import type { MonadRecord } from "~/lib/monadRecord";

// Under a work's fingerprint, once the registry is deployed: the browser downloads the design's
// original file and hashes it, reads its record from Monad's public RPC (src/lib/monadRecord.ts),
// and says whether both match the fingerprint on the page. Nothing goes through CultRemix's servers
// but the file itself, from the public bucket.

type Result = { fileHash: string; record: MonadRecord | null };
type State = { step: "idle" } | { step: "running" } | { step: "done"; result: Result } | { step: "error"; message: string };

export function VerifyOnMonad({ cr, artUrl, contentHash }: { cr: string; artUrl?: string; contentHash: string }) {
  const registry = useQuery(convexQuery(api.provenance.registry, {})).data;
  const [state, setState] = useState<State>({ step: "idle" });
  if (!registry?.address || !artUrl || artUrl.startsWith("fake:")) return null;
  const expected = contentHash.toLowerCase().replace(/^0x/u, "");
  const run = async () => {
    setState({ step: "running" });
    try {
      // A fresh CORS request: an earlier <img> load may be cached without CORS headers.
      const response = await fetch(artUrl, { mode: "cors", cache: "no-store" });
      if (!response.ok) throw new Error(`The file couldn't be downloaded (${response.status}).`);
      const fileHash = hexOf(await crypto.subtle.digest("SHA-256", await response.arrayBuffer()));
      const record = await readMonadRecord({ rpcUrl: registry.publicRpcUrl, registry: registry.address!, ...crParts(cr) });
      setState({ step: "done", result: { fileHash, record } });
    } catch (error) {
      setState({ step: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  if (state.step !== "done") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.step === "running"}
          className="min-h-10 rounded-xl border-2 border-black bg-white px-3 font-bold disabled:opacity-50"
        >
          {state.step === "running" ? "Checking…" : "Verify it yourself"}
        </button>
        {state.step === "error" && <p className="mt-2">Couldn't finish the check: {state.message} Try again in a moment.</p>}
      </div>
    );
  }
  const { fileHash, record } = state.result;
  const fileOk = fileHash === expected;
  const chainOk = record !== null && record.contentHash === expected;
  return (
    <div className="mt-3 space-y-1" role="status">
      <Line ok={fileOk}>
        {fileOk ? "The original file's fingerprint matches." : `The original file's fingerprint is different (${fileHash.slice(0, 12)}…).`}
      </Line>
      <Line ok={record === null ? null : chainOk}>
        {record === null
          ? `Monad has no record of CR ${cr} yet.`
          : chainOk
            ? `Monad's record matches${record.registeredAt ? `, recorded ${new Date(record.registeredAt * 1000).toLocaleString()}` : ""}.`
            : `Monad's record has a different fingerprint (${record.contentHash.slice(0, 12)}…).`}
      </Line>
      <p className="text-neutral-600">Your browser downloaded the file and asked {registry.networkName} itself.</p>
    </div>
  );
}

function Line({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <p className={ok === false ? "font-semibold text-red-700" : "font-semibold"}>
      <span aria-hidden className="mr-1.5 inline-block w-4 text-center">
        {ok === null ? "–" : ok ? "✓" : "✗"}
      </span>
      {children}
    </p>
  );
}
