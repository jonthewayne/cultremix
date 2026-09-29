import { describe, expect, it } from "vitest";
import { authClient, convexAuthClient } from "../../src/lib/auth-client";

describe("Better Auth Convex client contract", () => {
  it("exposes the runtime hooks consumed by ConvexBetterAuthProvider", () => {
    expect(convexAuthClient).toBe(authClient);
    expect(authClient.useSession).toBeTypeOf("function");
    expect(authClient.convex.token).toBeTypeOf("function");
  });
});
