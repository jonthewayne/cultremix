import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { cn } from "~/lib/utils";
import type { Id } from "../../../convex/_generated/dataModel";

export type RemixKind = "variation" | "fork";

// In the publish dialog, for a remix: join the parent's family (the default) or start a new one.
// Renders nothing for a design that isn't a remix.
export function RemixKindChoice({
  generationId,
  value,
  onChange,
  disabled,
}: {
  generationId: Id<"generations">;
  value: RemixKind;
  onChange: (kind: RemixKind) => void;
  disabled?: boolean;
}) {
  const options = useQuery(api.lineage.publishOptions, { generationId });
  if (!options) return null;
  const choices: Array<{ kind: RemixKind; label: string; detail: string }> = [
    {
      kind: "variation",
      label: `A variation of CR ${options.parentCr}`,
      detail: `It joins family ${options.family} as its next number.`,
    },
    {
      kind: "fork",
      label: "This changed the design itself: start a new family",
      detail: `It gets a new family number, and its page says Forked from CR ${options.parentCr}.`,
    },
  ];
  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="text-sm font-bold uppercase tracking-wider">How it relates</legend>
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
              <span className="block font-bold leading-snug">{choice.label}</span>
              <span className="mt-1 block text-sm text-neutral-600">{choice.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
