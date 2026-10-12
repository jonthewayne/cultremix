import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LazyMotion } from "motion/react";
import { Toaster } from "sonner";
import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { convexAuthClient } from "~/lib/auth-client";
import { installClientErrorReporting } from "~/lib/clientErrors";
import { getTokenAndRenewSession } from "~/lib/auth-server";
import { redirectForOnboarding, useOnboardingGuard } from "~/lib/onboardingGuard";
import { SESSION_META } from "~/lib/sessionMeta";
import {
  SHARE_DESCRIPTION,
  SHARE_IMAGE,
  SHARE_IMAGE_ALT,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "~/lib/site";
import appCss from "~/styles/app.css?url";

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await getTokenAndRenewSession();
  } catch {
    return null;
  }
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "theme-color", content: "#ffffff" },
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:url", content: SITE_URL },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SHARE_DESCRIPTION },
      // No og:image:width/height here: pages with their own image (src/lib/share.ts) would
      // inherit sizes that aren't theirs. Crawlers read the size from the image.
      { property: "og:image", content: SHARE_IMAGE },
      { property: "og:image:alt", content: SHARE_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SHARE_DESCRIPTION },
      { name: "twitter:image", content: SHARE_IMAGE },
      { name: "twitter:image:alt", content: SHARE_IMAGE_ALT },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth();
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
      await redirectForOnboarding({
        queryClient: ctx.context.queryClient,
        convexQueryClient: ctx.context.convexQueryClient,
        location: ctx.location,
      });
    }
    return { isAuthenticated: !!token, token };
  },
  component: RootComponent,
});

// Animation features load in their own chunk (src/lib/motionFeatures.ts); strict makes any full
// motion.* component an error, so nothing pulls the whole library back into the main bundle.
const loadMotionFeatures = () => import("~/lib/motionFeatures").then((mod) => mod.default);

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  // Errors in this browser go to Admin, Overview (src/lib/clientErrors.ts).
  useEffect(() => installClientErrorReporting(context.convexQueryClient.convexClient), [context.convexQueryClient]);
  return (
    <RootDocument signedIn={Boolean(context.token)}>
      <ConvexBetterAuthProvider
        client={context.convexQueryClient.convexClient}
        authClient={convexAuthClient}
        initialToken={context.token}
      >
        <LazyMotion features={loadMotionFeatures} strict>
          <OnboardingGuard />
          <Outlet />
        </LazyMotion>
      </ConvexBetterAuthProvider>
    </RootDocument>
  );
}

function OnboardingGuard() {
  useOnboardingGuard();
  return null;
}

function RootDocument({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* src/router.tsx reads it: a signed-in page's live queries wait for the member's token. */}
        {signedIn && <meta name={SESSION_META} content="1" />}
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}
