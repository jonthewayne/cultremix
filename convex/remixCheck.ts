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
        const [result, lettering] = await Promise.all([
          compareRemix(original, remix, undefined, job.allowed),
          job.kept.length > 0 ? readDesignWords(remix) : null,
        ]);
        const keptMissing = lettering ? missingKeptWords(job.kept, lettering.words, job.asked) : undefined;
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
