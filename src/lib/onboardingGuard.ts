import { convexQuery } from "@convex-dev/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { redirect, useRouter, useRouterState } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { sanitizeRedirect } from "~/lib/sanitize-redirect";

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

type Viewer = FunctionReturnType<typeof api.identity.viewer>;

// The viewer for routing decisions, or null when it isn't known. On the server it is fetched with
// this request's token, and the page receives it with the rest of the query cache, so the header
// shows the member from the first frame. In the browser it comes from the live cache, so a
// navigation never waits on it.
async function knownViewer(queryClient: QueryClient, convexQueryClient: ConvexQueryClient): Promise<Viewer> {
  const options = convexQuery(api.identity.viewer, {});
  if (convexQueryClient.serverHttpClient) {
    try {
      return (await queryClient.fetchQuery(options)) as Viewer;
    } catch {
      return null;
    }
  }
  return (queryClient.getQueryData(options.queryKey) as Viewer | undefined) ?? null;
}

// Runs in the root route's beforeLoad, so the right page is chosen before anything renders: on
// the first load after sign-in the server answers with a redirect and the requested page never
// shows. A member without a username goes to /onboarding and comes back afterward; a member who
// has one skips onboarding.
export async function redirectForOnboarding(args: {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
  location: { pathname: string; href: string; search: unknown };
}) {
  const { pathname, href, search } = args.location;
  const onOnboarding = pathname === "/onboarding";
  if (!onOnboarding && isOnboardingExempt(pathname)) return;
  const viewer = await knownViewer(args.queryClient, args.convexQueryClient);
  if (!viewer) return;
  if (!onOnboarding && viewer.needsUsername) {
    throw redirect({ to: "/onboarding", search: { redirect: sanitizeRedirect(href) }, replace: true });
  }
  if (onOnboarding && !viewer.needsUsername) {
    const back = (search as { redirect?: unknown } | undefined)?.redirect;
    const destination = sanitizeRedirect(typeof back === "string" ? back : undefined);
    throw redirect({ href: destination.startsWith("/onboarding") ? "/studio" : destination, replace: true });
  }
}

// Fallback for redirectForOnboarding when the viewer wasn't known yet: a signed-in member without
// a username is sent to /onboarding, which returns them to where they were headed (remix links
// survive sign-in and onboarding). It also keeps the viewer query live for the check above.
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
