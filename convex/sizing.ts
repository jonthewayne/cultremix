"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { storageMode } from "./lib/r2";
import { stripPngMetadata } from "./lib/pngMeta";
import { designKey, folderOf, gridImageKey, isOrganized, legacyParts, photoKey, shaOf, sizeKey, uploadKey } from "./lib/sizes";
import { copyObject, deleteKeys, fetchPublicImage, listKeys, makeSizes, sha256Hex, storeObject } from "./lib/storage";

// Makes an image's thumbnail and medium after it's stored: uploads, and images stored before
// copies existed. Designs and model photos get theirs before they're shown (convex/imageGen.ts).
export const ensure = internalAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await makeSizes(ctx, args.key);
    return null;
  },
});

const TABLES = ["generations", "works", "shootPhotos", "userImages"] as const;
// Stop well before the 10-minute action limit and continue in a new run.
const BUDGET_MS = 6 * 60_000;

// Gives every stored image its copies: bunx convex run sizing:backfill
// (production: bunx convex run --prod sizing:backfill). Safe to run again; it skips sized images.
export const backfill = internalAction({
  args: { table: v.optional(v.number()), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ checked: v.number(), made: v.number(), failed: v.number(), continued: v.boolean() }),
  handler: async (ctx, args): Promise<{ checked: number; made: number; failed: number; continued: boolean }> => {
    const started = Date.now();
    let checked = 0;
    let made = 0;
    let failed = 0;
    const first = args.table ?? 0;
    for (let t = first; t < TABLES.length; t++) {
      let cursor: string | null = t === first ? (args.cursor ?? null) : null;
      for (;;) {
        if (Date.now() - started > BUDGET_MS) {
          await ctx.scheduler.runAfter(0, internal.sizing.backfill, { table: t, cursor });
          console.log("sizing.backfill continues", { checked, made, failed });
          return { checked, made, failed, continued: true };
        }
        const page: { keys: Array<string>; continueCursor: string; isDone: boolean } = await ctx.runQuery(
          internal.imageSizes.keysPage,
          { table: TABLES[t], cursor, numItems: 40 },
        );
        for (const key of new Set(page.keys)) {
          checked++;
          if (await ctx.runQuery(internal.imageSizes.find, { key })) continue;
          if (await makeSizes(ctx, key)) made++;
          else failed++;
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    console.log("sizing.backfill done", { checked, made, failed });
    return { checked, made, failed, continued: false };
  },
});

// ---- Moving images to where they belong (convex/storageMoves.ts) ----

// Designs first, so a file a member's images share with a design moves as a design, and photos
// after their designs, since a photo's folder sits inside its design's.
const COPY_TABLES = ["generations", "works", "shootPhotos", "userImages", "batches"] as const;
const REPOINT_TABLES = [...COPY_TABLES, "imageSizes"] as const;
const PHASES = ["copy", "repoint"] as const;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
// R2 prefixes from before folders; cleanup deletes everything under them.
const LEGACY_PREFIXES = ["gen/", "art/", "photo/", "inspo/", "sizes/"];
const CONCURRENCY = 4;

type MoveItem = { key: string; kind: "design" | "upload" | "photo" | "grid"; designKey?: string };
type Copies = { thumbKey: string; mediumKey: string; width: number; height: number };

// Brings an image's existing thumbnail and medium into its new folder, or makes them. The copies
// show the same pixels, so they stay valid when only metadata was removed.
async function relocateCopies(ctx: ActionCtx, from: string, to: string, sha256: string, bytes?: Uint8Array) {
  const placed: Copies | null = await ctx.runQuery(internal.imageSizes.find, { key: to });
  if (placed) return;
  const old: Copies | null = await ctx.runQuery(internal.imageSizes.find, { key: from });
  if (!old) {
    await makeSizes(ctx, to, bytes);
    return;
  }
  const thumbKey = sizeKey(to, sha256, "thumb");
  const mediumKey = sizeKey(to, sha256, "medium");
  try {
    for (const [source, target] of [[old.thumbKey, thumbKey], [old.mediumKey, mediumKey]]) {
      if (source === target) continue;
      if (source.startsWith("cvx:")) await storeObject(ctx, target, await fetchPublicImage(source, ctx), "image/webp");
      else await copyObject(source, target);
    }
  } catch (error) {
    console.error("organize: copies remade", to, error);
    await makeSizes(ctx, to, bytes);
    return;
  }
  await ctx.runMutation(internal.imageSizes.record, { key: to, sha256, width: old.width, height: old.height, thumbKey, mediumKey });
}

async function readStored(ctx: ActionCtx, key: string) {
  if (!key.startsWith("cvx:")) return { bytes: await fetchPublicImage(key, ctx), type: "image/png" };
  const blob = await ctx.storage.get(key.slice(4) as Id<"_storage">);
  if (!blob) throw new Error("Not in Convex storage.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "image/png" };
}

// An upload goes to its folder as it is: the browser re-encoded it, so it carries no model metadata.
async function placeUpload(ctx: ActionCtx, key: string) {
  const legacy = legacyParts(key);
  if (legacy) {
    const to = uploadKey(legacy.sha256, legacy.extension);
    await copyObject(key, to);
    await relocateCopies(ctx, key, to, legacy.sha256);
    return to;
  }
  const { bytes, type } = await readStored(ctx, key);
  const sha256 = sha256Hex(bytes);
  const to = uploadKey(sha256, EXTENSIONS[type] ?? "png");
  await storeObject(ctx, to, bytes, type);
  await relocateCopies(ctx, key, to, sha256, bytes);
  return to;
}

// Where a design, model photo, or grid belongs once the model's metadata is removed: the folder for
// its clean bytes, with a model photo inside its design's current folder. Stores it there if that's
// a new place. Returns the key, which is the same key when the file was already clean and in place.
async function placeModelImage(ctx: ActionCtx, item: MoveItem) {
  const { bytes: raw } = await readStored(ctx, item.key);
  const bytes = stripPngMetadata(raw);
  const sha256 = sha256Hex(bytes);
  let to: string;
  if (item.kind === "grid") {
    to = gridImageKey(sha256);
  } else if (item.kind === "photo") {
    if (!item.designKey) throw new Error("A model photo without its design.");
    const designNow = (await ctx.runQuery(internal.storageMoves.movedTo, { from: item.designKey })) ?? item.designKey;
    let designSha = folderOf(designNow) ? shaOf(designNow) : undefined;
    if (!designSha) designSha = sha256Hex(stripPngMetadata((await readStored(ctx, designNow)).bytes));
    to = photoKey(designSha, sha256);
  } else {
    to = designKey(sha256);
  }
  if (to === item.key) return to;
  await storeObject(ctx, to, bytes, "image/png");
  if (item.kind !== "grid") await relocateCopies(ctx, item.key, to, sha256, bytes);
  return to;
}

type OrganizeResult = { moved: number; checked: number; patched: number; failed: number; continued: boolean };
type CleanupResult = {
  deletedR2: number;
  deletedConvex: number;
  droppedCopies: number;
  blocked?: { count: number; examples: Array<string> };
};

// Puts every image where it belongs: files in Convex storage and R2 files from before folders move
// into their folders, and designs, model photos, and grids lose the image model's metadata (its
// C2PA content credential), which gives them new folders. bunx convex run sizing:organize
// (production: --prod). Copies first, then points every table at the new keys and hashes. Safe to
// run again; the old files stay until sizing:cleanup.
export const organize = internalAction({
  args: {
    phase: v.optional(v.union(v.literal("copy"), v.literal("repoint"))),
    table: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    moved: v.number(),
    checked: v.number(),
    patched: v.number(),
    failed: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args): Promise<OrganizeResult> => {
    if (storageMode() !== "r2") throw new Error("R2 isn't configured on this deployment.");
    const started = Date.now();
    let moved = 0;
    let checked = 0;
    let patched = 0;
    let failed = 0;
    const firstPhase = PHASES.indexOf(args.phase ?? "copy");
    for (let p = firstPhase; p < PHASES.length; p++) {
      const tables = PHASES[p] === "copy" ? COPY_TABLES : REPOINT_TABLES;
      const firstTable = p === firstPhase ? (args.table ?? 0) : 0;
      for (let t = firstTable; t < tables.length; t++) {
        let cursor: string | null = p === firstPhase && t === firstTable ? (args.cursor ?? null) : null;
        for (;;) {
          if (Date.now() - started > BUDGET_MS) {
            await ctx.scheduler.runAfter(0, internal.sizing.organize, { phase: PHASES[p], table: t, cursor });
            console.log("sizing.organize continues", { moved, checked, patched, failed });
            return { moved, checked, patched, failed, continued: true };
          }
          if (PHASES[p] === "copy") {
            const page: { items: Array<MoveItem>; continueCursor: string; isDone: boolean } = await ctx.runQuery(
              internal.storageMoves.imagesPage,
              { table: COPY_TABLES[t], cursor, numItems: 40 },
            );
            const todo: Array<MoveItem> = [];
            for (const item of page.items) {
              // Uploads already in their folders stay as they are.
              if (item.kind === "upload" && isOrganized(item.key)) continue;
              if (!(await ctx.runQuery(internal.storageMoves.movedTo, { from: item.key }))) todo.push(item);
            }
            for (let i = 0; i < todo.length; i += CONCURRENCY) {
              await Promise.all(
                todo.slice(i, i + CONCURRENCY).map(async (item) => {
                  try {
                    const to = item.kind === "upload" ? await placeUpload(ctx, item.key) : await placeModelImage(ctx, item);
                    await ctx.runMutation(internal.storageMoves.recordMove, { from: item.key, to });
                    if (to === item.key) checked++;
                    else moved++;
                  } catch (error) {
                    console.error("organize: move failed", item.key, error);
                    failed++;
                  }
                }),
              );
            }
            if (page.isDone) break;
            cursor = page.continueCursor;
          } else {
            const page: { patched: number; continueCursor: string; isDone: boolean } = await ctx.runMutation(
              internal.storageMoves.repointPage,
              { table: REPOINT_TABLES[t], cursor, numItems: 50 },
            );
            patched += page.patched;
            if (page.isDone) break;
            cursor = page.continueCursor;
          }
        }
      }
    }
    console.log("sizing.organize done", { moved, checked, patched, failed });
    return { moved, checked, patched, failed, continued: false };
  },
});

// Deletes the old files once sizing:organize has moved everything: R2 files from before folders,
// the folders files were moved out of, and all of Convex file storage. bunx convex run
// sizing:cleanup (production: --prod). Refuses, deleting nothing, while any table still points at a
// file that has to move, and never deletes a file a table uses. Run sizing:backfill first.
export const cleanup = internalAction({
  args: {},
  returns: v.object({
    deletedR2: v.number(),
    deletedConvex: v.number(),
    droppedCopies: v.number(),
    blocked: v.optional(v.object({ count: v.number(), examples: v.array(v.string()) })),
  }),
  handler: async (ctx): Promise<CleanupResult> => {
    if (storageMode() !== "r2") throw new Error("R2 isn't configured on this deployment.");
    const use: { pending: number; examples: Array<string>; inUse: Array<string> } = await ctx.runQuery(
      internal.storageMoves.keysInUse,
      {},
    );
    if (use.pending > 0) {
      return { deletedR2: 0, deletedConvex: 0, droppedCopies: 0, blocked: { count: use.pending, examples: use.examples } };
    }
    const inUse = new Set(use.inUse);
    const droppedCopies: number = await ctx.runMutation(internal.storageMoves.dropStrayCopies, {});
    const folders: Array<string> = await ctx.runQuery(internal.storageMoves.movedFromFolders, {});
    let deletedR2 = 0;
    for (const prefix of [...LEGACY_PREFIXES, ...folders]) {
      const keys = (await listKeys(prefix)).filter((key) => !inUse.has(key));
      await deleteKeys(keys);
      deletedR2 += keys.length;
    }
    let deletedConvex = 0;
    for (;;) {
      const deleted: number = await ctx.runMutation(internal.storageMoves.deleteStoredFiles, {});
      deletedConvex += deleted;
      if (deleted === 0) break;
    }
    console.log("sizing.cleanup done", { deletedR2, deletedConvex, droppedCopies });
    return { deletedR2, deletedConvex, droppedCopies };
  },
});
