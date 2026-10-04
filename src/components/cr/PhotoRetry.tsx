import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";

const WAITING = "You’ve had your photo shoots for today. Try again tomorrow.";

// Under the model photo, for its creator only: when the photo didn't come, a calm line and a
// way to try it again (convex/photos.ts).
export function PhotoRetry({ cr }: { cr: string }) {
  const mine = useQuery(convexQuery(api.photos.mine, { cr })).data;
  const retry = useMutation(api.photos.retry);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!mine?.canRetry) return null;

  const waitingToday = mine.waiting && mine.shootsLeft === 0;
  const line = message ?? (waitingToday ? WAITING : mine.waiting ? "Your photo shoot is ready when you are." : "The photo didn’t come out. Try another shoot?");

  async function tryAgain() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await retry({ cr });
      if (result.message) setMessage(result.message);
    } catch {
      setMessage("That didn’t go through. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl border-2 border-black p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-base">{line}</p>
      {!waitingToday && (
        <button
          type="button"
          onClick={tryAgain}
          disabled={busy}
          className="h-11 shrink-0 rounded-xl bg-black px-5 font-bold text-white disabled:opacity-50"
        >
          {busy ? "Starting…" : "Take the photo"}
        </button>
      )}
    </div>
  );
}
