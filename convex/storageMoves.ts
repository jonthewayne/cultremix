import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { folderOf, legacyParts } from "./lib/sizes";

// Moving images into one folder per image (convex/lib/sizes.ts): files still in Convex storage
// ("cvx:" keys, from before R2) and R2 files from before folders (gen/, art/, photo/, inspo/, and
// sizes/). sizing.organize copies each file into its folder and records the move here, then
// repoints every table that holds the old key; sizing.cleanup deletes the old files once no table
// points to them.

const moveTable = v.union(
  v.literal("generations"),
  v.literal("works"),
  v.literal("shootPhotos"),
  v.literal("userImages"),
  v.literal("batches"),
);

// A key that isn't in its folder yet (dev stand-in "fake:" keys never move).
function unorganized(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("fake:") && !folderOf(key));
}

// What an image in a member's images or a batch is: a design if it came from the studio,
// otherwise an upload. (Convex storage keys don't say; designs are moved first, through
// generations and works, so a "cvx:" key still unmoved here is an upload.)
function kindOf(key: string): "design" | "upload" {
  const prefix = legacyParts(key)?.prefix;
  return prefix === "gen" || prefix === "art" ? "design" : "upload";
}

const item = v.object({
  key: v.string(),
  kind: v.union(v.literal("design"), v.literal("upload"), v.literal("photo")),
  // A model photo's design: its art key and SHA-256, which name the folder the photo goes in.
  designKey: v.optional(v.string()),
  designHash: v.optional(v.string()),
});

// One page of a table's keys that still need moving.
export const unorganizedPage = internalQuery({
  args: { table: moveTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ items: v.array(item), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const options = { cursor: args.cursor, numItems: args.numItems };
    const items: Array<{ key: string; kind: "design" | "upload" | "photo"; designKey?: string; designHash?: string }> = [];
    const seen = new Set<string>();
    const add = (key: string | undefined, kind: "design" | "upload" | "photo", design?: { designKey?: string; designHash?: string }) => {
      if (!unorganized(key) || seen.has(key)) return;
      seen.add(key);
      items.push({ key, kind, ...design });
    };
    let page: { continueCursor: string; isDone: boolean };
    if (args.table === "generations") {
      const result = await ctx.db.query("generations").paginate(options);
      for (const row of result.page) add(row.fullKey, "design");
      page = result;
    } else if (args.table === "works") {
      const result = await ctx.db.query("works").paginate(options);
      for (const row of result.page) add(row.artKey, "design");
      page = result;
    } else if (args.table === "shootPhotos") {
      const result = await ctx.db.query("shootPhotos").paginate(options);
      for (const row of result.page) {
        if (!unorganized(row.publicKey)) continue;
        const work = await ctx.db.get("works", row.workId);
        add(row.publicKey, "photo", { designKey: work?.artKey, designHash: work?.contentHash });
      }
      page = result;
    } else if (args.table === "userImages") {
      const result = await ctx.db.query("userImages").paginate(options);
      for (const row of result.page) if (unorganized(row.key)) add(row.key, kindOf(row.key));
      page = result;
    } else {
      const result = await ctx.db.query("batches").paginate(options);
      for (const row of result.page) {
        for (const key of [row.inspirationKey, ...(row.images ?? []).map((i) => i.key), ...(row.styles ?? []).map((s) => s.key)]) {
          if (unorganized(key)) add(key, kindOf(key));
        }
      }
      page = result;
    }
    return { items, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const movedTo = internalQuery({
  args: { from: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("storageMoves")
      .withIndex("by_from", (q) => q.eq("from", args.from))
      .first();
    return row ? row.to : null;
  },
});

export const recordMove = internalMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storageMoves")
      .withIndex("by_from", (q) => q.eq("from", args.from))
      .first();
    if (!existing) await ctx.db.insert("storageMoves", args);
    else if (existing.to !== args.to) await ctx.db.patch("storageMoves", existing._id, { to: args.to });
    return null;
  },
});

// Points one page of a table at the moved files.
export const repointPage = internalMutation({
  args: {
    table: v.union(moveTable, v.literal("imageSizes")),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({ patched: v.number(), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const moves = new Map<string, string | null>();
    const moved = async (key: string | undefined) => {
      if (!unorganized(key)) return undefined;
      if (!moves.has(key)) {
        const row = await ctx.db
          .query("storageMoves")
          .withIndex("by_from", (q) => q.eq("from", key))
          .first();
        moves.set(key, row ? row.to : null);
      }
      return moves.get(key) ?? undefined;
    };
    const options = { cursor: args.cursor, numItems: args.numItems };
    let patched = 0;
    if (args.table === "generations") {
      const result = await ctx.db.query("generations").paginate(options);
      for (const row of result.page) {
        const fullKey = await moved(row.fullKey);
        if (fullKey) {
          await ctx.db.patch("generations", row._id, { fullKey });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    if (args.table === "works") {
      const result = await ctx.db.query("works").paginate(options);
      for (const row of result.page) {
        const artKey = await moved(row.artKey);
        if (artKey) {
          await ctx.db.patch("works", row._id, { artKey });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    if (args.table === "shootPhotos") {
      const result = await ctx.db.query("shootPhotos").paginate(options);
      for (const row of result.page) {
        const publicKey = await moved(row.publicKey);
        if (publicKey) {
          await ctx.db.patch("shootPhotos", row._id, { publicKey });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    if (args.table === "userImages") {
      const result = await ctx.db.query("userImages").paginate(options);
      for (const row of result.page) {
        const key = await moved(row.key);
        if (key) {
          await ctx.db.patch("userImages", row._id, { key });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    if (args.table === "batches") {
      const result = await ctx.db.query("batches").paginate(options);
      for (const row of result.page) {
        const inspirationKey = await moved(row.inspirationKey);
        let changed = Boolean(inspirationKey);
        const images = [];
        for (const image of row.images ?? []) {
          const key = await moved(image.key);
          if (key) changed = true;
          images.push({ ...image, key: key ?? image.key });
        }
        const styles = [];
        for (const style of row.styles ?? []) {
          const key = await moved(style.key);
          if (key) changed = true;
          styles.push({ ...style, key: key ?? style.key });
        }
        if (changed) {
          await ctx.db.patch("batches", row._id, {
            ...(inspirationKey ? { inspirationKey } : {}),
            ...(row.images ? { images } : {}),
            ...(row.styles ? { styles } : {}),
          });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    // Copies: a moved image's old row goes (organize recorded new copies in its folder), and so does
    // a row whose copies aren't beside its original; sizing.backfill makes any that are missing.
    const result = await ctx.db.query("imageSizes").paginate(options);
    for (const row of result.page) {
      const folder = folderOf(row.key);
      const misplaced = folder && (row.thumbKey !== folder + "/thumb.webp" || row.mediumKey !== folder + "/medium.webp");
      if ((await moved(row.key)) || misplaced) {
        await ctx.db.delete("imageSizes", row._id);
        patched++;
      }
    }
    return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

// Before cleanup: how many keys outside folders the tables still hold, with a few examples.
export const unorganizedCount = internalQuery({
  args: {},
  returns: v.object({ count: v.number(), examples: v.array(v.string()) }),
  handler: async (ctx) => {
    const found: Array<string> = [];
    const check = (key: string | undefined) => {
      if (unorganized(key)) found.push(key);
    };
    for await (const row of ctx.db.query("generations")) check(row.fullKey);
    for await (const row of ctx.db.query("works")) check(row.artKey);
    for await (const row of ctx.db.query("shootPhotos")) check(row.publicKey);
    for await (const row of ctx.db.query("userImages")) check(row.key);
    for await (const row of ctx.db.query("batches")) {
      check(row.inspirationKey);
      for (const image of row.images ?? []) check(image.key);
      for (const style of row.styles ?? []) check(style.key);
    }
    return { count: found.length, examples: [...new Set(found)].slice(0, 5) };
  },
});

// Cleanup: drops copy records for originals outside folders; once every table points into folders,
// nothing uses them.
export const dropStrayCopies = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let dropped = 0;
    for await (const row of ctx.db.query("imageSizes")) {
      if (!folderOf(row.key) && !row.key.startsWith("fake:")) {
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
