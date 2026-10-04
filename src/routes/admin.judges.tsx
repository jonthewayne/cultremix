import { useAction, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { AdminSection, adminButton, adminInput } from "~/components/admin/AdminSection";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/judges")({
  component: AdminJudges,
});

type Made = {
  email: string;
  username: string;
  creatorNumber?: number;
  credits: number;
  created: boolean;
  password?: string;
};

function AdminJudges() {
  const overview = useQuery(api.admin.overview, {});
  const provision = useAction(api.judges.provision);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [resetPassword, setResetPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<Array<Made>>([]);

  if (overview && !overview.isOwner) {
    return (
      <AdminSection title="Judges">
        <p className="text-muted-foreground">Only the owner can make judge accounts.</p>
      </AdminSection>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await provision({ email, username, resetPassword: resetPassword || undefined });
      setMade((rows) => [result, ...rows]);
      setEmail("");
      setUsername("");
      setResetPassword(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminSection
        title="Judges"
        description="Each judge gets a password, creator access, 40 credits, and a username, so they land straight in the studio. Running it again for the same email changes nothing unless you ask for a new password."
      >
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Email</span>
              <input
                type="email"
                className={adminInput}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="judge@example.com"
                required
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold">Username</span>
              <input
                type="text"
                className={adminInput}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="monad_judge_1"
                required
              />
            </label>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-foreground"
              checked={resetPassword}
              onChange={(event) => setResetPassword(event.target.checked)}
            />
            Give an existing judge a new password
          </label>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <button type="submit" className={adminButton} disabled={busy}>
            {busy ? "Making…" : "Make judge account"}
          </button>
        </form>
      </AdminSection>

      {made.length > 0 && (
        <AdminSection
          title="Just made"
          description="Copy each password now. It shows only here, only once, and isn't stored anywhere readable."
        >
          <ul className="space-y-3">
            {made.map((row) => (
              <li key={`${row.email}-${row.password ?? ""}`} className="rounded-xl border-2 border-border bg-background p-4">
                <p className="font-black">
                  @{row.username}
                  {row.creatorNumber !== undefined && (
                    <span className="font-cr ml-2 text-muted-foreground">№ {row.creatorNumber}</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {row.email} · {row.credits} credits · {row.created ? "new account" : "already had an account"}
                </p>
                {row.password ? (
                  <p className="mt-2 break-all font-mono text-lg font-bold select-all">{row.password}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Password unchanged.</p>
                )}
              </li>
            ))}
          </ul>
        </AdminSection>
      )}
    </div>
  );
}
