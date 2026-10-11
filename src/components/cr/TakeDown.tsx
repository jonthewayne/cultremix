import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "~/lib/imagePrep";

// On a work's page, for admins who manage (ops and the owner): take the design down
// (convex/moderation.ts). Its page, feed rows, and shop go, it stops selling, and its creator is
// told the reason given here. Admin, Overview can put it back up.
export function TakeDown({ workId, cr }: { workId: Id<"works">; cr: string }) {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const withdraw = useMutation(api.moderation.withdraw);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!viewer?.canManage) return null;

  if (!open) {
    return (
      <div className="border-t-2 border-black pt-4 text-sm">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center font-semibold text-red-700 underline underline-offset-4">
          Take this design down
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await withdraw({ workId, reason });
      toast("CR " + cr + " was taken down. Its creator was told why.");
      await navigate({ to: "/" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="border-t-2 border-black pt-4 text-sm">
      <p className="font-bold uppercase tracking-wider">Take this design down</p>
      <p className="mt-1 text-neutral-600">
        Its page, feed rows, and shop go, and it stops selling. Its CR number, lineage, and Monad record stay. Its creator sees
        the reason.
      </p>
      <label htmlFor="takedown-reason" className="mt-3 block font-semibold">
        Why
      </label>
      <textarea
        id="takedown-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={280}
        rows={3}
        required
        className="mt-1 w-full rounded-xl border-2 border-black p-3 text-base"
      />
      {error && <p className="mt-2 font-semibold text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || !reason.trim()}
          className="inline-flex h-11 items-center rounded-xl bg-red-700 px-4 font-black text-white disabled:opacity-50"
        >
          {busy ? "Taking it down…" : "Take it down"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
          className="inline-flex h-11 items-center rounded-xl border-2 border-black px-4 font-bold"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

