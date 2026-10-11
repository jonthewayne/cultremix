"use node";

import { gateway } from "@ai-sdk/gateway";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";

async function readCredit() {
  const credits = await gateway.getCredits();
  const balanceCents = Math.round(Number.parseFloat(credits.balance) * 100);
  const usedCents = Math.round(Number.parseFloat(credits.totalUsed) * 100);
  return Number.isFinite(balanceCents) ? { balanceCents, usedCents: Number.isFinite(usedCents) ? usedCents : 0 } : null;
}

// The hourly credit watch (crons.ts), also started when a batch fails for lack of credit: reads the
// balance and tells the owner and ops when it drops (convex/opsAlerts.ts).
export const watch = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!process.env.AI_GATEWAY_API_KEY) return null;
    try {
      const credit = await readCredit();
      if (credit) await ctx.runMutation(internal.opsAlerts.recordGatewayCredit, { balanceCents: credit.balanceCents });
    } catch (error) {
      console.warn("gateway credit watch", error instanceof Error ? error.message : String(error));
    }
    return null;
  },
});

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
      return await readCredit();
    } catch (error) {
      console.warn("gateway credit", error instanceof Error ? error.message : String(error));
      return null;
    }
  },
});
