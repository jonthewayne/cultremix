"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { compareRemix } from "./lib/remixCompare";
import { missingKeptWords } from "./lib/keptWords";
import { fetchPublicImage } from "./lib/storage";
import { readDesignWords } from "./lib/wordReader";

// Compares a remix design with the design it remixes when its creator opens the publish dialog
// (publish.checkRemix starts it). publish.quick allows a fork only when the remix reads as a new
// design (convex/lib/remixJudge.ts); if the comparison can't run, the remixer chooses. When the
// original's creator keeps some of its words, the remix's lettering is read back beside the
// comparison (about 0.3 cents), and a remix that dropped or replaced one publishes as a fork.
export const compare = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, { generationId }) => {
    const job = await ctx.runQuery(internal.publish.remixCheckJob, { generationId });
    if (!job) return null;
    if (!process.env.AI_GATEWAY_API_KEY || job.designKey.startsWith("fake:") || job.parentKey.startsWith("fake:")) {
      await ctx.runMutation(internal.publish.saveRemixCheck, { generationId, error: "Comparing isn't set up here." });
      return null;
    }
    let lastError = "The comparison failed.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const started = Date.now();
        const [original, remix] = await Promise.all([fetchPublicImage(job.parentKey, ctx), fetchPublicImage(job.designKey, ctx)]);
        // A remix made only with the boxes stays a variation unless a kept word is gone, so it skips
        // the comparison. The original's lettering is read too, so a kept word the reader can't make
        // out even on the original (hand-drawn lettering) isn't counted as missing from the remix.
        const kept = job.kept.length > 0;
        const [result, lettering, before] = await Promise.all([
          job.boxesOnly
            ? Promise.resolve({ verdict: "variation" as const, reason: "It changed only its remixable words and parts.", subject: undefined, layout: undefined, style: undefined, model: undefined, costCents: 0 })
            : compareRemix(original, remix, undefined, job.allowed),
          kept ? readDesignWords(remix) : null,
          kept ? readDesignWords(original) : null,
        ]);
        const unreadable = new Set(before ? missingKeptWords(job.kept, before.words) : []);
        const keptMissing = lettering ? missingKeptWords(job.kept, lettering.words, job.asked).filter((word) => !unreadable.has(word)) : undefined;
        console.log(
          "remixCheck ok",
          generationId,
          result.verdict,
          keptMissing ? `kept words missing: ${keptMissing.join(", ") || "none"}` : "no kept words",
          Date.now() - started,
          "ms",
          result.costCents ?? "?",
          "cents",
        );
        await ctx.runMutation(internal.publish.saveRemixCheck, {
          generationId,
          verdict: result.verdict,
          reason: result.reason || undefined,
          subject: result.subject,
          layout: result.layout,
          style: result.style,
          model: result.model,
          keptMissing,
          keptCompared: job.kept,
        });
        return null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error("remixCheck attempt failed", attempt, lastError);
      }
    }
    await ctx.runMutation(internal.publish.saveRemixCheck, { generationId, error: lastError.slice(0, 200) });
    return null;
  },
});
