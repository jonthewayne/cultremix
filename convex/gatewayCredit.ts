"use node";

import { gateway } from "@ai-sdk/gateway";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

// What's left on the CultRemix Gateway account, for Admin, Overview. Every design, note, and model
// photo is paid from it, and once it runs out every call fails, so Admin shows it with a warning
// when it's low. Null when the gateway isn't set up or doesn't answer.
export const balance = action({
  args: {},
  returns: v.union(v.null(), v.object({ balanceCents: v.number(), usedCents: v.number() })),
  handler: async (ctx): Promise<{ balanceCents: number; usedCents: number } | null> => {
    if (!(await ctx.runQuery(internal.admin.viewerIsAdmin, {}))) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admins only." });
    }
    if (!process.env.AI_GATEWAY_API_KEY) return null;
    try {
      const credits = await gateway.getCredits();
      const balanceCents = Math.round(Number.parseFloat(credits.balance) * 100);
      const usedCents = Math.round(Number.parseFloat(credits.totalUsed) * 100);
      return Number.isFinite(balanceCents) ? { balanceCents, usedCents: Number.isFinite(usedCents) ? usedCents : 0 } : null;
    } catch (error) {
      console.warn("gateway credit", error instanceof Error ? error.message : String(error));
      return null;
    }
  },
});
