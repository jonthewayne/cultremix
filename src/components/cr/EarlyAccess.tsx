import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Under "Buying opens soon": leave an email to hear when this one can be bought. Members with an
// email on file join with one tap. Hidden once buying opens.
export function EarlyAccess({ workId }: { workId: Id<"works"> }) {
  const status = useQuery(convexQuery(api.waitlist.status, { workId })).data;
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || !status.open) return null;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await join({ workId, email: email.trim() || undefined });
      setJoined(true);
    } catch (err) {
      const message = err instanceof ConvexError ? (err.data as { message?: string } | undefined)?.message : undefined;
      setError(message ?? "That didn’t go through. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (joined || status.joined) {
    return (
      <p role="status" className="-mt-3 text-base font-semibold">
        You’re on the list. We’ll let you know when this one can be bought.
      </p>
    );
  }

  const oneTap = status.signedIn && status.hasEmail;
  return (
    <div className="-mt-3">
      {oneTap ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="h-12 w-full rounded-2xl border-2 border-black text-base font-black transition-colors hover:bg-neutral-100 disabled:opacity-50"
        >
          {saving ? "Adding you…" : "Tell me when it’s ready"}
        </button>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <label className="sr-only" htmlFor={`early-access-${workId}`}>
            Email
          </label>
          <input
            id={`early-access-${workId}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email me when it’s ready"
            className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-black bg-white px-4 text-base outline-none placeholder:text-neutral-400"
          />
          <button
            type="submit"
            disabled={saving}
            className="h-12 shrink-0 rounded-2xl bg-black px-5 text-base font-black text-white disabled:opacity-50"
          >
            {saving ? "…" : "Join"}
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-sm text-neutral-600">One note when buying opens. Nothing else.</p>
      )}
    </div>
  );
}
