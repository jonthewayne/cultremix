import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Toaster } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { convexAuthClient } from "~/lib/auth-client";
import { getToken } from "~/lib/auth-server";
import { useOnboardingGuard } from "~/lib/onboardingGuard";
import appCss from "~/styles/app.css?url";

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await getToken();
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
      { title: "CultRemix" },
      {
        name: "description",
        content: "Design a shirt, publish it with a CR number, and let anyone remix it.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth();
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return { isAuthenticated: !!token, token };
  },
  component: RootComponent,
});

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  return (
    <RootDocument>
      <ConvexBetterAuthProvider
        client={context.convexQueryClient.convexClient}
        authClient={convexAuthClient}
        initialToken={context.token}
      >
        <OnboardingGuard />
        <Outlet />
      </ConvexBetterAuthProvider>
    </RootDocument>
  );
}

function OnboardingGuard() {
  useOnboardingGuard();
  return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{const t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch{}",
          }}
        />
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
