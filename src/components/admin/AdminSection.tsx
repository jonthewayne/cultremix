import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// A rounded block on the admin pages.
export function AdminSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border-2 border-border bg-card p-4 text-card-foreground md:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-black tracking-tight md:text-2xl">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export const adminInput =
  "h-11 rounded-xl border-2 border-border bg-background px-3 text-base text-foreground outline-none focus-visible:border-foreground";

export const adminButton =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-black text-background transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-40";

export const adminQuietButton =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-xl border-2 border-border px-4 text-sm font-bold transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-foreground transition-colors disabled:opacity-40",
        checked ? "bg-foreground" : "bg-background",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full transition-transform",
          checked ? "translate-x-7 bg-background" : "translate-x-1 bg-foreground",
        )}
      />
    </button>
  );
}
