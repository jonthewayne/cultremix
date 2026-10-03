import type { MutationCtx, QueryCtx } from "../_generated/server";
import { publicUrl } from "./r2";

// What pages load for a stored image: the original (download, "Open full size", publishing, the
// print upscale) and its WebP thumbnail and medium (convex/lib/sizes.ts). Until an image's copies
// are made, both fall back to the original.
export type ImageUrls = { url?: string; thumbUrl?: string; mediumUrl?: string };

// One reader per query: each key's sizes are looked up once, however often the key appears.
export function imageUrlReader(ctx: QueryCtx | MutationCtx) {
  const cache = new Map<string, Promise<ImageUrls>>();
  return (key: string | undefined): Promise<ImageUrls> => {
    if (!key) return Promise.resolve({});
    let urls = cache.get(key);
    if (!urls) {
      urls = read(ctx, key);
      cache.set(key, urls);
    }
    return urls;
  };
}

async function read(ctx: QueryCtx | MutationCtx, key: string): Promise<ImageUrls> {
  const url = publicUrl(key);
  if (!url || key.startsWith("fake:")) return { url, thumbUrl: url, mediumUrl: url };
  const sizes = await ctx.db
    .query("imageSizes")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return {
    url,
    thumbUrl: (sizes && publicUrl(sizes.thumbKey)) || url,
    mediumUrl: (sizes && publicUrl(sizes.mediumKey)) || url,
  };
}
