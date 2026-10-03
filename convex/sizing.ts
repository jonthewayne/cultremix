"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { storageMode } from "./lib/r2";
import { makeSizes, sha256Hex, storeObject } from "./lib/storage";

// Makes an image's thumbnail and medium after it's stored: uploads, and images stored before
// sizes existed. Designs and model photos get theirs before they're shown (convex/imageGen.ts).
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

// Gives every stored image its sizes: bunx convex run sizing:backfill
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
        const page = await ctx.runQuery(internal.imageSizes.keysPage, { table: TABLES[t], cursor, numItems: 40 });
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

// The tables that can hold "cvx:" keys, in the order the move visits them (convex/storageMoves.ts).
const MOVE_TABLES = ["generations", "works", "shootPhotos", "userImages", "batches", "imageSizes"] as const;
const PHASES = ["copy", "repoint"] as const;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

type MoveResult = { copied: number; patched: number; failed: number; continued: boolean };

// Copies the images kept in Convex file storage (from before R2) to R2 and points every table at
// the copies: bunx convex run sizing:moveToR2 (production: --prod). Safe to run again. The Convex
// copies stay. Run sizing:backfill afterwards; it remakes any sizes the move had to drop.
export const moveToR2 = internalAction({
  args: {
    phase: v.optional(v.union(v.literal("copy"), v.literal("repoint"))),
    table: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ copied: v.number(), patched: v.number(), failed: v.number(), continued: v.boolean() }),
  handler: async (ctx, args): Promise<MoveResult> => {
    if (storageMode() !== "r2") throw new Error("R2 isn't configured on this deployment.");
    const started = Date.now();
    let copied = 0;
    let patched = 0;
    let failed = 0;
    const firstPhase = PHASES.indexOf(args.phase ?? "copy");
    for (let p = firstPhase; p < PHASES.length; p++) {
      const firstTable = p === firstPhase ? (args.table ?? 0) : 0;
      for (let t = firstTable; t < MOVE_TABLES.length; t++) {
        let cursor: string | null = p === firstPhase && t === firstTable ? (args.cursor ?? null) : null;
        for (;;) {
          if (Date.now() - started > BUDGET_MS) {
            await ctx.scheduler.runAfter(0, internal.sizing.moveToR2, { phase: PHASES[p], table: t, cursor });
            console.log("sizing.moveToR2 continues", { copied, patched, failed });
            return { copied, patched, failed, continued: true };
          }
          if (PHASES[p] === "copy") {
            const page = await ctx.runQuery(internal.storageMoves.cvxKeysPage, { table: MOVE_TABLES[t], cursor, numItems: 50 });
            for (const { key, prefix } of page.keys) {
              if (await ctx.runQuery(internal.storageMoves.movedTo, { from: key })) continue;
              try {
                const blob = await ctx.storage.get(key.slice(4) as Id<"_storage">);
                if (!blob) throw new Error("not in Convex storage");
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const type = blob.type || "image/png";
                const to = await storeObject(ctx, prefix + "/" + sha256Hex(bytes) + "." + (EXTENSIONS[type] ?? "png"), bytes, type);
                await ctx.runMutation(internal.storageMoves.recordMove, { from: key, to });
                copied++;
              } catch (error) {
                console.error("moveToR2 copy failed", key, error);
                failed++;
              }
            }
            if (page.isDone) break;
            cursor = page.continueCursor;
          } else {
            const page = await ctx.runMutation(internal.storageMoves.repointPage, { table: MOVE_TABLES[t], cursor, numItems: 50 });
            patched += page.patched;
            if (page.isDone) break;
            cursor = page.continueCursor;
          }
        }
      }
    }
    console.log("sizing.moveToR2 done", { copied, patched, failed });
    return { copied, patched, failed, continued: false };
  },
});
