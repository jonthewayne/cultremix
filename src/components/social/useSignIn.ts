import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useCallback } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";

// For buttons that need a member: signed out, a tap goes to sign in and comes back here.
export function useMemberAction() {
  const viewer = useQuery(convexQuery(api.identity.viewer, {})).data;
  const href = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();
  const signIn = useCallback(() => {
    void navigate({ to: "/login", search: { redirect: href } });
  }, [navigate, href]);
  // undefined while the viewer is still loading.
  return {
    signedIn: viewer === undefined ? undefined : viewer !== null,
    username: viewer?.username,
    signIn,
  };
}

export function showMutationError(error: unknown) {
  const message =
    error instanceof ConvexError ? (error.data as { message?: string } | undefined)?.message : undefined;
  toast.error(message ?? "That didn’t go through. Try again.");
}
