import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { ensureUserImage } from "./images";
import { adminAllows } from "./lib/adminAccess";
import { checkRateLimit } from "./lib/authRateLimit";
import { MAX_LABEL_LENGTH, proposeRemixFields } from "./lib/remixFields";
import type { RemixField } from "./lib/remixFields";
import { MAX_GROUP, MAX_PART_LABEL, MAX_PART_NOTE, inheritParts, normalizeParts, partSummary } from "./lib/remixParts";
import type { PartChange, RemixPart } from "./lib/remixParts";
import { remixField, remixPart } from "./schema/cultremix";
import { remixTarget } from "./lib/remixTarget";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Remixable parts (convex/lib/remixParts.ts) and words, edited in one place for a design in the
// studio (its remixSetup, before publishing) or a published work. "Make it remixable" on a design
// reads it (its notes, then Luna's proposed parts) and the creator adjusts it; "Try it as a remix"
// generates with the same form a remixer sees; publishing carries the setup to the work. After
// publishing, the work page edits the work's own copy. The browser gets labels, switches, and
// rules, never the notes or what the prompt says about each part.

type Ctx = QueryCtx | MutationCtx;

const target = remixTarget;
type Target = { workId: Id<"works"> } | { generationId: Id<"generations"> };

// A setup still reading after this long is started again.
const READING_STALE_MS = 3 * 60_000;

const editorPart = v.object({
  id: v.string(),
  kind: v.union(v.literal("character"), v.literal("person"), v.literal("group")),
  label: v.string(),
  on: v.boolean(),
  empty: v.optional(v.union(v.literal("keep"), v.literal("omit"), v.literal("require"))),
  count: v.optional(v.number()),
  max: v.optional(v.number()),
  note: v.optional(v.string()),
});
const editorField = v.object({ id: v.string(), label: v.string(), text: v.string(), on: v.boolean() });

const editorParts = (parts: Array<RemixPart> | undefined) =>
  (parts ?? []).map((p) => ({ id: p.id, kind: p.kind, label: p.label, on: p.on, empty: p.empty, count: p.count, max: p.max, note: p.note }));
const editorFields = (fields: Array<RemixField> | undefined) => (fields ?? []).map((f) => ({ id: f.id, label: f.label, text: f.text, on: f.on }));

// The design or work being set up, if the viewer may edit it: their own design, or their own work
// (an admin who manages may edit any work).
async function editable(ctx: Ctx, t: Target) {
  const user = await getViewerUser(ctx);
  if (!user) return null;
  if ("generationId" in t) {
    const design = await ctx.db.get("generations", t.generationId);
    if (!design || design.ownerId !== user._id || design.status !== "succeeded" || !design.fullKey) return null;
    return { user, design, work: null };
  }
  const work = await ctx.db.get("works", t.workId);
  if (!work || work.status === "withdrawn") return null;
  if (work.creatorId !== user._id && !adminAllows(user.platformRole, "manage")) return null;
  return { user, design: null, work };
}

// "Make it remixable": reads the design (its notes, written once per image) and proposes its parts.
export const setup = mutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const found = await editable(ctx, args);
    if (!found?.design?.fullKey) throw new ConvexError({ code: "NOT_FOUND", message: "That design isn't available." });
    const { design, user } = found;
    const current = design.remixSetup;
    const now = Date.now();
    if (current?.status === "ready") return null;
    if (current?.status === "reading" && now - current.updatedAt < READING_STALE_MS) return null;
    const imageId = await ensureUserImage(ctx, user._id, design.fullKey!);
    await ctx.db.patch("generations", design._id, { remixSetup: { status: "reading", imageId, updatedAt: now } });
    await ctx.scheduler.runAfter(0, internal.remixPartsActions.proposeForDesign, { generationId: design._id });
    return null;
  },
});

// For proposeForDesign: the design's notes, once written.
export const designJob = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(v.null(), v.object({ analysis: v.string(), notes: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const design = await ctx.db.get("generations", args.generationId);
    const imageId = design?.remixSetup?.imageId;
    if (!design || design.remixSetup?.status !== "reading" || !imageId) return null;
    const image = await ctx.db.get("userImages", imageId);
    return { analysis: image?.analysis ?? "failed", notes: image?.notes };
  },
});

export const saveDesignSetup = internalMutation({
  args: { generationId: v.id("generations"), fields: v.optional(v.array(remixField)), parts: v.optional(v.array(remixPart)), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const design = await ctx.db.get("generations", args.generationId);
    if (!design?.remixSetup || design.remixSetup.status !== "reading") return null;
    const imageId = design.remixSetup.imageId;
    await ctx.db.patch("generations", design._id, {
      remixSetup: args.error
        ? { status: "failed", imageId, error: args.error.slice(0, 200), updatedAt: Date.now() }
        : { status: "ready", imageId, fields: args.fields ?? [], parts: args.parts ?? [], updatedAt: Date.now() },
    });
    return null;
  },
});

// For proposeForWork: a published work's notes, when it still has no parts.
export const workJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(v.null(), v.object({ notes: v.string() })),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.remixParts || !work.notes || (work.status !== "published" && work.status !== "private")) return null;
    return { notes: work.notes };
  },
});

export const saveWorkParts = internalMutation({
  args: { workId: v.id("works"), parts: v.array(remixPart) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.remixParts) return null;
    await ctx.db.patch("works", work._id, { remixParts: args.parts });
    return null;
  },
});

// For describe: the notes and parts of what's being set up.
export const viewerId = internalQuery({
  args: {},
  returns: v.union(v.null(), v.id("users")),
  handler: async (ctx) => (await getViewerUser(ctx))?._id ?? null,
});

// Lets "Add a part" ask the model: at most 30 an hour per member (lib/authRateLimit.ts).
export const admitDescribe = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await checkRateLimit(ctx, "studio:describe_part", args.userId);
    } catch {
      throw new ConvexError({ code: "RATE_LIMITED", message: "That's a lot of new parts for one hour. Try again in a little while." });
    }
    return null;
  },
});

// For remixPartsActions.backfillWorks: published works with notes and no parts yet.
export const worksWithoutParts = internalQuery({
  args: {},
  returns: v.array(v.id("works")),
  handler: async (ctx) => {
    const ids = [];
    for await (const work of ctx.db.query("works").withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))) {
      if (!work.remixParts && work.notes) ids.push(work._id);
    }
    return ids;
  },
});

export const describeJob = internalQuery({
  args: { target, userId: v.id("users") },
  returns: v.union(v.null(), v.object({ notes: v.string(), parts: v.array(remixPart) })),
  handler: async (ctx, args) => {
    const t = args.target as Target;
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    if ("generationId" in t) {
      const design = await ctx.db.get("generations", t.generationId);
      if (!design || design.ownerId !== user._id || design.remixSetup?.status !== "ready" || !design.remixSetup.imageId) return null;
      const image = await ctx.db.get("userImages", design.remixSetup.imageId);
      return image?.notes ? { notes: image.notes, parts: design.remixSetup.parts ?? [] } : null;
    }
    const work = await ctx.db.get("works", t.workId);
    if (!work?.notes || (work.creatorId !== user._id && !adminAllows(user.platformRole, "manage"))) return null;
    return { notes: work.notes, parts: work.remixParts ?? [] };
  },
});

export const addPart = internalMutation({
  args: { target, part: remixPart },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const t = args.target as Target;
    if ("generationId" in t) {
      const design = await ctx.db.get("generations", t.generationId);
      const setup = design?.remixSetup;
      if (!design || setup?.status !== "ready") return false;
      const parts = normalizeParts([...(setup.parts ?? []), args.part]);
      await ctx.db.patch("generations", design._id, { remixSetup: { ...setup, parts, updatedAt: Date.now() } });
      return true;
    }
    const work = await ctx.db.get("works", t.workId);
    if (!work) return false;
    await ctx.db.patch("works", work._id, { remixParts: normalizeParts([...(work.remixParts ?? []), args.part]) });
    return true;
  },
});

// The editor: a design's setup or a work's words and parts. null for anyone who can't edit it.
export const editor = query({
  args: { target },
  returns: v.union(
    v.null(),
    v.object({
      // reading: the notes or proposal aren't ready yet; none: a design not set up.
      status: v.union(v.literal("none"), v.literal("reading"), v.literal("ready"), v.literal("failed")),
      fields: v.array(editorField),
      parts: v.array(editorPart),
      publishedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const found = await editable(ctx, args.target as Target);
    if (!found) return null;
    if (found.design) {
      const setup = found.design.remixSetup;
      return {
        status: setup?.status ?? ("none" as const),
        fields: editorFields(setup?.fields),
        parts: editorParts(setup?.parts),
      };
    }
    const work = found.work!;
    // Ready once either list exists: works published before parts have words only until
    // remixPartsActions.backfillWorks proposes their parts.
    const ready = work.remixFields !== undefined || work.remixParts !== undefined;
    return {
      status: ready ? ("ready" as const) : ("reading" as const),
      fields: editorFields(work.remixFields),
      parts: editorParts(work.remixParts),
      publishedAt: work.publishedAt,
    };
  },
});

// Saves the creator's edits: each word's switch and name, and each part's switch, name, rules, and
// note. A part left out of the list is removed. Texts come from the design and can't be edited.
export const update = mutation({
  args: {
    target,
    fields: v.array(v.object({ id: v.string(), label: v.string(), on: v.boolean() })),
    parts: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        on: v.boolean(),
        empty: v.optional(v.union(v.literal("keep"), v.literal("omit"), v.literal("require"))),
        max: v.optional(v.number()),
        note: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const found = await editable(ctx, args.target as Target);
    if (!found) throw new ConvexError({ code: "FORBIDDEN", message: "Only the creator can change this." });
    const stored = found.design
      ? { fields: found.design.remixSetup?.fields, parts: found.design.remixSetup?.parts }
      : { fields: found.work!.remixFields, parts: found.work!.remixParts };
    if (found.design && found.design.remixSetup?.status !== "ready") {
      throw new ConvexError({ code: "NOT_READY", message: "Still reading the design." });
    }
    const fields = editFields(stored.fields ?? [], args.fields);
    const parts = editParts(stored.parts ?? [], args.parts);
    if (found.design) {
      const setup = found.design.remixSetup!;
      await ctx.db.patch("generations", found.design._id, { remixSetup: { ...setup, fields, parts, updatedAt: Date.now() } });
    } else {
      await ctx.db.patch("works", found.work!._id, {
        ...(found.work!.remixFields ? { remixFields: fields } : {}),
        remixParts: parts,
      });
    }
    return null;
  },
});

function editFields(stored: Array<RemixField>, edits: Array<{ id: string; label: string; on: boolean }>) {
  const byId = new Map<string, { label: string; on: boolean }>();
  for (const edit of edits) {
    if (byId.has(edit.id) || !stored.some((f) => f.id === edit.id)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Those words aren't part of this design." });
    }
    const label = edit.label.replace(/\s+/gu, " ").trim();
    if (!label || [...label].length > MAX_LABEL_LENGTH) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `Give each one a name, up to ${MAX_LABEL_LENGTH} characters.` });
    }
    byId.set(edit.id, { label, on: edit.on });
  }
  return stored.map((f) => ({ ...f, ...byId.get(f.id) }));
}

function editParts(
  stored: Array<RemixPart>,
  edits: Array<{ id: string; label: string; on: boolean; empty?: "keep" | "omit" | "require"; max?: number; note?: string }>,
) {
  const out: Array<RemixPart> = [];
  const seen = new Set<string>();
  for (const edit of edits) {
    const part = stored.find((p) => p.id === edit.id);
    if (!part || seen.has(edit.id)) throw new ConvexError({ code: "INVALID_INPUT", message: "That part isn't on this design." });
    seen.add(edit.id);
    const label = edit.label.replace(/\s+/gu, " ").trim();
    if (!label || [...label].length > MAX_PART_LABEL) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `Give each part a name, up to ${MAX_PART_LABEL} characters.` });
    }
    if (edit.note && [...edit.note].length > MAX_PART_NOTE) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `Notes take up to ${MAX_PART_NOTE} characters.` });
    }
    if (edit.max !== undefined && (!Number.isInteger(edit.max) || edit.max < 1 || edit.max > MAX_GROUP)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `A group takes 1 to ${MAX_GROUP} photos.` });
    }
    out.push({
      ...part,
      label,
      on: edit.on,
      ...(part.kind === "person" && edit.empty ? { empty: edit.empty } : {}),
      ...(part.kind === "group" && edit.max !== undefined ? { max: edit.max } : {}),
      ...(edit.note !== undefined ? { note: edit.note.replace(/\s+/gu, " ").trim() || undefined } : {}),
    });
  }
  return normalizeParts(out);
}

// What a remix of a published work offers: its switched-on parts, with what a remixer needs to
// fill them in, and for a remix, the parts it changed. Works signed out.
export const forWork = query({
  args: { workId: v.id("works") },
  returns: v.object({
    parts: v.array(
      v.object({
        id: v.string(),
        kind: v.union(v.literal("character"), v.literal("person"), v.literal("group")),
        label: v.string(),
        empty: v.optional(v.union(v.literal("keep"), v.literal("omit"), v.literal("require"))),
        count: v.optional(v.number()),
        max: v.optional(v.number()),
      }),
    ),
    changes: v.string(),
  }),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    const viewer = await getViewerUser(ctx);
    const visible = work && (work.status === "published" || (work.status === "private" && viewer?._id === work.creatorId));
    if (!work || !visible) return { parts: [], changes: "" };
    return { parts: publicParts(work.remixParts), changes: await changesOf(ctx, work) };
  },
});

// A design being tried as a remix by its creator: the same view as forWork.
export const forDesign = query({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({
      artKey: v.string(),
      fields: v.array(v.object({ id: v.string(), label: v.string(), text: v.string(), maxLength: v.number() })),
      parts: v.array(
        v.object({
          id: v.string(),
          kind: v.union(v.literal("character"), v.literal("person"), v.literal("group")),
          label: v.string(),
          empty: v.optional(v.union(v.literal("keep"), v.literal("omit"), v.literal("require"))),
          count: v.optional(v.number()),
          max: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const found = await editable(ctx, args);
    const setup = found?.design?.remixSetup;
    if (!found?.design?.fullKey || setup?.status !== "ready") return null;
    return {
      artKey: found.design.fullKey,
      fields: (setup.fields ?? []).filter((f) => f.on).map((f) => ({ id: f.id, label: f.label, text: f.text, maxLength: Math.max(f.maxLength, 80) })),
      parts: publicParts(setup.parts),
    };
  },
});

function publicParts(parts: Array<RemixPart> | undefined) {
  return (parts ?? []).filter((p) => p.on).map((p) => ({ id: p.id, kind: p.kind, label: p.label, empty: p.empty, count: p.count, max: p.max }));
}

async function changesOf(ctx: Ctx, work: Doc<"works">) {
  if (!work.parentWorkId) return "";
  const generation = await ctx.db.get("generations", work.generationId);
  const batch = generation ? await ctx.db.get("batches", generation.batchId) : null;
  return batch?.partChanges?.length ? partSummary(batch.partChanges) : "";
}

// At publish (publish.quick): a design's studio setup becomes the work's words and parts.
export async function carrySetup(ctx: MutationCtx, workId: Id<"works">, design: Doc<"generations">) {
  const setup = design.remixSetup;
  if (setup?.status !== "ready") return;
  await ctx.db.patch("works", workId, { remixFields: setup.fields ?? [], remixParts: setup.parts ?? [] });
}

// At publish (publish.markPublished): a remix on its parent's art starts from the parent's parts.
export async function inheritPartsOnPublish(ctx: MutationCtx, workId: Id<"works">) {
  const work = await ctx.db.get("works", workId);
  if (!work || work.remixParts || !work.parentWorkId) return;
  const parent = await ctx.db.get("works", work.parentWorkId);
  if (!parent?.remixParts) return;
  const generation = await ctx.db.get("generations", work.generationId);
  const batch = generation ? await ctx.db.get("batches", generation.batchId) : null;
  if (!batch || batch.operation !== "remix" || batch.inspirationKey !== parent.artKey) return;
  const changes: Array<PartChange> = (batch.partChanges ?? []).map((c) => ({
    ...c,
    photos: c.photos.map((p) => ({ imageId: p.imageId, key: p.key })),
  }));
  await ctx.db.patch("works", work._id, { remixParts: inheritParts(parent.remixParts, changes) });
}
