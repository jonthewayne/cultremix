import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { AdminSection, adminQuietButton } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";

const SOURCE: Record<string, string> = { window: "error", promise: "failed request", page: "page didn't load" };

// Errors people's browsers hit (convex/clientErrors.ts), newest first.
export function BrowserErrors() {
  const data = useQuery(api.clientErrors.recent, {});
  const clear = useMutation(api.clientErrors.clear);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return null;
  const { errors, canManage } = data;
  const clearAll = async () => {
    setBusy(true);
    setError("");
    try {
      await clear({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminSection
      title="Browser errors"
      description="Errors people's browsers hit on CultRemix in the last 14 days, newest first. The same error on the same page counts up; ten in an hour tell the owner and ops."
      action={
        canManage && errors.length > 0 ? (
          <button type="button" className={adminQuietButton} disabled={busy} onClick={() => void clearAll()}>
            {busy ? "Clearing…" : "Clear the list"}
          </button>
        ) : undefined
      }
    >
      {errors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in the last 14 days.</p>
      ) : (
        <ul className="divide-y divide-border">
          {errors.map((row) => (
            <li key={row.id} className="py-3 first:pt-0 last:pb-0">
              <p className="break-words font-mono text-sm">{row.message}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{row.path}</span> · {row.count === 1 ? "once" : row.count + " times"} · last{" "}
                {new Date(row.lastAt).toLocaleString()} · {SOURCE[row.source] ?? row.source} · {row.browser}
                {row.signedIn ? " · signed in" : ""}
              </p>
              {row.stack && (
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Stack</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">{row.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
    </AdminSection>
  );
}
