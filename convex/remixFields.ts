import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { adminAllows } from "./lib/adminAccess";
import { requestedWords } from "./lib/prompts";
import {
  MAX_LABEL_LENGTH,
  checkWordChanges,
  inheritRemixFields,
  proposeRemixFields,
  wordChangeInstruction,
} from "./lib/remixFields";
import type { RemixField, WordChange, WordChangeProblem } from "./lib/remixFields";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Remixable words (plan R11, R16). A published work's fields are proposed from its notes when the
// notes are written (images.saveWorkNotes), or carried over from the parent when it's a remix
// (publish.markPublished). The creator, or an admin, switches them on or off and renames them; a
// remix may change only switched-on fields (studio.generate). The browser gets the fields' labels
// and texts, never the notes or the prompt.

type Ctx = QueryCtx | MutationCtx;

// What the studio and the shop page see: switched-on fields only.
const publicField = v.object({ id: v.string(), label: v.string(), text: v.string(), maxLength: v.number() });
const publicChange = v.object({ label: v.string(), from: v.string(), to: v.string() });

function publicFields(fields: Array<RemixField> | undefined) {
  return (fields ?? []).filter((f) => f.on).map((f) => ({ id: f.id, label: f.label, text: f.text, maxLength: f.maxLength }));
}

// The batch a published work came from.
async function sourceBatch(ctx: Ctx, work: Doc<"works">) {
  const generation = await ctx.db.get("generations", work.generationId);
  return generation ? await ctx.db.get("batches", generation.batchId) : null;
}

// The words a published remix changed, when it changed them through the fields.
async function changesOf(ctx: Ctx, work: Doc<"works">) {
  if (!work.parentWorkId) return [];
  const batch = await sourceBatch(ctx, work);
  if (batch?.operation !== "remix") return [];
  return (batch.wordChanges ?? []).map((c) => ({ label: c.label, from: c.from, to: c.to }));
}

// A remix's fields from its parent's, with the new text, when the remix worked on the parent's art
// and its request didn't name other words (then the notes propose them afresh).
async function inheritedFields(ctx: Ctx, work: Doc<"works">) {
  if (!work.parentWorkId) return null;
  const parent = await ctx.db.get("works", work.parentWorkId);
  if (!parent?.remixFields) return null;
  const batch = await sourceBatch(ctx, work);
  if (!batch || batch.operation !== "remix" || batch.inspirationKey !== parent.artKey) return null;
  if (requestedWords(batch.instruction).length > 0) return null;
  return inheritRemixFields(parent.remixFields, batch.wordChanges ?? []);
}

// At publish (publish.markPublished): a remix starts from its parent's fields.
export async function inheritOnPublish(ctx: MutationCtx, workId: Id<"works">) {
  const work = await ctx.db.get("works", workId);
  if (!work || work.remixFields) return;
  const fields = await inheritedFields(ctx, work);
  if (fields) await ctx.db.patch("works", work._id, { remixFields: fields });
}

// When the notes are written (images.saveWorkNotes): fields proposed from their words, unless the
// work already has fields (a remix carrying its parent's).
export async function proposeOnNotes(ctx: MutationCtx, workId: Id<"works">, notes: string) {
  const work = await ctx.db.get("works", workId);
  if (!work || work.remixFields) return;
  await ctx.db.patch("works", work._id, { remixFields: proposeRemixFields(notes) });
}

const PROBLEMS: Record<WordChangeProblem, string> = {
  UNKNOWN_FIELD: "Those words aren't part of this design anymore. Reload and try again.",
  FIELD_LOCKED: "The creator keeps those words as they are.",
  TOO_LONG: "That's a little long for the space.",
  EMPTY: "Add the new words, or leave them as they were.",
  REPEATED: "Each piece of text can be changed once.",
};

// studio.generate: the word changes a remix asks for, checked against the parent's stored fields
// (never the browser's copy of the old text). Undefined when nothing changed.
export async function checkedWordChanges(
  ctx: MutationCtx,
  session: Doc<"creativeSessions">,
  firstImageKey: string | undefined,
  asked: Array<{ fieldId: string; text: string }> | undefined,
): Promise<Array<WordChange> | undefined> {
  if (!asked || asked.length === 0) return undefined;
  const parent = session.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
  if (!parent || parent.status !== "published" || !parent.remixFields || firstImageKey !== parent.artKey) {
    throw new ConvexError({ code: "WORDS_NOT_REMIXABLE", message: "These words can't be changed here." });
  }
  const result = checkWordChanges(parent.remixFields, asked);
  if (!result.ok) {
    const message = result.label && result.problem === "TOO_LONG"
      ? `The ${result.label.toLowerCase()} is a little long for the space.`
      : PROBLEMS[result.problem];
    throw new ConvexError({ code: `WORDS_${result.problem}`, message });
  }
  return result.changes.length > 0 ? result.changes : undefined;
}

// studio's batch prompt: the word-change part, from what the batch recorded and the parent's
// fields for the pieces that stay.
export async function wordChangesPrompt(ctx: QueryCtx, batch: Doc<"batches">, parentId: Id<"works"> | undefined) {
  if (!batch.wordChanges?.length || !parentId) return undefined;
  const parent = await ctx.db.get("works", parentId);
  return wordChangeInstruction(parent?.remixFields ?? [], batch.wordChanges) || undefined;
}

// A published work's remixable words and, for a remix, what it changed. Works signed out.
export const forWork = query({
  args: { workId: v.id("works") },
  returns: v.object({ fields: v.array(publicField), changes: v.array(publicChange) }),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published") return { fields: [], changes: [] };
    return { fields: publicFields(work.remixFields), changes: await changesOf(ctx, work) };
  },
});

// The creator's own work, or any work for an admin who manages; null otherwise.
async function editableWork(ctx: Ctx, workId: Id<"works">) {
  const user = await getViewerUser(ctx);
  if (!user) return null;
  const work = await ctx.db.get("works", workId);
  if (!work || work.status === "withdrawn") return null;
  return work.creatorId === user._id || adminAllows(user.platformRole, "manage") ? work : null;
}

// For the publish reveal and the work page: every field with its switch. fields is null until
// they're ready (the notes are still being written); null for anyone but the creator or an admin.
export const forEditor = query({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      preparing: v.boolean(),
      publishedAt: v.optional(v.number()),
      fields: v.union(
        v.null(),
        v.array(v.object({ id: v.string(), label: v.string(), text: v.string(), on: v.boolean() })),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await editableWork(ctx, args.workId);
    if (!work) return null;
    return {
      preparing: work.status === "preparing",
      publishedAt: work.publishedAt,
      fields: work.remixFields
        ? work.remixFields.map((f) => ({ id: f.id, label: f.label, text: f.text, on: f.on }))
        : null,
    };
  },
});

// The creator (or an admin) switches fields on or off and renames them. The text and the length
// cap come from the design and can't be edited here.
export const update = mutation({
  args: { workId: v.id("works"), fields: v.array(v.object({ id: v.string(), label: v.string(), on: v.boolean() })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await editableWork(ctx, args.workId);
    if (!work) throw new ConvexError({ code: "FORBIDDEN", message: "Only the creator can change this." });
    if (!work.remixFields) throw new ConvexError({ code: "NOT_READY", message: "Still reading the words." });
    const edits = new Map<string, { label: string; on: boolean }>();
    for (const field of args.fields) {
      if (edits.has(field.id) || !work.remixFields.some((f) => f.id === field.id)) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "Those words aren't part of this design." });
      }
      const label = field.label.replace(/\s+/gu, " ").trim();
      if (!label || [...label].length > MAX_LABEL_LENGTH) {
        throw new ConvexError({ code: "INVALID_INPUT", message: `Give each one a name, up to ${MAX_LABEL_LENGTH} characters.` });
      }
      edits.set(field.id, { label, on: field.on });
    }
    await ctx.db.patch("works", work._id, {
      remixFields: work.remixFields.map((f) => ({ ...f, ...edits.get(f.id) })),
    });
    return null;
  },
});

// One-time: fields for works published before remixable words, oldest first so a parent has its
// fields before its remixes inherit them. Works without notes are skipped (run
// imageNotes:backfillWorks first). Run: bunx convex run remixFields:backfill
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ checked: v.number(), saved: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .order("asc")
      .paginate({ numItems: 50, cursor: args.cursor ?? null });
    let saved = 0;
    for (const work of page.page) {
      if (work.remixFields) continue;
      const fields = (await inheritedFields(ctx, work)) ?? (work.notes ? proposeRemixFields(work.notes) : null);
      if (!fields) continue;
      await ctx.db.patch("works", work._id, { remixFields: fields });
      saved++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.remixFields.backfill, { cursor: page.continueCursor });
    return { checked: page.page.length, saved, done: page.isDone };
  },
});
