import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { cn } from "~/lib/utils";
import type { Id } from "../../../convex/_generated/dataModel";

export type RemixKind = "variation" | "fork";

// In the publish dialog, for a remix: join the parent's family or start a new one. A remix that
// changed only the parent's remixable words is a variation, with nothing to choose; one that changed
// more offers both, with fork pre-selected by the dialog (convex/lib/lineage.ts
// remixChangedOnlyWords). Renders nothing for a design that isn't a remix.
export function RemixKindChoice({
  generationId,
  value,
  onChange,
  forkAllowed,
  disabled,
}: {
  generationId: Id<"generations">;
  value: RemixKind;
  onChange: (kind: RemixKind) => void;
  forkAllowed: boolean;
  disabled?: boolean;
}) {
  const options = useQuery(api.lineage.publishOptions, { generationId });
  if (!options) return null;
  const variation = {
    kind: "variation" as const,
    label: `A variation of CR ${options.parentCr}`,
    detail: `It joins family ${options.family} as its next number.`,
  };
  if (!forkAllowed) {
    return (
      <div className="mt-6">
        <p className="text-sm font-bold uppercase tracking-wider">How it relates</p>
        <div className="mt-3 rounded-2xl border-2 border-black bg-neutral-100 p-4">
          <p className="font-bold leading-snug">{variation.label}</p>
          <p className="mt-1 text-sm text-neutral-600">
            You changed only its remixable words, so it joins family {options.family} as its next number.
          </p>
        </div>
      </div>
    );
  }
  const choices: Array<{ kind: RemixKind; label: string; detail: string; suggested?: boolean }> = [
    {
      kind: "fork",
      label: "This changed the design itself: start a new family",
      detail: `It gets a new family number, and its page says Forked from CR ${options.parentCr}.`,
      suggested: true,
    },
    variation,
  ];
  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="text-sm font-bold uppercase tracking-wider">How it relates</legend>
      <p className="mt-1 text-sm text-neutral-600">
        You changed more than its remixable words, so it can start its own family. CR {options.parentCr} stays credited either way.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {choices.map((choice) => (
          <label
            key={choice.kind}
            className={cn(
              "flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition-colors",
              value === choice.kind ? "border-black bg-neutral-100" : "border-neutral-200 hover:border-neutral-400",
            )}
          >
            <input
              type="radio"
              name="remixKind"
              value={choice.kind}
              checked={value === choice.kind}
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
