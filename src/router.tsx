import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider } from "convex/react";
import { routeTree } from "./routeTree.gen";
import { ErrorPage, NotFoundPage } from "~/components/app/not-found";
import { pageHasSession, resumeWithoutAuthAfter } from "~/lib/sessionMeta";

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  if (!convexUrl) console.error("missing VITE_CONVEX_URL");

  // Public pages load signed out (KTD-1a), so live queries don't wait for a token. A page the
  // server rendered for a signed-in member waits for theirs instead: otherwise the first live
  // results are anonymous (the viewer reads as signed out), overwrite what the server sent, and
  // the page hydrates as a different page. Better Auth hands the token over as soon as React
  // mounts, and setting it always resumes the paused socket.
  const waitForAuth = pageHasSession();
  const convexQueryClient = new ConvexQueryClient(convexUrl ?? "", {
    expectAuth: waitForAuth,
  });
  if (waitForAuth) resumeWithoutAuthAfter(convexQueryClient.convexClient);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        gcTime: 5000,
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient, convexQueryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultNotFoundComponent: () => <NotFoundPage />,
    defaultErrorComponent: ErrorPage,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    ),
  });
  // Replaces the deprecated @tanstack/react-router-with-query, whose SSR hook
  // (router.serverSsr.isDehydrated) no longer exists in router-core 1.171.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
