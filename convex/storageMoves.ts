import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { folderOf, isOrganized, legacyParts, shaOf } from "./lib/sizes";

// Moving images to where they belong (convex/lib/sizes.ts): files still in Convex storage ("cvx:"
// keys, from before R2), R2 files from before folders (gen/, art/, photo/, inspo/, and sizes/), and
// designs, model photos, and grids stored with the image model's metadata (its C2PA content
// credential). Without that metadata a file has a new SHA-256, so it belongs in a new folder.
// sizing.organize copies each file and records the move here, then repoints every table that holds
// the old key; sizing.cleanup deletes the old files once nothing points to them. A move from a key
// to itself marks a file as checked.

const moveTable = v.union(
  v.literal("generations"),
  v.literal("works"),
  v.literal("shootPhotos"),
  v.literal("userImages"),
  v.literal("batches"),
);

const imageKind = v.union(v.literal("design"), v.literal("upload"), v.literal("photo"), v.literal("grid"));
type ImageKind = "design" | "upload" | "photo" | "grid";

function stored(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("fake:"));
}

// What an image in a member's images or a batch is: a design if it came from the studio, otherwise
// an upload. (Convex storage keys don't say; designs are moved first, through generations and
// works, so a "cvx:" key still unmoved here is an upload.)
function kindOf(key: string): "design" | "upload" {
  if (key.startsWith("designs/")) return "design";
  const prefix = legacyParts(key)?.prefix;
  return prefix === "gen" || prefix === "art" ? "design" : "upload";
}

// The folder a key's files live in, for deleting them once nothing points there.
function folderPrefix(key: string) {
  return key.replace(/original\.[a-z]+$/u, "");
}

const item = v.object({
  key: v.string(),
  kind: imageKind,
  // A model photo's design: its folder decides where the photo goes.
  designKey: v.optional(v.string()),
});

// One page of a table's image keys, each with what it is.
export const imagesPage = internalQuery({
  args: { table: moveTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ items: v.array(item), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const options = { cursor: args.cursor, numItems: args.numItems };
    const items: Array<{ key: string; kind: ImageKind; designKey?: string }> = [];
    const seen = new Set<string>();
    const add = (key: string | undefined, kind: ImageKind, designKey?: string) => {
      if (!stored(key) || seen.has(key)) return;
      seen.add(key);
      items.push({ key, kind, designKey });
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
        if (!stored(row.publicKey)) continue;
        const work = await ctx.db.get("works", row.workId);
        add(row.publicKey, "photo", work?.artKey);
      }
      page = result;
    } else if (args.table === "userImages") {
      const result = await ctx.db.query("userImages").paginate(options);
      for (const row of result.page) if (stored(row.key)) add(row.key, kindOf(row.key));
      page = result;
    } else {
      const result = await ctx.db.query("batches").paginate(options);
      for (const row of result.page) {
        add(row.gridKey, "grid");
        for (const key of [row.inspirationKey, ...(row.images ?? []).map((i) => i.key), ...(row.styles ?? []).map((s) => s.key)]) {
          if (stored(key)) add(key, kindOf(key));
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

// Points one page of a table at the moved files, with the new files' SHA-256 where a table keeps it.
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
      if (!stored(key)) return undefined;
      if (!moves.has(key)) {
        const row = await ctx.db
          .query("storageMoves")
          .withIndex("by_from", (q) => q.eq("from", key))
          .first();
        moves.set(key, row && row.to !== key ? row.to : null);
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
          await ctx.db.patch("generations", row._id, { fullKey, sha256: shaOf(fullKey) ?? row.sha256 });
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
          // The work's hash is its art file's; the shop page shows it.
          await ctx.db.patch("works", row._id, { artKey, contentHash: shaOf(artKey) ?? row.contentHash });
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
        const gridKey = await moved(row.gridKey);
        let changed = Boolean(inspirationKey || gridKey);
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
            ...(gridKey ? { gridKey } : {}),
            ...(row.images ? { images } : {}),
            ...(row.styles ? { styles } : {}),
          });
          patched++;
        }
      }
      return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
    }
    // Copies: a moved image's old row goes (organize recorded the copies in its new folder), and so
    // does a row whose copies aren't beside its original; sizing.backfill makes any that are missing.
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

// Every key the tables point to, for checking before cleanup: how many still point at a file that
// has to move, and the full list of files in use (none of which cleanup may delete).
export const keysInUse = internalQuery({
  args: {},
  returns: v.object({ pending: v.number(), examples: v.array(v.string()), inUse: v.array(v.string()) }),
  handler: async (ctx) => {
    const keys = new Set<string>();
    const add = (key: string | undefined) => {
      if (stored(key)) keys.add(key);
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
    const pending: Array<string> = [];
    for (const key of keys) {
      const move = await ctx.db
        .query("storageMoves")
        .withIndex("by_from", (q) => q.eq("from", key))
        .first();
      if (!isOrganized(key) || (move && move.to !== key)) pending.push(key);
    }
    const inUse = [...keys];
    for await (const row of ctx.db.query("imageSizes")) inUse.push(row.thumbKey, row.mediumKey);
    return { pending: pending.length, examples: pending.slice(0, 5), inUse };
  },
});

// The folders files were moved out of, for cleanup to delete.
export const movedFromFolders = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const folders = new Set<string>();
    for await (const row of ctx.db.query("storageMoves")) {
      if (row.from !== row.to && isOrganized(row.from)) folders.add(folderPrefix(row.from));
    }
    return [...folders];
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
