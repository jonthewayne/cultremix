"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { falClient } from "./lib/fal";
import { pngCarriesAlpha } from "./lib/printImage";
import { publicUrl } from "./lib/r2";
import { pollUpscale, submitUpscale } from "./lib/upscaleFlow";
import { storeVersion } from "./printTools";

// "Upscale for print": fal's Topaz Transparent 4x (convex/lib/fal.ts). The flow itself is in
// convex/lib/upscaleFlow.ts: one submission per attempt, the request ID saved before any polling,
// and polling that only reads. Each attempt holds its worst-case fal cost against the daily budget
// from the moment it's admitted (convex/print.ts upscale) until it finishes.

type Job = { version: Doc<"printVersions">; parent: Doc<"printVersions"> | null; family: number; expression: number };

// The largest result we'll download (a 6144 px square PNG is well under this).
const MAX_RESULT_BYTES = 200 * 1024 * 1024;

function client() {
  const key = process.env.FAL_KEY;
  return key ? falClient({ key }) : null;
}

export const submit = internalAction({
  args: { versionId: v.id("printVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: Job | null = await ctx.runQuery(internal.print.versionJob, args);
    if (!job) return null;
    await submitUpscale({
      claim: () => ctx.runMutation(internal.print.claimSubmission, args),
      client: client(),
      imageUrl: publicUrl(job.parent?.key),
      record: async (submission) => {
        await ctx.runMutation(internal.print.recordSubmission, { versionId: args.versionId, ...submission });
      },
      fail: async (error, spend) => {
        await ctx.runMutation(internal.print.failVersion, { versionId: args.versionId, error, spend });
      },
      schedulePoll: async (delayMs) => {
        await ctx.scheduler.runAfter(delayMs, internal.upscale.poll, args);
      },
    });
    return null;
  },
});

export const poll = internalAction({
  args: { versionId: v.id("printVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job: Job | null = await ctx.runQuery(internal.print.versionJob, args);
    const fal = job?.version.fal;
    if (!job || job.version.status !== "pending" || fal?.state !== "submitted" || !fal.statusUrl || !fal.responseUrl) {
      return null;
    }
    const falApi = client();
    const fail = async (error: string) => {
      await ctx.runMutation(internal.print.failVersion, { versionId: args.versionId, error });
    };
    if (!falApi) {
      await fail("Upscaling isn't set up yet.");
      return null;
    }
    await pollUpscale({
      client: falApi,
      statusUrl: fal.statusUrl,
      responseUrl: fal.responseUrl,
      submittedAt: fal.submittedAt ?? job.version._creationTime,
      now: Date.now,
      notePoll: () => ctx.runMutation(internal.print.notePoll, args),
      download: async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The upscale download failed (${response.status}).`);
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > MAX_RESULT_BYTES) throw new Error("The upscale came back too large.");
        return new Uint8Array(await response.arrayBuffer());
      },
      carriesAlpha: pngCarriesAlpha,
      accept: async (bytes, latencyMs) => {
        const saved = await storeVersion(ctx, job, bytes, { latencyMs, requireAlpha: true });
        if (!saved) throw new Error("The upscale was already finished.");
      },
      fail,
      scheduleNext: async (delayMs) => {
        await ctx.scheduler.runAfter(delayMs, internal.upscale.poll, args);
      },
    });
    return null;
  },
});
