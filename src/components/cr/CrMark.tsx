import { TestnetTag } from "~/components/cr/DeploymentLabel";
import { cn } from "~/lib/utils";

// The CR number lockup: the brand element. Big, blocky digits. Off production it carries
// a Testnet tag, since those numbers are recorded on Monad testnet. The number never breaks at its
// hyphen; when space runs out the tag moves to the next line instead.
export function CrMark({ cr, className }: { cr: string; className?: string }) {
  return (
    <span className={cn("font-cr inline-flex flex-wrap items-baseline gap-[0.22em] leading-[0.85]", className)}>
      <span className="inline-flex items-baseline gap-[0.22em] whitespace-nowrap">
        <span>CR</span>
        <span className="tabular-nums">{cr}</span>
      </span>
      <TestnetTag />
    </span>
  );
}
