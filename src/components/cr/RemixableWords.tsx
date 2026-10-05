import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { changeSummary } from "../../../convex/lib/remixWords";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "~/lib/imagePrep";
import { cn } from "~/lib/utils";

// Remixable words (convex/remixFields.ts): the creator, or an admin, picks which words a remix
// offers as boxes to edit, and what each one is called. A remix that changes only these stays a
// variation in the family; bigger changes can start a new family that credits the creator.

const COPY =
  "People who remix this get these words as boxes to edit. A remix that changes only these joins your family as a variation; bigger changes can start a new family, which still credits you.";
const MAX_LABEL = 40;
// The notes usually arrive within a minute of publishing; after a few, stop saying so.
const READING_FOR_MS = 3 * 60_000;

type Field = { id: string; label: string; text: string; on: boolean };
type Tone = "light" | "dark";

// Text with its line breaks shown as a slash, for one-line lists.
const oneLine = (text: string) => text.replace(/\s*\n\s*/gu, " / ");

// On the publish reveal (tone "dark", always editing) and the work page (an Edit control). Shows
// nothing for anyone but the creator or an admin, or for a design with no words.
export function RemixableWords({ workId, tone = "light", editing: alwaysEditing = false }: { workId: Id<"works">; tone?: Tone; editing?: boolean }) {
  const editor = useQuery(convexQuery(api.remixFields.forEditor, { workId })).data;
  const update = useMutation(api.remixFields.update);
  const [draft, setDraft] = useState<Array<Field> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(Boolean(editor && editor.fields === null));

  if (!editor) return null;
  const dark = tone === "dark";
  const muted = dark ? "text-neutral-300" : "text-neutral-600";

  if (editor.fields === null) {
    const recent = editor.preparing || (editor.publishedAt !== undefined && now - editor.publishedAt < READING_FOR_MS);
    if (!recent) return null;
    return (
      <Shell dark={dark}>
        <p role="status" className={cn("mt-2 animate-pulse text-base font-semibold", muted)}>
          Reading the words…
        </p>
      </Shell>
    );
  }
  if (editor.fields.length === 0) return null;

  const fields = editor.fields;
  const editing = alwaysEditing || draft !== null;
  const current = draft ?? fields;
  const dirty = current.some((field, i) => field.label !== fields[i]?.label || field.on !== fields[i]?.on);
  const change = (id: string, patch: Partial<Field>) => {
    setSaved(false);
    setDraft(current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await update({ workId, fields: current.map(({ id, label, on }) => ({ id, label: label.trim() || labelOf(fields, id), on })) });
      setDraft(null);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell
      dark={dark}
      action={
        !alwaysEditing && !editing ? (
          <button type="button" onClick={() => setDraft(fields)} className="text-sm font-semibold underline underline-offset-4">
            Edit
          </button>
        ) : null
      }
    >
      <p className={cn("mt-1 text-sm", muted)}>{COPY}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {current.map((field) => (
          <li key={field.id} className="flex items-center gap-3">
            {editing ? (
              <Switch dark={dark} checked={field.on} label={`Offer ${field.label} as a box to edit`} onChange={(on) => change(field.id, { on })} disabled={saving} />
            ) : null}
            <div className={cn("min-w-0 flex-1", !field.on && "opacity-50")}>
              {editing ? (
                <input
                  value={field.label}
                  onChange={(e) => change(field.id, { label: e.target.value })}
                  maxLength={MAX_LABEL}
                  aria-label={`Name for “${oneLine(field.text)}”`}
                  disabled={saving}
                  className={cn(
                    "w-full border-b-2 bg-transparent py-0.5 text-sm font-bold uppercase tracking-wider outline-none",
                    dark ? "border-neutral-600 focus:border-white" : "border-neutral-200 focus:border-black",
                  )}
                />
              ) : (
                <p className="text-sm font-bold uppercase tracking-wider">
                  {field.label}
                  {!field.on && <span className="font-semibold normal-case tracking-normal"> · no box</span>}
                </p>
              )}
              <p className="mt-0.5 truncate text-lg font-semibold">{oneLine(field.text)}</p>
            </div>
          </li>
        ))}
      </ul>
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
            className={cn(
              "h-11 rounded-xl px-5 text-base font-black disabled:opacity-40",
              dark ? "bg-white text-black" : "bg-black text-white",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {!alwaysEditing && (
            <button type="button" onClick={() => { setDraft(null); setError(null); }} disabled={saving} className="text-sm font-semibold underline underline-offset-4">
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

function labelOf(fields: Array<Field>, id: string) {
  return fields.find((field) => field.id === id)?.label ?? "Text";
}

function Shell({ dark, action, children }: { dark: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={cn("border-t-2 pt-4", dark ? "border-white" : "border-black")}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-bold uppercase tracking-wider">Remixable words</h2>
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
      className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-40"
      style={{ borderColor: ink, background: checked ? ink : paper }}
    >
      <span
        className={cn("inline-block size-5 rounded-full transition-transform", checked ? "translate-x-7" : "translate-x-1")}
        style={{ background: checked ? paper : ink }}
      />
    </button>
  );
}

// The clock, ticking only while it's needed.
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

// Under a remix's lineage: the words it changed from its parent. Works signed out.
export function WordChangesNote({ workId }: { workId: Id<"works"> }) {
  const changes = useQuery(convexQuery(api.remixFields.forWork, { workId })).data?.changes ?? [];
  if (changes.length === 0) return null;
  return <p className="mt-2 text-lg">Changed the words: <span className="font-bold">{changeSummary(changes)}</span></p>;
}
