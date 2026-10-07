"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { describePart, proposeParts } from "./lib/partsReader";
import { proposeRemixFields } from "./lib/remixFields";
import { remixTarget as target } from "./lib/remixTarget";

// The Luna calls behind remixable parts (convex/remixParts.ts): proposing a design's parts from its
// notes, and turning a creator's description into one more part.

// How long "Make it remixable" waits for a design's notes (written once per image, usually 10-20 s).
const NOTES_WAIT_MS = 90_000;
const POLL_MS = 3_000;

export const proposeForDesign = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, { generationId }) => {
    const started = Date.now();
    let job = await ctx.runQuery(internal.remixParts.designJob, { generationId });
    while (job && job.analysis === "pending" && Date.now() - started < NOTES_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await ctx.runQuery(internal.remixParts.designJob, { generationId });
    }
    if (!job) return null;
    if (job.analysis !== "ready" || !job.notes) {
      await ctx.runMutation(internal.remixParts.saveDesignSetup, { generationId, error: "Couldn't read this design. Try again." });
      return null;
    }
    const parts = await proposeParts(job.notes);
    console.log("proposeForDesign", generationId, Date.now() - started, "ms", parts?.map((p) => `${p.kind}:${p.label}`).join(", ") ?? "no answer");
    await ctx.runMutation(internal.remixParts.saveDesignSetup, { generationId, fields: proposeRemixFields(job.notes), parts: parts ?? [] });
    return null;
  },
});

// After a published work's notes are written, when it has no parts from a setup or its parent.
export const proposeForWork = internalAction({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, { workId }) => {
    const job = await ctx.runQuery(internal.remixParts.workJob, { workId });
    if (!job) return null;
    const parts = await proposeParts(job.notes);
    if (parts) await ctx.runMutation(internal.remixParts.saveWorkParts, { workId, parts });
    return null;
  },
});

// "Add a part": the creator describes it ("let people change the number of elves").
export const describe = action({
  args: { target, words: v.string() },
  returns: v.object({ added: v.boolean(), label: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ added: boolean; label?: string }> => {
    const words = args.words.replace(/\s+/gu, " ").trim().slice(0, 300);
    if (!words) throw new ConvexError({ code: "INVALID_INPUT", message: "Say what people should be able to change." });
    const user = await ctx.runQuery(internal.remixParts.viewerId, {});
    if (!user) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
    const job = await ctx.runQuery(internal.remixParts.describeJob, { target: args.target, userId: user });
    if (!job) throw new ConvexError({ code: "NOT_READY", message: "Still reading the design." });
    const part = await describePart(job.notes, words, job.parts);
    if (!part) return { added: false };
    const added = await ctx.runMutation(internal.remixParts.addPart, { target: args.target, part });
    return { added, label: added ? part.label : undefined };
  },
});

// One-time, after deploying remixable parts: proposes parts for published works that have notes
// and none yet. Safe to run again. bunx convex run remixPartsActions:backfillWorks (--prod)
export const backfillWorks = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), saved: v.number() }),
  handler: async (ctx): Promise<{ checked: number; saved: number }> => {
    const ids = await ctx.runQuery(internal.remixParts.worksWithoutParts, {});
    let saved = 0;
    for (const workId of ids) {
      const job = await ctx.runQuery(internal.remixParts.workJob, { workId });
      if (!job) continue;
      const parts = await proposeParts(job.notes);
      if (!parts) continue;
      await ctx.runMutation(internal.remixParts.saveWorkParts, { workId, parts });
      saved++;
    }
    return { checked: ids.length, saved };
  },
});
