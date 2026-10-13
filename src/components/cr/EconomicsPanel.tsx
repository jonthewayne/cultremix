import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type Panel = NonNullable<FunctionReturnType<typeof api.workEconomics.panel>>;

function roleLabel(role: Panel["shares"][number]["roles"][number], kind: Panel["kind"]) {
  if (role === "creator") return "made this";
  if (role === "family_root") return "started the family";
  if (role === "affiliate") return "shared the link";
  if (role === "brand") return "the brand";
  return kind === "fork" ? "made the design it forked from" : "made the design its family forked from";
}

export function percent(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

function explanation(panel: Panel) {
  const pool = percent(panel.creatorPoolBps);
  const lead = `${pool} of every sale, before tax and shipping, goes to the people behind the design.`;
  if (panel.kind === "original") return `${lead} This is an original, so its creator gets all of it.`;
  if (panel.kind === "fork") return `${lead} A fork shares with the design it came from.`;
  if (panel.shares.some((share) => share.roles.includes("upstream"))) {
    return `${lead} A variation shares with the design that started its family, and that family shares with the design it forked from.`;
  }
  return `${lead} A variation shares with the design that started its family.`;
}

// Who shares in a sale of this work, under the published rules.
export function EconomicsPanel({ cr }: { cr: string }) {
  const panel = useQuery(convexQuery(api.workEconomics.panel, { cr })).data;
  if (!panel) return null;
  return (
    <div className="border-t-2 border-black pt-4">
      <p className="text-sm font-bold uppercase tracking-wider">Who shares in a sale</p>
      <p className="mt-2 text-sm">{explanation(panel)}</p>
      {panel.unavailable ? (
        <p className="mt-3 text-sm text-neutral-500">The split for this design can’t be shown right now.</p>
      ) : (
        <ul aria-label="Split of the creator share" className="mt-3 divide-y divide-neutral-200">
          {panel.shares.map((share) => (
            <li key={share.username} className="flex items-baseline justify-between gap-4 py-2">
              <span className="min-w-0">
                <a href={`/u/${share.username}`} className="font-bold hover:underline">
                  @{share.username}
                </a>
                <span className="text-sm text-neutral-500"> · {share.roles.map((role) => roleLabel(role, panel.kind)).join(" and ")}</span>
              </span>
              <span className="font-cr text-2xl tabular-nums">{percent(share.bps)}</span>
            </li>
          ))}
        </ul>
      )}
      {panel.brand && (
        <p className="mt-3 text-sm">
          <span className="font-bold">{panel.brand.name}</span>{" "}
          <a href={`/u/${panel.brand.username}`} className="text-neutral-500 hover:underline">
            @{panel.brand.username}
          </a>{" "}
          gets {percent(panel.brand.bps)} of the price as the brand behind this family.
        </p>
      )}
      {panel.affiliateBps !== null && (
        <p className="mt-2 text-sm">
          Share it: when your link brings a buyer, you get {percent(panel.affiliateBps)} of the price.
        </p>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Rules version {panel.configVersion} ·{" "}
        <a href={panel.configPath} className="underline underline-offset-2">
          {panel.configPath.replace(/^\//u, "")}
        </a>
      </p>
      <p className="mt-1 break-all font-mono text-xs text-neutral-500">SHA-256 {panel.configSha256}</p>
      <p className="mt-2 text-sm font-semibold">
        {panel.provenance === "confirmed" ? "These shares are recorded on Monad." : "These shares will be recorded on Monad."}
      </p>
    </div>
  );
}
