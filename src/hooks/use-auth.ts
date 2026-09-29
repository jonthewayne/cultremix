import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "~/lib/auth-client";

const currentUserQuery = convexQuery(api.auth.getCurrentUser, {});

export function useCurrentUser() {
  const { data } = useQuery({
    ...currentUserQuery,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return data;
}

export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useCurrentUser();

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          location.reload();
        },
      },
    });
  };

  return { user, isAuthenticated, isLoading, signOut };
}

export function isSuperAdminRole(role: string | undefined) {
  return (
    role === "super_admin_support" ||
    role === "super_admin_ops" ||
    role === "super_admin_owner"
  );
}
