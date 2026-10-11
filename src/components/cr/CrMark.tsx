import { TestnetTag } from "~/components/cr/DeploymentLabel";
import { cn } from "~/lib/utils";

// The CR number lockup: the brand element. Big, blocky digits. Off production it carries
// a Testnet tag, since those numbers are recorded on Monad testnet. The number never breaks at its
// hyphen; when space runs out the tag moves to the next line instead. noTag leaves the tag off where
// every number around it would carry one in too little room, such as a family tree's nodes; the
// page's header already says Testnet.
export function CrMark({ cr, className, noTag = false }: { cr: string; className?: string; noTag?: boolean }) {
  return (
    <span className={cn("font-cr inline-flex flex-wrap items-baseline gap-[0.22em] leading-[0.85]", className)}>
      <span className="inline-flex items-baseline gap-[0.22em] whitespace-nowrap">
        <span>CR</span>
        <span className="tabular-nums">{cr}</span>
      </span>
      {!noTag && <TestnetTag />}
    </span>
  );
}
