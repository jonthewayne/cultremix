import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { SiteHeader } from "~/components/cr/SiteHeader";
import { useAuth } from "~/hooks/use-auth";

// The frame for signed-in tool pages (Admin and the starter's dashboard and team pages): the same
// header and light page as the rest of CultRemix, so moving between the studio and Admin doesn't
// switch looks. Admin's own tabs sit under its title.
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentHref = useRouterState({ select: (state) => state.location.href });
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== "/login") {
      const redirect = currentHref.startsWith("/login") ? "/studio" : currentHref || "/studio";
      navigate({ to: "/login", search: { redirect }, replace: true });
    }
  }, [currentHref, isAuthenticated, isLoading, navigate, pathname]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main className="w-full px-4 pb-20 pt-2 md:px-10 md:pt-4">
        {isLoading || !isAuthenticated ? (
          <p className="py-16 text-sm text-muted-foreground" role="status">
            {isLoading ? "Loading…" : "Redirecting to sign in…"}
          </p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

