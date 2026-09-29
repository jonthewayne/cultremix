import { cn } from "~/lib/utils";

// The CR number lockup: the brand element. Big, blocky digits.
export function CrMark({ cr, className }: { cr: string; className?: string }) {
  return (
    <span className={cn("font-cr inline-flex items-baseline gap-[0.22em] leading-[0.85]", className)}>
      <span>CR</span>
      <span className="tabular-nums">{cr}</span>
    </span>
  );
}
