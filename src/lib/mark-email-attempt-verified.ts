import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "~/lib/auth-client";
import { getPreauthClient } from "~/lib/convex-preauth";

export async function markEmailAttemptVerified(
  attemptId: Id<"authVerificationAttempts">,
) {
  const { data, error } = await authClient.convex.token({
    fetchOptions: { throw: false },
  });
  if (error || !data.token) {
    throw new Error("A signed-in Convex token is required to verify this attempt");
  }

  const client = getPreauthClient();
  client.setAuth(() => Promise.resolve(data.token));
  return client.mutation(api.authVerification.markEmailAuthAttemptVerified, {
    attemptId,
  });
}
