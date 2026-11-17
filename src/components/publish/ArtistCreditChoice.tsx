import { useState } from "react";
import { cn } from "~/lib/utils";

export type ArtistDraft = { name: string; link: string };

// In the publish sheet: "Inspired by a known artist?" Up to three, each a name and a link to their
// work. Their share comes out of the publisher's own part of each sale (docs/decisions.md).
export function ArtistCreditChoice({
  value,
  onChange,
  disabled,
}: {
  value: Array<ArtistDraft>;
  onChange: (next: Array<ArtistDraft>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(value.length > 0);
  const rows = value.length > 0 ? value : [{ name: "", link: "" }];
  const set = (i: number, patch: Partial<ArtistDraft>) => onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-bold uppercase tracking-wider">Inspired by an artist?</legend>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-left text-sm font-semibold underline underline-offset-4">
          Credit a known artist with a distinctive style
        </button>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-neutral-600">
            Optional. If this clearly comes from a known artist's style, credit them. A fifth of your share of each sale is set aside for
            them, and they can claim it. Up to three.
          </p>
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
              <input
                aria-label={`Artist ${i + 1} name`}
                value={row.name}
                onChange={(e) => set(i, { name: e.target.value })}
                maxLength={60}
                placeholder="Artist's name"
                className="h-11 rounded-xl border-2 border-neutral-200 px-3 outline-none focus:border-black"
              />
              <input
                aria-label={`Artist ${i + 1} link`}
                value={row.link}
                onChange={(e) => set(i, { link: e.target.value })}
                maxLength={300}
                inputMode="url"
                placeholder="Link to their work"
                className="h-11 rounded-xl border-2 border-neutral-200 px-3 outline-none focus:border-black"
              />
              <button
                type="button"
                onClick={() => {
                  const next = rows.filter((_, j) => j !== i);
                  onChange(next);
                  if (next.length === 0) setOpen(false);
                }}
                className="h-11 px-2 text-sm font-semibold underline underline-offset-4"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={rows.length >= 3}
            onClick={() => onChange([...rows, { name: "", link: "" }])}
            className={cn("text-sm font-semibold underline underline-offset-4", rows.length >= 3 && "opacity-40")}
          >
            Add another artist
          </button>
        </div>
      )}
    </fieldset>
  );
}

// The rows worth sending: any with a name or a link (the server says what's missing).
export function artistsToSend(rows: Array<ArtistDraft>) {
  const filled = rows.filter((row) => row.name.trim() || row.link.trim());
  return filled.length > 0 ? filled.map((row) => ({ name: row.name.trim(), link: row.link.trim() })) : undefined;
}
