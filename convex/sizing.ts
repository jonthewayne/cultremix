"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { randomCode } from "./lib/codes";
import { stripPngMetadata } from "./lib/pngMeta";
import { storageMode } from "./lib/r2";
import { designKey, extensionOf, gridKey, sizeKey, uploadKey, workArtKey, workPhotoKey } from "./lib/sizes";
import { copyObject, deleteKeys, fetchPublicImage, listKeys, makeSizes, sha256Hex, storeObject } from "./lib/storage";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MovePlace } from "./storageMoves";

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

// ---- Moving images into the current layout (convex/lib/sizes.ts, convex/storageMoves.ts) ----

// Batches are numbered first; designs move before the images and batch inputs that point at them;
// published art last, so remix sources already have their work's folder.
const PHASES = ["number", "designs", "uploads", "batches", "photos", "works"] as const;
type Phase = (typeof PHASES)[number];
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
// Top folders of older layouts; cleanup deletes what's under them once no table uses it.
const OLD_PREFIXES = /^(designs|uploads|grids|gen|art|photo|inspo|sizes)\//u;
const CONCURRENCY = 4;

type Copies = { thumbKey: string; mediumKey: string; width: number; height: number };
type Counts = { moved: number; checked: number; failed: number };
type Placed = { to: string; sha256?: string };

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
  if (!key.startsWith("cvx:")) {
    return { bytes: await fetchPublicImage(key, ctx), type: TYPES[extensionOf(key) ?? "png"] ?? "image/png" };
  }
  const blob = await ctx.storage.get(key.slice(4) as Id<"_storage">);
  if (!blob) throw new Error("Not in Convex storage.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "image/png" };
}

// Stores a design, grid, model photo, or published art at its new key without the image model's
// metadata, with its copies unless it's a grid.
async function storeModelImage(ctx: ActionCtx, from: string, to: string, copies: boolean): Promise<Placed> {
  const bytes = stripPngMetadata((await readStored(ctx, from)).bytes);
  const sha256 = sha256Hex(bytes);
  await storeObject(ctx, to, bytes, "image/png");
  if (copies) await relocateCopies(ctx, from, to, sha256, bytes);
  return { to, sha256 };
}

// A published work's art in works/<family>/<expression>/, copied once per work.
async function ensureWorkArt(ctx: ActionCtx, workId: Id<"works">, from: string, family: number, expression: number) {
  const done: Placed | null = await ctx.runQuery(internal.storageMoves.movedTo, { from: "work:" + workId });
  if (done) return { ...done, moved: false };
  const placed = await storeModelImage(ctx, from, workArtKey(family, expression), true);
  await ctx.runMutation(internal.storageMoves.recordMove, { from: "work:" + workId, to: placed.to, sha256: placed.sha256 });
  return { ...placed, moved: true };
}

// Where one of a member's images or batch inputs goes (storageMoves.resolveKey), copied if needed.
async function placeMemberImage(ctx: ActionCtx, key: string, memberId: Id<"users">, at: number) {
  const target = await ctx.runQuery(internal.storageMoves.resolveKey, { key, memberId });
  if (target.kind === "moved") return { to: target.to, sha256: target.sha256, moved: false };
  if (target.kind === "work") return await ensureWorkArt(ctx, target.workId, key, target.family, target.expression);
  // An upload keeps its bytes: the browser re-encoded it, so it carries no model metadata.
  const { bytes, type } = await readStored(ctx, key);
  const extension = extensionOf(key) ?? EXTENSIONS[type] ?? "png";
  const to = uploadKey(memberId, at, randomCode(), extension);
  const sha256 = sha256Hex(bytes);
  await storeObject(ctx, to, bytes, TYPES[extension] ?? type);
  await relocateCopies(ctx, key, to, sha256, bytes);
  await ctx.runMutation(internal.storageMoves.recordMove, { from: target.from, to, sha256 });
  return { to, sha256, moved: true };
}

async function each<T>(items: Array<T>, counts: Counts, run: (item: T) => Promise<boolean>) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(
      items.slice(i, i + CONCURRENCY).map(async (item) => {
        try {
          if (await run(item)) counts.moved++;
          else counts.checked++;
        } catch (error) {
          console.error("organize: move failed", JSON.stringify(item).slice(0, 300), error);
          counts.failed++;
        }
      }),
    );
  }
}

type PageResult = { continueCursor: string; isDone: boolean };

// One page of one phase; returns the cursor for the next.
async function organizePage(ctx: ActionCtx, phase: Phase, cursor: string | null, counts: Counts): Promise<PageResult> {
  const args = { cursor, numItems: 40 };
  if (phase === "number") {
    const page: PageResult & { numbered: number } = await ctx.runMutation(internal.storageMoves.numberPage, args);
    return page;
  }
  if (phase === "designs") {
    const page: PageResult & {
      items: Array<{ generationId: Id<"generations">; key: string; place: MovePlace; designNumber: number }>;
    } = await ctx.runQuery(internal.storageMoves.designsPage, args);
    await each(page.items, counts, async (item) => {
      const done: Placed | null = await ctx.runQuery(internal.storageMoves.movedTo, { from: item.key });
      const placed = done ?? (await storeModelImage(ctx, item.key, designKey(item.place, item.designNumber, randomCode()), true));
      if (!done) await ctx.runMutation(internal.storageMoves.recordMove, { from: item.key, to: placed.to, sha256: placed.sha256 });
      await ctx.runMutation(internal.storageMoves.setDesign, { generationId: item.generationId, key: placed.to, sha256: placed.sha256 });
      return !done;
    });
    return page;
  }
  if (phase === "uploads") {
    const page: PageResult & {
      items: Array<{ imageId: Id<"userImages">; key: string; memberId: Id<"users">; at: number }>;
    } = await ctx.runQuery(internal.storageMoves.uploadsPage, args);
    await each(page.items, counts, async (item) => {
      const placed = await placeMemberImage(ctx, item.key, item.memberId, item.at);
      await ctx.runMutation(internal.storageMoves.setUpload, { imageId: item.imageId, key: placed.to, sha256: placed.sha256 });
      return placed.moved;
    });
    return page;
  }
  if (phase === "batches") {
    const page: PageResult & {
      items: Array<{ batchId: Id<"batches">; place: MovePlace; at: number; gridKey?: string; inputs: Array<string> }>;
    } = await ctx.runQuery(internal.storageMoves.batchesPage, args);
    await each(page.items, counts, async (item) => {
      const grid = item.gridKey ? await storeModelImage(ctx, item.gridKey, gridKey(item.place, randomCode()), false) : undefined;
      const inputs: Array<{ from: string; to: string }> = [];
      for (const key of item.inputs) {
        inputs.push({ from: key, to: (await placeMemberImage(ctx, key, item.place.memberId, item.at)).to });
      }
      await ctx.runMutation(internal.storageMoves.setBatch, { batchId: item.batchId, gridKey: grid?.to, inputs });
      return true;
    });
    return page;
  }
  if (phase === "photos") {
    const page: PageResult & {
      items: Array<{ photoId: Id<"shootPhotos">; key: string; family: number; expression: number }>;
    } = await ctx.runQuery(internal.storageMoves.photosPage, args);
    await each(page.items, counts, async (item) => {
      const placed = await storeModelImage(ctx, item.key, workPhotoKey(item.family, item.expression, 1), true);
      await ctx.runMutation(internal.storageMoves.setPhoto, { photoId: item.photoId, key: placed.to });
      return true;
    });
    return page;
  }
  const page: PageResult & {
    items: Array<{ workId: Id<"works">; key: string; family: number; expression: number }>;
  } = await ctx.runQuery(internal.storageMoves.worksPage, args);
  await each(page.items, counts, async (item) => {
    const placed = await ensureWorkArt(ctx, item.workId, item.key, item.family, item.expression);
    await ctx.runMutation(internal.storageMoves.setWorkArt, { workId: item.workId, key: placed.to, sha256: placed.sha256 });
    return placed.moved;
  });
  return page;
}

type OrganizeResult = Counts & { continued: boolean };
type CleanupResult = {
  deletedR2: number;
  deletedConvex: number;
  droppedCopies: number;
  blocked?: { count: number; examples: Array<string> };
};

// Moves every image into the current layout (convex/lib/sizes.ts): bunx convex run sizing:organize
// (production: --prod). Files in Convex storage and in older R2 layouts are copied to their new keys
// (designs, model photos, grids, and published art without the image model's metadata) and each row
// is patched as soon as its file is in place. Safe to run again: a second run reports moved 0. The
// old files stay until sizing:cleanup.
export const organize = internalAction({
  args: { phase: v.optional(v.string()), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ moved: v.number(), checked: v.number(), failed: v.number(), continued: v.boolean() }),
  handler: async (ctx, args): Promise<OrganizeResult> => {
    if (storageMode() !== "r2") throw new Error("R2 isn't configured on this deployment.");
    const started = Date.now();
    const counts: Counts = { moved: 0, checked: 0, failed: 0 };
    const first = Math.max(0, PHASES.indexOf((args.phase ?? "number") as Phase));
    for (let p = first; p < PHASES.length; p++) {
      let cursor: string | null = p === first ? (args.cursor ?? null) : null;
      for (;;) {
        if (Date.now() - started > BUDGET_MS) {
          await ctx.scheduler.runAfter(0, internal.sizing.organize, { phase: PHASES[p], cursor });
          console.log("sizing.organize continues", counts);
          return { ...counts, continued: true };
        }
        const page = await organizePage(ctx, PHASES[p], cursor, counts);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    console.log("sizing.organize done", counts);
    return { ...counts, continued: false };
  },
});

// Deletes the old files once sizing:organize has moved everything: every R2 file in an older layout
// (designs/, uploads/, grids/, gen/, art/, photo/, inspo/, sizes/) and all of Convex file storage.
// bunx convex run sizing:cleanup (production: --prod). Refuses, deleting nothing, while any table
// still points outside the current layout, and never deletes a file a table uses.
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
    const old = (await listKeys("")).filter((key) => OLD_PREFIXES.test(key) && !inUse.has(key));
    await deleteKeys(old);
    const droppedCopies: number = await ctx.runMutation(internal.storageMoves.dropOldCopies, {});
    let deletedConvex = 0;
    for (;;) {
      const deleted: number = await ctx.runMutation(internal.storageMoves.deleteStoredFiles, {});
      deletedConvex += deleted;
      if (deleted === 0) break;
    }
    console.log("sizing.cleanup done", { deletedR2: old.length, deletedConvex, droppedCopies });
    return { deletedR2: old.length, deletedConvex, droppedCopies };
  },
});
