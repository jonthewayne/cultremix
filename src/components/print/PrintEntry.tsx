import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import { readyLine } from "~/lib/print/check";
import type { CheckItem } from "~/lib/print/check";
import { cn } from "~/lib/utils";

// On the work page: the print file's status line, and a quiet "Prepare for print" link for the
// creator (and the owner).
export function PrintEntry({ cr }: { cr: string }) {
  const entry = useQuery(convexQuery(api.print.entry, { cr })).data;
  if (!entry || (!entry.canPrepare && !entry.ready)) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
      {entry.ready ? (
        <span className="font-semibold">{readyLine(entry.ready.dpi, entry.ready.widthIn)}</span>
      ) : (
        <span className="text-muted-foreground">No print file yet.</span>
      )}
      {entry.canPrepare && (
        <Link to="/print/$cr" params={{ cr }} className="font-bold underline underline-offset-4">
          {entry.ready ? "See the print file" : "Prepare for print"}
        </Link>
      )}
    </div>
  );
}

const MARK: Record<CheckItem["status"], string> = { ok: "✓", warn: "!", refuse: "✕" };
const TONE: Record<CheckItem["status"], string> = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-amber-400 text-black",
  refuse: "bg-red-600 text-white",
};

export function PrintCheckList({ items }: { items: Array<CheckItem> }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-3 text-sm">
          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black", TONE[item.status])}>
            {MARK[item.status]}
          </span>
          <span className={item.status === "ok" ? undefined : "font-semibold"}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
