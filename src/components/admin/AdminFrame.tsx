import { Link } from "@tanstack/react-router";
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
  return (
    <AppShell>
      <div className="max-w-6xl space-y-6">
        <h1 className="text-4xl font-black tracking-tight md:text-5xl">Admin</h1>
        <nav aria-label="Admin" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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

