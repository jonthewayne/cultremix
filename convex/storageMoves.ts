import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { batchNumberOf } from "./studio";
import { isCurrentLayout } from "./lib/sizes";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Moving images into the current layout (convex/lib/sizes.ts): members/<member>/uploads/...,
// members/<member>/sessions/<date>-<session>/batch-NN/..., and works/<family>/<expression>/....
// sizing.organize (a Node action) reads each page below, copies the file to its new key, and patches
// the row right away; the old files stay until sizing.cleanup. Moves are recorded here so a file
// shared by several rows is copied once:
//   "<old key>"                    a design, wherever it's referenced
//   "upload:<member>:<old key>"    an upload, per member (two members' copies of a file stay separate)
//   "work:<workId>"                a published work's art
// Records whose target isn't in the current layout come from earlier layouts and are ignored.

const page = { cursor: v.union(v.string(), v.null()), numItems: v.number() };
const placeValidator = v.object({
  memberId: v.id("users"),
  sessionId: v.id("creativeSessions"),
  sessionStartedAt: v.number(),
  batchNumber: v.number(),
});

function needsMove(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("fake:") && !isCurrentLayout(key));
}

async function moveRecord(ctx: QueryCtx, from: string) {
  const row = await ctx.db
    .query("storageMoves")
    .withIndex("by_from", (q) => q.eq("from", from))
    .first();
  return row && isCurrentLayout(row.to) ? { to: row.to, sha256: row.sha256 } : null;
}

async function placeOf(ctx: QueryCtx, batch: Doc<"batches">) {
  const session = await ctx.db.get("creativeSessions", batch.sessionId);
  return {
    memberId: batch.ownerId,
    sessionId: batch.sessionId,
    sessionStartedAt: session?._creationTime ?? batch._creationTime,
    batchNumber: batch.number ?? (await batchNumberOf(ctx, batch)),
  };
}

// Gives every batch its number in its session (batch-01, ...), in the order they were made.
export const numberPage = internalMutation({
  args: page,
  returns: v.object({ numbered: v.number(), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("creativeSessions").paginate({ cursor: args.cursor, numItems: args.numItems });
    let numbered = 0;
    for (const session of result.page) {
      const batches = await ctx.db
        .query("batches")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();
      let highest = 0;
      for (const [i, batch] of batches.entries()) {
        const number = batch.number ?? i + 1;
        if (batch.number === undefined) {
          await ctx.db.patch("batches", batch._id, { number });
          numbered++;
        }
        highest = Math.max(highest, number);
      }
      if ((session.batchCount ?? 0) < highest) await ctx.db.patch("creativeSessions", session._id, { batchCount: highest });
    }
    return { numbered, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const designsPage = internalQuery({
  args: page,
  returns: v.object({
    items: v.array(
      v.object({ generationId: v.id("generations"), key: v.string(), place: placeValidator, designNumber: v.number() }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("generations").paginate({ cursor: args.cursor, numItems: args.numItems });
    const items = [];
    for (const generation of result.page) {
      if (!needsMove(generation.fullKey)) continue;
      const batch = await ctx.db.get("batches", generation.batchId);
      if (!batch) continue;
      items.push({
        generationId: generation._id,
        key: generation.fullKey,
        place: await placeOf(ctx, batch),
        designNumber: generation.index + 1,
      });
    }
    return { items, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const uploadsPage = internalQuery({
  args: page,
  returns: v.object({
    items: v.array(v.object({ imageId: v.id("userImages"), key: v.string(), memberId: v.id("users"), at: v.number() })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("userImages").paginate({ cursor: args.cursor, numItems: args.numItems });
    const items = result.page
      .filter((row) => needsMove(row.key))
      .map((row) => ({ imageId: row._id, key: row.key, memberId: row.ownerId, at: row._creationTime }));
    return { items, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const batchesPage = internalQuery({
  args: page,
  returns: v.object({
    items: v.array(
      v.object({
        batchId: v.id("batches"),
        place: placeValidator,
        at: v.number(),
        gridKey: v.optional(v.string()),
        inputs: v.array(v.string()),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("batches").paginate({ cursor: args.cursor, numItems: args.numItems });
    const items = [];
    for (const batch of result.page) {
      const inputs = [
        ...new Set([batch.inspirationKey, ...(batch.images ?? []).map((i) => i.key), ...(batch.styles ?? []).map((s) => s.key)]),
      ].filter(needsMove);
      const gridKey = needsMove(batch.gridKey) ? batch.gridKey : undefined;
      if (!gridKey && inputs.length === 0) continue;
      items.push({ batchId: batch._id, place: await placeOf(ctx, batch), at: batch._creationTime, gridKey, inputs });
    }
    return { items, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const photosPage = internalQuery({
  args: page,
  returns: v.object({
    items: v.array(v.object({ photoId: v.id("shootPhotos"), key: v.string(), family: v.number(), expression: v.number() })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("shootPhotos").paginate({ cursor: args.cursor, numItems: args.numItems });
    const items = [];
    for (const photo of result.page) {
      if (!needsMove(photo.publicKey)) continue;
      const work = await ctx.db.get("works", photo.workId);
      if (!work) continue;
      items.push({ photoId: photo._id, key: photo.publicKey, family: work.crFamily, expression: work.crExpression });
    }
    return { items, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const worksPage = internalQuery({
  args: page,
  returns: v.object({
    items: v.array(v.object({ workId: v.id("works"), key: v.string(), family: v.number(), expression: v.number() })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("works").paginate({ cursor: args.cursor, numItems: args.numItems });
    const items = result.page
      .filter((work) => needsMove(work.artKey))
      .map((work) => ({ workId: work._id, key: work.artKey!, family: work.crFamily, expression: work.crExpression }));
    return { items, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

// Where an image a member uses (one of their images, or a batch input) goes: a published work's art
// goes to the work's folder; a design that already moved follows it; anything else is that member's
// upload.
export const resolveKey = internalQuery({
  args: { key: v.string(), memberId: v.id("users") },
  returns: v.union(
    v.object({ kind: v.literal("work"), workId: v.id("works"), family: v.number(), expression: v.number() }),
    v.object({ kind: v.literal("moved"), to: v.string(), sha256: v.optional(v.string()) }),
    v.object({ kind: v.literal("upload"), from: v.string() }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db
      .query("works")
      .withIndex("by_artKey", (q) => q.eq("artKey", args.key))
      .first();
    if (work) return { kind: "work" as const, workId: work._id, family: work.crFamily, expression: work.crExpression };
    const design = await moveRecord(ctx, args.key);
    if (design) return { kind: "moved" as const, ...design };
    const from = "upload:" + args.memberId + ":" + args.key;
    const upload = await moveRecord(ctx, from);
    if (upload) return { kind: "moved" as const, ...upload };
    return { kind: "upload" as const, from };
  },
});

export const movedTo = internalQuery({
  args: { from: v.string() },
  returns: v.union(v.null(), v.object({ to: v.string(), sha256: v.optional(v.string()) })),
  handler: async (ctx, args) => await moveRecord(ctx, args.from),
});

export const recordMove = internalMutation({
  args: { from: v.string(), to: v.string(), sha256: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storageMoves")
      .withIndex("by_from", (q) => q.eq("from", args.from))
      .first();
    if (!existing) await ctx.db.insert("storageMoves", args);
    else await ctx.db.patch("storageMoves", existing._id, { to: args.to, sha256: args.sha256 });
    return null;
  },
});

// Patches, each applied as soon as the file is in its new place.
export const setDesign = internalMutation({
  args: { generationId: v.id("generations"), key: v.string(), sha256: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("generations", args.generationId, { fullKey: args.key, ...(args.sha256 ? { sha256: args.sha256 } : {}) });
    return null;
  },
});

export const setUpload = internalMutation({
  args: { imageId: v.id("userImages"), key: v.string(), sha256: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("userImages", args.imageId, { key: args.key, ...(args.sha256 ? { sha256: args.sha256 } : {}) });
    return null;
  },
});

export const setBatch = internalMutation({
  args: {
    batchId: v.id("batches"),
    gridKey: v.optional(v.string()),
    inputs: v.array(v.object({ from: v.string(), to: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get("batches", args.batchId);
    if (!batch) return null;
    const map = new Map(args.inputs.map((m) => [m.from, m.to]));
    const swap = (key: string) => map.get(key) ?? key;
    await ctx.db.patch("batches", batch._id, {
      ...(args.gridKey ? { gridKey: args.gridKey } : {}),
      ...(batch.inspirationKey ? { inspirationKey: swap(batch.inspirationKey) } : {}),
      ...(batch.images ? { images: batch.images.map((i) => ({ ...i, key: swap(i.key) })) } : {}),
      ...(batch.styles ? { styles: batch.styles.map((s) => ({ ...s, key: swap(s.key) })) } : {}),
    });
    return null;
  },
});

export const setPhoto = internalMutation({
  args: { photoId: v.id("shootPhotos"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("shootPhotos", args.photoId, { publicKey: args.key });
    return null;
  },
});

// A work's art in its own folder; its fingerprint is the SHA-256 of the file as stored.
export const setWorkArt = internalMutation({
  args: { workId: v.id("works"), key: v.string(), sha256: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("works", args.workId, { artKey: args.key, ...(args.sha256 ? { contentHash: args.sha256 } : {}) });
    return null;
  },
});

// Every key the tables point to, for checking before cleanup: how many are still outside the
// current layout, and the full list of files in use (cleanup never deletes those).
export const keysInUse = internalQuery({
  args: {},
  returns: v.object({ pending: v.number(), examples: v.array(v.string()), inUse: v.array(v.string()) }),
  handler: async (ctx) => {
    const keys = new Set<string>();
    const add = (key: string | undefined) => {
      if (key && !key.startsWith("fake:")) keys.add(key);
    };
    for await (const row of ctx.db.query("generations")) add(row.fullKey);
    for await (const row of ctx.db.query("works")) add(row.artKey);
    for await (const row of ctx.db.query("shootPhotos")) add(row.publicKey);
    for await (const row of ctx.db.query("userImages")) add(row.key);
    for await (const row of ctx.db.query("batches")) {
      add(row.inspirationKey);
      add(row.gridKey);
      for (const image of row.images ?? []) add(image.key);
      for (const style of row.styles ?? []) add(style.key);
    }
    const pending = [...keys].filter((key) => !isCurrentLayout(key));
    const inUse = [...keys];
    for await (const row of ctx.db.query("imageSizes")) {
      if (isCurrentLayout(row.key)) inUse.push(row.thumbKey, row.mediumKey);
    }
    return { pending: pending.length, examples: pending.slice(0, 5), inUse };
  },
});

// Cleanup: drops copy records for originals outside the current layout; nothing uses them once
// every table points into it.
export const dropOldCopies = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let dropped = 0;
    for await (const row of ctx.db.query("imageSizes")) {
      if (!isCurrentLayout(row.key) && !row.key.startsWith("fake:")) {
        await ctx.db.delete("imageSizes", row._id);
        dropped++;
      }
    }
    return dropped;
  },
});

// Cleanup: deletes up to 100 files from Convex storage; returns how many it deleted.
export const deleteStoredFiles = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const files = await ctx.db.system.query("_storage").take(100);
    for (const file of files) await ctx.storage.delete(file._id);
    return files.length;
  },
});

export type MovePlace = { memberId: Id<"users">; sessionId: Id<"creativeSessions">; sessionStartedAt: number; batchNumber: number };
