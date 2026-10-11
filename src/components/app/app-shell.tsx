import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Palette, Shield, UserRound } from "lucide-react";
import {  useEffect } from "react";
import type {ReactNode} from "react";
import { BrandMark } from "~/components/app/brand-mark";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import { isSuperAdminRole, useAuth } from "~/hooks/use-auth";
import { cn } from "~/lib/utils";

const navItems = [
  { to: "/studio", label: "Studio", icon: Palette },
  { to: "/settings", label: "Settings", icon: UserRound },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentHref = useRouterState({ select: (state) => state.location.href });
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const items = isSuperAdminRole(user?.platformRole)
    ? [...navItems, { to: "/admin", label: "Admin", icon: Shield }]
    : navItems;
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const activeItem = items.find((item) => isActive(item.to));

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== "/login") {
      const redirect = currentHref.startsWith("/login")
        ? "/studio"
        : currentHref || "/studio";
      navigate({ to: "/login", search: { redirect }, replace: true });
    }
  }, [currentHref, isAuthenticated, isLoading, navigate, pathname]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Redirecting...
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background p-2 text-foreground md:p-4">
      <div className="flex min-h-[calc(100svh-1rem)] overflow-hidden rounded-xl border bg-background shadow-sm md:min-h-[calc(100svh-2rem)]">
        <aside className="hidden w-72 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
          <div className="flex h-16 items-center border-b border-sidebar-border px-5">
            <Link to="/studio">
              <BrandMark />
            </Link>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-3">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.icon}
                active={isActive(item.to)}
              />
            ))}
          </nav>
          <div className="border-t border-sidebar-border p-3">
            <div className="rounded-lg bg-sidebar-accent/70 px-3 py-2 text-sm text-sidebar-accent-foreground">
              <div className="truncate font-medium">{user?.email ?? "Signed in"}</div>
              <div className="truncate text-xs opacity-70">
                {user?.platformRole ?? "user"}
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex h-16 items-center gap-3 px-4 md:px-6">
              <Link to="/studio" className="md:hidden" aria-label="CultRemix studio">
                <BrandMark showName={false} />
              </Link>
              <div className="hidden min-w-0 items-center gap-3 md:flex">
                <div className="h-5 w-px bg-border" />
                <div>
                  <div className="text-sm font-medium leading-none">
                    {activeItem?.label ?? "CultRemix"}
                  </div>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={signOut}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="size-4" />
                </Button>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto border-t bg-sidebar px-2 py-2 text-sidebar-foreground md:hidden">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.to)}
                  compact
                />
              ))}
            </nav>
          </header>

          <main className="min-w-0 flex-1 bg-background p-4 md:p-6">
            <div className="w-full">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
  compact = false,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
        compact ? "justify-center" : "justify-start",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
