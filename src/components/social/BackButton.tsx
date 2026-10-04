import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const BUTTON = "flex h-14 w-full items-center justify-center rounded-2xl border-2 border-black text-lg font-black";

// Back a work: one per work, 3 a week, recorded on Monad by the relayer.
export function BackButton({ workId, cr }: { workId: Id<"works">; cr: string }) {
  const { data } = useQuery(convexQuery(api.backs.forWork, { workId }));
  const back = useMutation(api.backs.back);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;

  const viewer = data.viewer;
  if (viewer?.status === "confirmed") {
    return (
      <button type="button" disabled className={`${BUTTON} cursor-default bg-black text-white`}>
        Backed
      </button>
    );
  }
  if (viewer?.status === "reserved" || viewer?.status === "submitted") {
    return (
      <div>
        <button type="button" disabled className={`${BUTTON} cursor-default text-neutral-500`}>
          Backing…
        </button>
        <p className="mt-2 text-sm">Your Back is being recorded on Monad.</p>
      </div>
    );
  }
  if (data.reason?.code === "SIGNED_OUT") {
    return (
      <Link to="/login" search={{ redirect: `/cr/${cr}` }} className={`${BUTTON} transition-transform hover:-translate-y-0.5`}>
        Sign in to Back
      </Link>
    );
  }

  async function onBack() {
    setSending(true);
    setError(null);
    try {
      await back({ workId });
    } catch (caught) {
      setError(caught instanceof ConvexError ? ((caught.data as { message?: string }).message ?? "That didn't go through.") : "That didn't go through.");
    } finally {
      setSending(false);
    }
  }

  const note = error ?? (data.canBack ? (viewer?.error ? `Your last Back didn't go through: ${viewer.error}` : null) : data.reason?.message);
  const left = data.weeklyUsed === null ? null : Math.max(data.weeklyLimit - data.weeklyUsed, 0);
  return (
    <div>
      <button
        type="button"
        disabled={!data.canBack || sending}
        onClick={onBack}
        className={`${BUTTON} transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400`}
      >
        {sending ? "Backing…" : "Back this work"}
      </button>
      {note && <p className="mt-2 text-sm">{note}</p>}
      {left !== null && (
        <p className="mt-1 text-sm text-neutral-500">
          {left} of {data.weeklyLimit} Backs left this week
        </p>
      )}
    </div>
  );
}
