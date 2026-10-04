import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { api } from "../../../convex/_generated/api";
import { CrMark } from "./CrMark";
import type { FunctionReturnType } from "convex/server";

type Trail = NonNullable<FunctionReturnType<typeof api.lineage.trail>>;
type Step = Trail["steps"][number];

function useTrail(cr: string) {
  return useQuery(convexQuery(api.lineage.trail, { cr })).data ?? null;
}

const CrLink = ({ cr, className }: { cr: string; className?: string }) => (
  <Link to="/cr/$cr" params={{ cr }} className={className ?? "font-bold underline underline-offset-4"}>
    CR {cr}
  </Link>
);

// Under the title: where this work comes from, and whether its lineage was corrected.
export function LineageNote({ cr }: { cr: string }) {
  const trail = useTrail(cr);
  if (!trail) return null;
  const parent = trail.steps[0];
  return (
    <div className="mt-3 space-y-2 text-lg">
      {parent && trail.kind === "fork" && (
        <p>
          Forked from <CrLink cr={parent.cr} /> <span className="text-neutral-500">· started family {trail.family}</span>
        </p>
      )}
      {parent && trail.kind === "variation" && (
        <p>
          A variation of <CrLink cr={parent.cr} />
        </p>
      )}
      {!parent && trail.kind === "original" && <p className="text-neutral-500">An original. It started family {trail.family}.</p>}
      {(trail.pending || trail.amended) && (
        <p className="flex flex-wrap gap-2 text-sm font-bold">
          {trail.pending && <span className="rounded-full bg-amber-200 px-3 py-1">Correction pending</span>}
          {trail.amended && <span className="rounded-full bg-neutral-200 px-3 py-1">Lineage amended</span>}
        </p>
      )}
    </div>
  );
}

// Groups the trail into families, origin first, ending with this work.
function families(steps: Array<Step>, self: { cr: string; family: number }) {
  const ordered = [...steps].reverse();
  const groups: Array<{ family: number; works: Array<{ cr: string; username?: string; published: boolean }>; forked: boolean }> = [];
  ordered.forEach((step, index) => {
    // A step's `via` says how the next work down came from it; a fork means the next work is a new family.
    const previous = ordered[index - 1];
    if (!previous || previous.via === "fork" || groups.at(-1)?.family !== step.family) {
      groups.push({ family: step.family, works: [], forked: previous?.via === "fork" });
    }
    groups.at(-1)!.works.push({ cr: step.cr, username: step.username, published: step.published });
  });
  const last = ordered.at(-1);
  if (!last || last.via === "fork" || groups.at(-1)?.family !== self.family) {
    groups.push({ family: self.family, works: [], forked: last?.via === "fork" });
  }
  groups.at(-1)!.works.push({ cr: self.cr, published: true });
  return groups;
}

const KIND_WORD = { original: "an original", variation: "a variation", fork: "a fork" } as const;

function describe(row: Trail["history"][number]) {
  const was = row.fromParentCr ? `${KIND_WORD[row.fromKind]} of CR ${row.fromParentCr}` : KIND_WORD[row.fromKind];
  const now = row.newParentCr ? `${KIND_WORD[row.newKind]} of CR ${row.newParentCr}` : KIND_WORD[row.newKind];
  return { was, now };
}

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// The full lineage: every ancestor back to the origin, grouped by family, plus corrections.
export function LineageSection({ cr }: { cr: string }) {
  const trail = useTrail(cr);
  if (!trail) return null;
  if (trail.steps.length === 0 && trail.history.length === 0 && !trail.broken) return null;
  const groups = families(trail.steps, { cr, family: trail.family });
  return (
    <section className="mt-20">
      <h2 className="border-t-2 border-black pt-4 text-sm font-bold uppercase tracking-wider">Lineage</h2>
      {trail.truncated && <p className="mt-4 text-sm text-neutral-500">Earlier works are further back than this shows.</p>}
      {trail.broken && <p className="mt-4 text-sm text-neutral-500">Part of this lineage can’t be shown right now.</p>}
      <ol className="mt-6 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-stretch">
        {groups.map((group, groupIndex) => (
          <Fragment key={`${group.family}-${groupIndex}`}>
            {group.forked && (
              <li aria-hidden className="flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider text-neutral-500 md:flex-col md:justify-center">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
                forked
              </li>
            )}
            <li className="rounded-2xl border-2 border-black p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Family {group.family}</p>
              <ol className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                {group.works.map((work, index) => (
                  <li key={work.cr} className="flex items-baseline gap-3">
                    {index > 0 && <span aria-hidden className="text-neutral-400">→</span>}
                    {work.cr === cr ? (
                      <span aria-current="page">
                        <CrMark cr={work.cr} className="text-2xl" />
                        <span className="ml-2 text-sm text-neutral-500">this one</span>
                      </span>
                    ) : (
                      <span>
                        <Link to="/cr/$cr" params={{ cr: work.cr }} className={work.published ? "hover:underline" : "text-neutral-400"}>
                          <CrMark cr={work.cr} className="text-2xl" />
                        </Link>
                        {work.username && (
                          <a href={`/u/${work.username}`} className="ml-2 text-sm hover:underline">
                            @{work.username}
                          </a>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          </Fragment>
        ))}
      </ol>
      {trail.history.length > 0 && (
        <div className="mt-6 rounded-2xl bg-neutral-100 p-4 text-sm">
          <p className="font-bold">{trail.amended ? "This lineage was amended." : "A correction to this lineage is pending."}</p>
          <ul className="mt-2 space-y-2">
            {trail.history.map((row) => {
              const { was, now } = describe(row);
              return (
                <li key={row.sequence}>
                  {row.status === "confirmed"
                    ? `${day(row.effectiveFrom ?? row.requestedAt)}: changed from ${was} to ${now}.`
                    : `Pending: ${was} to ${now}.`}{" "}
                  <span className="text-neutral-600">“{row.reason}”</span>
                  {row.offchainOnly && <span className="text-neutral-500"> Not yet recorded on Monad.</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-neutral-500">The original record stays as published. Sales before a change keep their split.</p>
        </div>
      )}
    </section>
  );
}
