import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { cn } from "~/lib/utils";
import type { Id } from "../../../convex/_generated/dataModel";

export type RemixKind = "variation" | "fork";

// How a remix relates to the design it remixes (convex/publish.ts remixRelation): changed only its
// remixable words ("words"), not compared yet ("none", "pending"), compared ("variation", "fork"),
// or the comparison couldn't run ("failed").
export type RemixRelation = {
  status: "words" | "none" | "pending" | "variation" | "fork" | "failed";
  reason?: string;
};

// In the publish dialog, for a remix: join the parent's family or start a new one. A remix that
// changed only its words, or that reads as the same design, is a variation with nothing to choose.
// One that reads as a new design offers both, with fork suggested; while it's being compared, the
// fork option waits. Renders nothing for a design that isn't a remix.
export function RemixKindChoice({
  generationId,
  value,
  onChange,
  relation,
  disabled,
}: {
  generationId: Id<"generations">;
  value: RemixKind;
  onChange: (kind: RemixKind) => void;
  relation: RemixRelation;
  disabled?: boolean;
}) {
  const options = useQuery(api.lineage.publishOptions, { generationId });
  if (!options) return null;
  const parent = `CR ${options.parentCr}`;
  const joins = `It joins family ${options.family} as its next number.`;
  const variationLabel = `A variation of ${parent}`;
  const forkLabel = "This changed the design itself: start a new family";
  const forkDetail = `It gets a new family number, and its page says Forked from ${parent}.`;

  if (relation.status === "words" || relation.status === "variation") {
    const why =
      relation.status === "words"
        ? `You changed only its remixable words, so it joins family ${options.family} as its next number.`
        : `${relation.reason ? `${relation.reason} ` : ""}It reads as the same design with changes, so it joins family ${options.family} as its next number.`;
    return (
      <div className="mt-6">
        <p className="text-sm font-bold uppercase tracking-wider">How it relates</p>
        <div className="mt-3 rounded-2xl border-2 border-black bg-neutral-100 p-4">
          <p className="font-bold leading-snug">{variationLabel}</p>
          <p className="mt-1 text-sm text-neutral-600">{why}</p>
        </div>
      </div>
    );
  }

  const comparing = relation.status === "none" || relation.status === "pending";
  const intro = comparing
    ? `Comparing it with ${parent}…`
    : relation.status === "fork"
      ? `${relation.reason ? `${relation.reason} ` : ""}It reads as a new design, so it can start its own family. ${parent} stays credited either way.`
      : `We couldn't compare it with ${parent}, so choose how it relates. ${parent} stays credited either way.`;
  const choices: Array<{ kind: RemixKind; label: string; detail: string; suggested?: boolean; waiting?: boolean }> = [
    {
      kind: "fork",
      label: forkLabel,
      detail: comparing ? "Available if it reads as a new design." : forkDetail,
      suggested: relation.status === "fork",
      waiting: comparing,
    },
    { kind: "variation", label: variationLabel, detail: joins },
  ];
  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="text-sm font-bold uppercase tracking-wider">How it relates</legend>
      <p role="status" className={cn("mt-1 text-sm text-neutral-600", comparing && "animate-pulse")}>
        {intro}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {choices.map((choice) => (
          <label
            key={choice.kind}
            className={cn(
              "flex gap-3 rounded-2xl border-2 p-4 transition-colors",
              choice.waiting ? "cursor-not-allowed border-neutral-200 opacity-60" : "cursor-pointer",
              !choice.waiting && (value === choice.kind ? "border-black bg-neutral-100" : "border-neutral-200 hover:border-neutral-400"),
            )}
          >
            <input
              type="radio"
              name="remixKind"
              value={choice.kind}
              checked={value === choice.kind}
              disabled={choice.waiting}
              onChange={() => onChange(choice.kind)}
              className="mt-1 h-4 w-4 shrink-0 accent-black"
            />
            <span>
              <span className="block font-bold leading-snug">
                {choice.label}
                {choice.suggested && (
                  <span className="ml-2 inline-block rounded-full bg-black px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-white">
                    Suggested
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-neutral-600">{choice.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
