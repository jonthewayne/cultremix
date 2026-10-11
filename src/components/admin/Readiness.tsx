import { useQuery } from "convex/react";
import { Check } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { AdminSection } from "~/components/admin/AdminSection";
import { cn } from "~/lib/utils";

const GROUPS = [
  { group: "shop", title: "Orders" },
  { group: "monad", title: "Monad records" },
] as const;

// What still stands between this deployment and real orders and Monad records
// (convex/admin.ts readiness), in the order to do it.
export function Readiness() {
  const items = useQuery(api.admin.readiness, {});
  if (!items) return null;
  const done = items.filter((item) => item.ok).length;
  return (
    <AdminSection
      title="Ready to sell"
      description={
        done === items.length
          ? "Everything is in place for real orders and Monad records."
          : `${done} of ${items.length} in place. What's left, in the order to do it:`
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {GROUPS.map(({ group, title }) => (
          <div key={group}>
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
            <ul className="mt-2 divide-y divide-border">
              {items
                .filter((item) => item.group === group)
                .map((item) => (
                  <li key={item.key} className="flex gap-3 py-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                        item.ok ? "bg-foreground text-background" : "border-2 border-muted-foreground",
                      )}
                    >
                      {item.ok && <Check aria-hidden strokeWidth={3} className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="font-black">
                        {item.label}
                        <span className="sr-only">{item.ok ? ": done" : ": not yet"}</span>
                      </span>
                      <span className={cn("block break-words text-sm", item.ok ? "text-muted-foreground" : "text-foreground")}>{item.detail}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </AdminSection>
  );
}
