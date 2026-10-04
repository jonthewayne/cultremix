import { useId } from "react";
import { cleanFieldText, length } from "../../../convex/lib/remixWords";
import { cn } from "~/lib/utils";

// A remix's remixable words (convex/remixFields.ts forWork): one input per switched-on piece of
// text, prefilled with the parent's words. Only changed ones are sent; the server checks them
// against the parent's own copy.

export type WordField = { id: string; label: string; text: string; maxLength: number };

// The pieces whose text differs from the parent's, as studio.generate takes them.
export function changedWords(fields: Array<WordField>, values: Record<string, string>) {
  return fields.flatMap((field) => {
    const value = values[field.id];
    return value !== undefined && cleanFieldText(value) !== field.text ? [{ fieldId: field.id, text: value }] : [];
  });
}

// True while a piece is longer than its space allows (the server refuses it too).
export function wordsTooLong(fields: Array<WordField>, values: Record<string, string>) {
  return fields.some((field) => length(cleanFieldText(values[field.id] ?? field.text)) > field.maxLength);
}

export function RemixWordInputs({
  fields,
  values,
  onChange,
}: {
  fields: Array<WordField>;
  values: Record<string, string>;
  onChange: (id: string, text: string) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = values[field.id] ?? field.text;
        const lines = value.split("\n").length;
        const over = length(cleanFieldText(value)) > field.maxLength;
        const changed = cleanFieldText(value) !== field.text;
        const className = cn(
          "mt-1 w-full resize-none border-b-2 bg-transparent py-1 text-xl font-semibold leading-tight outline-none md:text-2xl",
          changed ? "border-black" : "border-neutral-300 focus:border-black",
        );
        return (
          <div key={field.id}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`${baseId}-${field.id}`} className="text-sm font-bold uppercase tracking-wider">
                {field.label}
              </label>
              {changed && (
                <button
                  type="button"
                  onClick={() => onChange(field.id, field.text)}
                  className="text-xs font-semibold text-neutral-500 underline underline-offset-4"
                >
                  Undo
                </button>
              )}
            </div>
            {field.text.includes("\n") ? (
              <textarea
                id={`${baseId}-${field.id}`}
                value={value}
                onChange={(e) => onChange(field.id, e.target.value)}
                rows={Math.min(Math.max(lines, 2), 4)}
                className={className}
              />
            ) : (
              <input id={`${baseId}-${field.id}`} value={value} onChange={(e) => onChange(field.id, e.target.value)} className={className} />
            )}
            {over && (
              <span className="mt-1 block text-sm font-semibold text-red-600">
                Up to {field.maxLength} characters, so it fits the space.
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
