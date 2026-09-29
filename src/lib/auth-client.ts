import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import {
  emailOTPClient,
  magicLinkClient,
  phoneNumberClient,
} from "better-auth/client/plugins";
import type { AuthClient as ConvexBetterAuthClient } from "@convex-dev/better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    convexClient(),
    magicLinkClient(),
    emailOTPClient(),
    phoneNumberClient(),
  ],
});

// Better Auth 1.6.33 infers the installed plugin session shape more narrowly
// than the adapter's non-generic provider interface. The provider only uses
// the shared runtime methods, so keep the precise client type for app code and
// bridge the type at this single integration boundary.
export const convexAuthClient = authClient as unknown as ConvexBetterAuthClient;
