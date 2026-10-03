import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Moving images kept in Convex file storage ("cvx:" keys, stored before R2 was set up) to R2.
// sizing.moveToR2 copies each file once and records the move here, then repoints every table
// that holds the key. The Convex copies stay until they're deleted on purpose.

const moveTable = v.union(
  v.literal("generations"),
  v.literal("works"),
  v.literal("shootPhotos"),
  v.literal("userImages"),
  v.literal("batches"),
  v.literal("imageSizes"),
);

// Where each table's images go in R2 (the same prefixes new images get).
const PREFIX = {
  generations: "gen",
  works: "art",
  shootPhotos: "photo",
  userImages: "inspo",
  batches: "inspo",
  imageSizes: "gen",
} as const;

function isCvx(key: string | undefined): key is string {
  return Boolean(key && key.startsWith("cvx:"));
}

// One page of a table's "cvx:" keys, with the R2 prefix for each.
export const cvxKeysPage = internalQuery({
  args: { table: moveTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({
    keys: v.array(v.object({ key: v.string(), prefix: v.string() })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const options = { cursor: args.cursor, numItems: args.numItems };
    const found: Array<string | undefined> = [];
    let page: { continueCursor: string; isDone: boolean };
    if (args.table === "generations") {
      const result = await ctx.db.query("generations").paginate(options);
      for (const row of result.page) found.push(row.fullKey);
      page = result;
    } else if (args.table === "works") {
      const result = await ctx.db.query("works").paginate(options);
      for (const row of result.page) found.push(row.artKey);
      page = result;
    } else if (args.table === "shootPhotos") {
      const result = await ctx.db.query("shootPhotos").paginate(options);
      for (const row of result.page) found.push(row.publicKey);
      page = result;
    } else if (args.table === "userImages") {
      const result = await ctx.db.query("userImages").paginate(options);
      for (const row of result.page) found.push(row.key);
      page = result;
    } else if (args.table === "batches") {
      const result = await ctx.db.query("batches").paginate(options);
      for (const row of result.page) {
        found.push(row.inspirationKey);
        for (const image of row.images ?? []) found.push(image.key);
        for (const style of row.styles ?? []) found.push(style.key);
      }
      page = result;
    } else {
      const result = await ctx.db.query("imageSizes").paginate(options);
      for (const row of result.page) found.push(row.key);
      page = result;
    }
    const prefix = PREFIX[args.table];
    const keys = [...new Set(found.filter(isCvx))].map((key) => ({ key, prefix }));
    return { keys, continueCursor: page.continueCursor, isDone: page.isDone };
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
    return null;
  },
});

// Points one page of a table at the R2 copies of its "cvx:" keys.
export const repointPage = internalMutation({
  args: { table: moveTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ patched: v.number(), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const moves = new Map<string, string | null>();
    const moved = async (key: string | undefined) => {
      if (!isCvx(key)) return undefined;
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
    const result = await ctx.db.query("imageSizes").paginate(options);
    for (const row of result.page) {
      // Copies made before R2 existed: dropped, and sizing.backfill makes them again in R2.
      if (isCvx(row.thumbKey) || isCvx(row.mediumKey)) {
        await ctx.db.delete("imageSizes", row._id);
        patched++;
        continue;
      }
      const key = await moved(row.key);
      if (!key) continue;
      const twin = await ctx.db
        .query("imageSizes")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (twin) await ctx.db.delete("imageSizes", row._id);
      else await ctx.db.patch("imageSizes", row._id, { key });
      patched++;
    }
    return { patched, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});
