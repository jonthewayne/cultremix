"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { spellingMisses } from "./lib/spelling";
import { fetchPublicImage } from "./lib/storage";
import { readDesignWords } from "./lib/wordReader";

// Reads each design's lettering and saves the asked-for words it drew a letter or two off
// (convex/spelling.ts). A reading that fails is tried once more; after that the design just shows
// no warning.
export const run = internalAction({
  args: { generationIds: v.array(v.id("generations")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobs = await ctx.runQuery(internal.spelling.jobs, args);
    if (jobs.length === 0 || !process.env.AI_GATEWAY_API_KEY) return null;
    await Promise.all(
      jobs.map(async (job) => {
        if (job.key.startsWith("fake:")) return;
        let lastError = "The reading failed.";
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const started = Date.now();
            const design = await fetchPublicImage(job.key, ctx);
            const { words, costCents } = await readDesignWords(design);
            const misses = spellingMisses(job.words, words);
            console.log("spelling", job.generationId, misses.length, "off", Date.now() - started, "ms", costCents ?? "?", "cents");
            await ctx.runMutation(internal.spelling.save, { generationId: job.generationId, misses, read: words });
            return;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        console.error("spelling failed", job.generationId, lastError);
        await ctx.runMutation(internal.spelling.save, { generationId: job.generationId, error: lastError });
      }),
    );
    return null;
  },
});
