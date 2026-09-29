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
      <div className="min-h-svh bg-white px-6 py-16 text-black md:px-12">
        <p className="font-cr text-[26vw] leading-none md:text-[16vw]">404</p>
        <p className="mt-6 text-2xl font-bold md:text-4xl">Nothing here.</p>
        <a href="/" className="mt-8 inline-block rounded-2xl bg-black px-7 py-4 text-lg font-black text-white">
          Back to the feed
        </a>
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
