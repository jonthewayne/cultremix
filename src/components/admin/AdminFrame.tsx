import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AppShell } from "~/components/app/app-shell";

const tabs = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/members", label: "Members", exact: false },
  { to: "/admin/metrics", label: "Metrics", exact: false },
  { to: "/admin/judges", label: "Judges", exact: false },
  { to: "/admin/lineage", label: "Lineage", exact: false },
  { to: "/admin/products", label: "Products", exact: false },
  { to: "/admin/sale", label: "For sale", exact: false },
  { to: "/admin/orders", label: "Orders", exact: false },
  { to: "/admin/payouts", label: "Payouts", exact: false },
  { to: "/admin/waitlist", label: "Waitlist", exact: false },
  { to: "/admin/chain", label: "Monad", exact: false },
] as const;

// Admin's title and tabs around a tab's page. The Monad tab lives at its own route
// (admin_.chain.tsx) and uses this frame too, so the tabs stay put on every tab.
export function AdminFrame({ children }: { children: ReactNode }) {
  const row = useRef<HTMLElement>(null);
  const path = useRouterState({ select: (state) => state.location.pathname });
  // On a phone the tabs scroll sideways: center the open one, so Judges or Monad isn't cut off.
  useEffect(() => {
    const nav = row.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"], [data-status="active"]');
    if (!nav || !active) return;
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [path]);
  return (
    <AppShell>
      <div className="max-w-6xl space-y-6">
        <h1 className="text-4xl font-black tracking-tight md:text-5xl">Admin</h1>
        <nav ref={row} aria-label="Admin" className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.exact }}
              className="inline-flex h-10 shrink-0 items-center rounded-full border-2 border-border px-4 text-sm font-bold"
              activeProps={{ className: "border-foreground bg-foreground text-background" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </AppShell>
  );
}
