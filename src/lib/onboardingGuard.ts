import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";

const EXEMPT = [
  "/login",
  "/verify-email",
  "/verify-phone",
  "/auth",
  "/api",
  "/onboarding",
  "/health",
];

export function isOnboardingExempt(pathname: string) {
  return EXEMPT.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

// A signed-in member without a username is sent to /onboarding, which returns
// them to where they were headed (remix links survive sign-in and onboarding).
export function useOnboardingGuard() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const viewer = useQuery(convexQuery(api.identity.viewer, {}));
  const needsUsername = viewer.data?.needsUsername === true;

  useEffect(() => {
    if (!needsUsername || isOnboardingExempt(pathname)) return;
    const back = `${pathname}${searchStr}`;
    router.history.replace(`/onboarding?redirect=${encodeURIComponent(back)}`);
  }, [needsUsername, pathname, searchStr, router]);
}
