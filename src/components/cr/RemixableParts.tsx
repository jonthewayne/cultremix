import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "~/lib/imagePrep";
import { offerLine, wordsLine } from "~/lib/remixOffer";
import { cn } from "~/lib/utils";

// Remixable words and parts (convex/remixParts.ts): what people who remix a design may change. The
// creator, or an admin, switches each on or off, names it, and sets its rules: a person can be
// kept, left out, or need a photo when a remix gives none, and a group takes up to a set number of
// photos. "Add a part" turns the creator's own words into one more. Used in the studio's "Make it
// remixable" sheet (a design, before publishing), on the publish reveal, and on the work page.

type Target = { workId: Id<"works"> } | { generationId: Id<"generations"> };
type Tone = "light" | "dark";
type Field = { id: string; label: string; text: string; on: boolean };
type Part = {
  id: string;
  kind: "character" | "person" | "group";
  label: string;
  on: boolean;
  empty?: "keep" | "omit" | "require";
  count?: number;
  max?: number;
  note?: string;
};

const COPY =
  "People who remix this can change what's switched on here. A remix that changes only these joins your family as a variation; bigger changes can start a new family, which still credits you.";
const READING_FOR_MS = 3 * 60_000;
const MAX_LABEL = 40;
const MAX_NOTE = 200;
const KIND_NAMES: Record<Part["kind"], string> = { character: "Swap", person: "Person from a photo", group: "Group from photos" };

const oneLine = (text: string) => text.replace(/\s*\n\s*/gu, " / ");

export function RemixableParts({
  target,
  tone = "light",
  editing: alwaysEditing = false,
  onTry,
  bare = false,
}: {
  target: Target;
  tone?: Tone;
  editing?: boolean;
  // The studio: try the design as a remix with these settings.
  onTry?: () => void;
  // No heading or rule above (the studio sheet has its own).
  bare?: boolean;
}) {
  const editor = useQuery(convexQuery(api.remixParts.editor, { target })).data;
  const update = useMutation(api.remixParts.update);
  const describe = useAction(api.remixPartsActions.describe);
  const [draft, setDraft] = useState<{ fields: Array<Field>; parts: Array<Part> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const now = useNow(Boolean(editor && editor.status === "reading"));

  if (!editor) return null;
  const dark = tone === "dark";
  const muted = dark ? "text-neutral-300" : "text-neutral-600";
  const isDesign = "generationId" in target;

  if (editor.status === "none") return null;
  if (editor.status === "reading") {
    const recent = isDesign || (editor.publishedAt !== undefined && now - editor.publishedAt < READING_FOR_MS) || editor.publishedAt === undefined;
    if (!recent) return null;
    return (
      <Shell dark={dark} bare={bare}>
        <p role="status" className={cn("mt-2 animate-pulse text-base font-semibold", muted)}>
          Reading the design…
        </p>
      </Shell>
    );
  }
  if (editor.status === "failed") {
    return (
      <Shell dark={dark} bare={bare}>
        <p role="alert" className={cn("mt-2 text-base font-semibold", muted)}>Couldn't read this design. Close this and try again.</p>
      </Shell>
    );
  }

  const stored = { fields: editor.fields, parts: editor.parts };
  const editing = alwaysEditing || draft !== null;
  const current = draft ?? stored;
  const dirty = JSON.stringify(current) !== JSON.stringify(stored);
  if (!editing && stored.fields.length === 0 && stored.parts.length === 0) return null;

  const setField = (id: string, patch: Partial<Field>) => {
    setSaved(false);
    setDraft({ ...current, fields: current.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  };
  const setPart = (id: string, patch: Partial<Part>) => {
    setSaved(false);
    setDraft({ ...current, parts: current.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };
  const removePart = (id: string) => {
    setSaved(false);
    setDraft({ ...current, parts: current.parts.filter((p) => p.id !== id) });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await update({
        target,
        fields: current.fields.map(({ id, label, on }) => ({ id, label: label.trim() || "Text", on })),
        parts: current.parts.map(({ id, label, on, empty, max, note }) => ({ id, label: label.trim() || "Part", on, empty, max, note: note ?? "" })),
      });
      setDraft(null);
      setSaved(true);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const words = adding.trim();
    if (!words) return;
    setAddBusy(true);
    setError(null);
    try {
      if (dirty && !(await save())) return;
      const result = await describe({ target, words });
      if (result.added) {
        setAdding("");
        setDraft(null);
      } else {
        setError("Couldn't turn that into a part. Try naming who or what in the design, like “the elves” or “the lion”.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAddBusy(false);
    }
  };

  const tryIt = async () => {
    if (dirty && !(await save())) return;
    onTry?.();
  };

  const input = cn(
    "w-full border-b-2 bg-transparent py-0.5 outline-none",
    dark ? "border-neutral-600 focus:border-white" : "border-neutral-200 focus:border-black",
  );

  return (
    <Shell
      dark={dark}
      bare={bare}
      action={
        !alwaysEditing && !editing ? (
          <button type="button" onClick={() => setDraft(stored)} className="text-sm font-semibold underline underline-offset-4">
            Edit
          </button>
        ) : null
      }
    >
      <p className={cn("mt-1 text-sm", muted)}>{COPY}</p>

      {current.fields.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-black uppercase tracking-widest">Words</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {current.fields.map((field) => (
              <li key={field.id} className="flex items-center gap-3">
                {editing && (
                  <Switch dark={dark} checked={field.on} label={`Let remixes change ${field.label}`} onChange={(on) => setField(field.id, { on })} disabled={saving} />
                )}
                <div className={cn("min-w-0 flex-1", !field.on && "opacity-50")}>
                  {editing ? (
                    <input
                      value={field.label}
                      onChange={(e) => setField(field.id, { label: e.target.value })}
                      maxLength={MAX_LABEL}
                      aria-label={`Name for “${oneLine(field.text)}”`}
                      disabled={saving}
                      className={cn(input, "text-sm font-bold uppercase tracking-wider")}
                    />
                  ) : (
                    <p className="text-sm font-bold uppercase tracking-wider">
                      {field.label}
                      {!field.on && <span className="font-semibold normal-case tracking-normal"> · off</span>}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-lg font-semibold">{oneLine(field.text)}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {(current.parts.length > 0 || editing) && <h3 className="mt-5 text-xs font-black uppercase tracking-widest">Characters and people</h3>}
      {current.parts.length === 0 && editing && (
        <p className={cn("mt-1 text-sm", muted)}>Nothing here yet. Add one below, like “let people swap the lion” or “let people add their family as elves”.</p>
      )}
      <ul className="mt-2 flex flex-col gap-4">
        {current.parts.map((part) => (
          <li key={part.id} className="flex items-start gap-3">
            {editing && (
              <Switch dark={dark} checked={part.on} label={`Let remixes change ${part.label}`} onChange={(on) => setPart(part.id, { on })} disabled={saving} />
            )}
            <div className={cn("min-w-0 flex-1", !part.on && "opacity-50")}>
              <div className="flex items-center gap-2">
                {editing ? (
                  <input
                    value={part.label}
                    onChange={(e) => setPart(part.id, { label: e.target.value })}
                    maxLength={MAX_LABEL}
                    aria-label="Part name"
                    disabled={saving}
                    className={cn(input, "text-lg font-bold")}
                  />
                ) : (
                  <p className="text-lg font-bold">{part.label}</p>
                )}
                {editing && (
                  <button
                    type="button"
                    onClick={() => removePart(part.id)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black hover:opacity-70"
                    aria-label={`Remove ${part.label}`}
                  >
                    ×
                  </button>
                )}
              </div>
              <p className={cn("text-xs font-semibold uppercase tracking-wider", muted)}>
                {KIND_NAMES[part.kind]}
                {part.kind === "group" && part.count ? ` · ${part.count} in the design` : ""}
              </p>
              {editing && part.kind === "person" && (
                <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className={muted}>Without a photo</span>
                  <select
                    value={part.empty ?? "keep"}
                    onChange={(e) => setPart(part.id, { empty: e.target.value as Part["empty"] })}
                    disabled={saving}
                    className={cn("h-9 rounded-lg border-2 px-2 font-semibold", dark ? "border-white bg-black" : "border-black bg-white")}
                  >
                    <option value="keep">keep the original</option>
                    <option value="omit">leave them out</option>
                    <option value="require">ask for a photo</option>
                  </select>
                </label>
              )}
              {editing && part.kind === "group" && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <span className={muted}>Up to</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={part.max ?? 6}
                    onChange={(e) => setPart(part.id, { max: Math.max(1, Math.min(8, Math.round(Number(e.target.value) || 1))) })}
                    disabled={saving}
                    className={cn("h-9 w-16 rounded-lg border-2 px-2 font-semibold", dark ? "border-white bg-black" : "border-black bg-white")}
                  />
                  <span className={muted}>photos</span>
                </label>
              )}
              {editing && (
                <input
                  value={part.note ?? ""}
                  onChange={(e) => setPart(part.id, { note: e.target.value })}
                  maxLength={MAX_NOTE}
                  placeholder="Note on how to draw it (optional)"
                  aria-label={`Note for ${part.label}`}
                  disabled={saving}
                  className={cn(input, "mt-2 text-sm")}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            maxLength={300}
            placeholder="Add a part: “let people add their family as elves”"
            aria-label="Describe a part people can change"
            disabled={addBusy || saving}
            className={cn(input, "min-w-0 flex-1 text-base")}
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={addBusy || saving || !adding.trim()}
            className={cn("h-10 rounded-xl border-2 px-4 text-sm font-bold disabled:opacity-40", dark ? "border-white" : "border-black")}
          >
            {addBusy ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className={cn("mt-3 text-sm font-semibold", dark ? "text-red-300" : "text-red-600")}>
          {error}
        </p>
      )}
      {editing && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className={cn("h-11 rounded-xl px-5 text-base font-black disabled:opacity-40", dark ? "bg-white text-black" : "bg-black text-white")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {onTry && (
            <button
              type="button"
              onClick={() => void tryIt()}
              disabled={saving}
              className={cn("h-11 rounded-xl border-2 px-5 text-base font-black disabled:opacity-40", dark ? "border-white" : "border-black")}
            >
              Try it as a remix
            </button>
          )}
          {!alwaysEditing && (
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={saving}
              className="text-sm font-semibold underline underline-offset-4"
            >
              Cancel
            </button>
          )}
          {saved && !dirty && <span role="status" className={cn("text-sm font-semibold", muted)}>Saved</span>}
        </div>
      )}
      {!editing && saved && <p role="status" className={cn("mt-3 text-sm font-semibold", muted)}>Saved</p>}
    </Shell>
  );
}

function Shell({ dark, bare, action, children }: { dark: boolean; bare?: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  if (bare) return <div>{children}</div>;
  return (
    <section className={cn("border-t-2 pt-4", dark ? "border-white" : "border-black")}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-bold uppercase tracking-wider">Remixable parts</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Switch({ checked, onChange, label, disabled, dark }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; dark: boolean }) {
  const ink = dark ? "white" : "black";
  const paper = dark ? "black" : "white";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative mt-0.5 inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-40"
      style={{ borderColor: ink, background: checked ? ink : paper }}
    >
      <span className={cn("inline-block size-5 rounded-full transition-transform", checked ? "translate-x-7" : "translate-x-1")} style={{ background: checked ? paper : ink }} />
    </button>
  );
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

// Under Remix this on a work page: what a remix of it can change, its remixable words and parts, so
// a visitor knows before starting. Works signed out. Its creator and admins see the editor above
// instead (RemixableParts), so it stays out of their way.
export function RemixOffer({ workId }: { workId: Id<"works"> }) {
  const words = useQuery(convexQuery(api.remixFields.forWork, { workId })).data?.fields;
  const parts = useQuery(convexQuery(api.remixParts.forWork, { workId })).data?.parts;
  const editor = useQuery(convexQuery(api.remixParts.editor, { target: { workId } }));
  if (!editor.isSuccess || editor.data || !words || !parts) return null;
  if (words.length === 0 && parts.length === 0) return null;
  return (
    <div className="-mt-2 text-sm">
      <p className="font-bold uppercase tracking-wider">A remix can change</p>
      <ul className="mt-1 space-y-0.5 text-neutral-700">
        {words.length > 0 && <li>The words {wordsLine(words.map((word) => word.text))}</li>}
        {parts.map((part) => (
          <li key={part.id}>{offerLine(part)}</li>
        ))}
      </ul>
    </div>
  );
}

// Under a remix's lineage: the parts it changed from its parent. Works signed out.
export function PartChangesNote({ workId }: { workId: Id<"works"> }) {
  const changes = useQuery(convexQuery(api.remixParts.forWork, { workId })).data?.changes ?? "";
  if (!changes) return null;
  return <p className="mt-2 text-lg">Changed: <span className="font-bold">{changes}</span></p>;
}

