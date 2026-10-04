import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { cn } from "~/lib/utils";

// Which label this environment wears (convex/deployment.ts): "testnet" off production,
// "early_access" on production until checkout opens, otherwise none.
export function useDeploymentLabel() {
  return useQuery(convexQuery(api.deployment.get, {})).data?.label ?? null;
}

// The header pill: Early access or Testnet.
export function DeploymentPill({ className }: { className?: string }) {
  const label = useDeploymentLabel();
  if (!label) return null;
  return (
    <span
      className={cn(
        "rounded-full border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] md:text-xs",
        label === "testnet" && "bg-black text-white",
        className,
      )}
    >
      {label === "testnet" ? "Testnet" : "Early access"}
    </span>
  );
}

// Sits beside a CR number; sized from the number's own font size so it reads at every scale.
export function TestnetTag({ className }: { className?: string }) {
  const label = useDeploymentLabel();
  if (label !== "testnet") return null;
  return (
    <span
      title="Recorded on Monad testnet"
      className={cn(
        "self-start rounded-full bg-black px-[0.7em] py-[0.25em] font-sans text-[max(0.625rem,0.11em)] font-black uppercase leading-none tracking-[0.12em] text-white",
        className,
      )}
    >
      Testnet
    </span>
  );
}
