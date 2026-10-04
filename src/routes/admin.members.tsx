import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { canGrantPlatformRole, hasCapability } from "../../convex/lib/authz";
import type { Id } from "../../convex/_generated/dataModel";
import { AdminSection, adminButton, adminInput, adminQuietButton } from "~/components/admin/AdminSection";
import { formatDollars } from "~/components/admin/BudgetCard";
import { useCurrentUser } from "~/hooks/use-auth";
import { errorMessage } from "~/lib/imagePrep";

export const Route = createFileRoute("/admin/members")({
  component: AdminMembers,
});

type Member = {
  userId: Id<"users">;
  email?: string;
  username?: string;
  creatorNumber?: number;
  platformRole: string;
  credits: number;
  isCreator: boolean;
  joinedAt: number;
  spentTodayCents?: number;
};

function AdminMembers() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const members = useQuery(api.admin.searchMembers, { search: term });
  const overview = useQuery(api.admin.overview, {});
  const canManage = overview?.canManage ?? false;

  return (
    <AdminSection
      title="Members"
      description="Search by username, email, or creator number. The newest members show first when the box is empty."
    >
      <input
        type="search"
        className={`${adminInput} w-full`}
        placeholder="@username, email, or № 12"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search members"
      />
      <ul className="mt-5 space-y-3">
        {members?.map((member) => <MemberRow key={member.userId} member={member} canManage={canManage} />)}
        {members && members.length === 0 && <li className="text-sm text-muted-foreground">No one matches that.</li>}
        {!members && <li className="text-sm text-muted-foreground">Looking…</li>}
      </ul>
    </AdminSection>
  );
}

function MemberRow({ member, canManage }: { member: Member; canManage: boolean }) {
  const viewer = useCurrentUser();
  const grantCredits = useMutation(api.admin.grantCredits);
  const setCreator = useMutation(api.admin.setCreator);
  const updateRole = useMutation(api.auth.updatePlatformRole);
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const viewerRole = viewer?.platformRole ?? "user";
  const canChangeRole =
    hasCapability(viewerRole, "users:invite") &&
    member.platformRole !== "super_admin_owner" &&
    canGrantPlatformRole(viewerRole, member.platformRole);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      await work();
      setStatus(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const grant = (event: React.FormEvent) => {
    event.preventDefault();
    const credits = Number(amount);
    void run(
      () => grantCredits({ userId: member.userId, amount: credits, note: note.trim() || undefined }),
      `Gave ${credits} credits.`,
    ).then(() => setNote(""));
  };

  return (
    <li className="rounded-2xl border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black">
            {member.username ? `@${member.username}` : "No username yet"}
            {member.creatorNumber !== undefined && (
              <span className="font-cr ml-2 text-base text-muted-foreground">№ {member.creatorNumber}</span>
            )}
          </p>
          <p className="truncate text-sm text-muted-foreground">{member.email ?? "No email"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Joined {new Date(member.joinedAt).toLocaleDateString()} · {member.platformRole}
            {member.isCreator && " · creator"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black tabular-nums">
            {member.credits}
            <span className="ml-1 text-sm font-bold text-muted-foreground">credits</span>
          </p>
          {member.spentTodayCents !== undefined && member.spentTodayCents > 0 && (
            <p className="text-xs font-bold text-muted-foreground tabular-nums">
              {formatDollars(member.spentTodayCents)} of images today
            </p>
          )}
        </div>
      </div>

      {canManage && (
        <div className="mt-4 flex flex-col gap-3 border-t-2 border-border pt-4">
          <form className="flex flex-wrap gap-2" onSubmit={grant}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              className={`${adminInput} w-24`}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="Credits to give"
              required
            />
            <input
              type="text"
              className={`${adminInput} min-w-0 flex-1`}
              placeholder="Note (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              aria-label="Note"
            />
            <button type="submit" className={adminButton} disabled={busy}>
              Give credits
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={adminQuietButton}
              disabled={busy || member.platformRole === "super_admin_owner"}
              onClick={() =>
                void run(
                  () => setCreator({ userId: member.userId, active: !member.isCreator }),
                  member.isCreator ? "Creator access off." : "Creator access on.",
                )
              }
            >
              {member.isCreator ? "Turn off creator access" : "Make a creator"}
            </button>
            {canChangeRole && (
              <button
                type="button"
                className={adminQuietButton}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      updateRole({
                        userId: member.userId,
                        role: member.platformRole === "super_admin_support" ? "user" : "super_admin_support",
                      }),
                    "Role changed.",
                  )
                }
              >
                {member.platformRole === "super_admin_support" ? "Remove support role" : "Make support"}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
      {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
    </li>
  );
}
