import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider } from "convex/react";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  if (!convexUrl) console.error("missing VITE_CONVEX_URL");

  const convexQueryClient = new ConvexQueryClient(convexUrl ?? "", {
    expectAuth: false,
  });
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
    defaultNotFoundComponent: () => (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This route does not exist.
          </p>
        </div>
      </div>
    ),
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
