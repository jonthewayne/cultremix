import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BackButton } from "~/components/social/BackButton";

// A work's Backs: the Back button, the earliest backers in the order the chain recorded them,
// and the viewer's own place in that order.
export function Backers({ workId, cr }: { workId: Id<"works">; cr: string }) {
  const { data } = useQuery(convexQuery(api.backs.forWork, { workId }));
  if (!data) return null;
  const mine = data.viewer?.status === "confirmed" ? data.viewer.ordinal : null;
  const listed = data.earliest.some((backer) => backer.isViewer);
  return (
    <div className="border-t-2 border-black pt-4">
      <p className="text-sm font-bold uppercase tracking-wider">Backers</p>
      <p className="mt-1 text-sm">
        {data.count === 0 ? "No Backs yet." : `${data.count} ${data.count === 1 ? "Back" : "Backs"} recorded on Monad.`}
      </p>
      <div className="mt-3">
        <BackButton workId={workId} cr={cr} />
      </div>
      {mine && <p className="mt-3 font-semibold">You’re backer #{mine}.</p>}
      {data.earliest.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold uppercase tracking-wider">Earliest backers</p>
          <ol className="mt-2 space-y-1">
            {data.earliest.map((backer) => (
              <li key={backer.ordinal} className="flex gap-3 text-sm">
                <span className="w-8 font-mono tabular-nums">#{backer.ordinal}</span>
                <span className={backer.isViewer ? "font-bold" : undefined}>
                  {backer.username ? `@${backer.username}` : "A member"}
                  {backer.isViewer && " (you)"}
                </span>
              </li>
            ))}
            {mine && !listed && (
              <li className="flex gap-3 text-sm">
                <span className="w-8 font-mono tabular-nums">#{mine}</span>
                <span className="font-bold">You</span>
              </li>
            )}
          </ol>
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-500">
        A Back is a public show of support, recorded on Monad. It isn’t a purchase or an investment. Every member gets 3 a week.
      </p>
    </div>
  );
}
