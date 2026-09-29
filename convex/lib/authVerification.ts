import type { Doc } from "../_generated/dataModel";

export function publicEmailAttemptStatus(
  attempt: Doc<"authVerificationAttempts">,
) {
  return {
    _id: attempt._id,
    email: attempt.email,
    redirect: attempt.redirect,
    source: attempt.source,
    status: attempt.status,
    expiresAtMs: attempt.expiresAtMs,
    verifiedAtMs: attempt.verifiedAtMs,
    inviteId: attempt.inviteId,
  };
}

export function assertEmailAttemptIdentity(
  identityEmail: string | undefined,
  attemptEmail: string,
) {
  const normalizedIdentity = identityEmail?.trim().toLowerCase();
  const normalizedAttempt = attemptEmail.trim().toLowerCase();
  if (!normalizedIdentity) throw new Error("Not signed in with a verified email");
  if (normalizedIdentity !== normalizedAttempt) {
    throw new Error("Email auth attempt does not match signed-in user");
  }
}
