import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Records of each stored image's thumbnail and medium copies (convex/lib/sizes.ts). The copies
// are made in Node actions (makeSizes in convex/lib/storage.ts); these are the database steps.

const sizesView = v.object({
  thumbKey: v.string(),
  mediumKey: v.string(),
  width: v.number(),
  height: v.number(),
});

// The copies recorded for an image's key. Each folder keeps its own (convex/lib/sizes.ts).
export const find = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.null(), sizesView),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("imageSizes")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    return row ? { thumbKey: row.thumbKey, mediumKey: row.mediumKey, width: row.width, height: row.height } : null;
  },
});

export const record = internalMutation({
  args: {
    key: v.string(),
    sha256: v.string(),
    width: v.number(),
    height: v.number(),
    thumbKey: v.string(),
    mediumKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imageSizes")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!existing) await ctx.db.insert("imageSizes", args);
    return null;
  },
});

const sizedTable = v.union(v.literal("generations"), v.literal("works"), v.literal("shootPhotos"), v.literal("userImages"));

// One page of stored image keys from a table, for sizing.backfill.
export const keysPage = internalQuery({
  args: { table: sizedTable, cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ keys: v.array(v.string()), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const options = { cursor: args.cursor, numItems: args.numItems };
    let keys: Array<string | undefined>;
    let page: { continueCursor: string; isDone: boolean };
    if (args.table === "generations") {
      const result = await ctx.db.query("generations").paginate(options);
      keys = result.page.filter((g) => g.status === "succeeded").map((g) => g.fullKey);
      page = result;
    } else if (args.table === "works") {
      const result = await ctx.db.query("works").paginate(options);
      keys = result.page.map((w) => w.artKey);
      page = result;
    } else if (args.table === "shootPhotos") {
      const result = await ctx.db.query("shootPhotos").paginate(options);
      keys = result.page.filter((p) => p.state === "succeeded").map((p) => p.publicKey);
      page = result;
    } else {
      const result = await ctx.db.query("userImages").paginate(options);
      keys = result.page.map((image) => image.key);
      page = result;
    }
    return {
      keys: keys.filter((key): key is string => Boolean(key) && !key!.startsWith("fake:")),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
