import { v } from "convex/values";
import { query } from "./_generated/server";
import { flagDefault } from "./lib/flags";

export type DeploymentEnv = "dev" | "staging" | "prod";

export function deploymentEnv(): DeploymentEnv {
  const value = process.env.DEPLOYMENT_ENV;
  return value === "prod" || value === "staging" ? value : "dev";
}

// Public and safe signed out: which environment this is and the label to show (A10).
// Staging and dev run on Monad testnet, so CR numbers there carry a Testnet badge;
// production says Early access until checkout opens.
export const get = query({
  args: {},
  returns: v.object({
    deploymentEnv: v.union(v.literal("dev"), v.literal("staging"), v.literal("prod")),
    label: v.union(v.null(), v.literal("testnet"), v.literal("early_access")),
  }),
  handler: async (ctx) => {
    const env = deploymentEnv();
    if (env !== "prod") return { deploymentEnv: env, label: "testnet" as const };
    const checkout = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", "commerce.checkout"))
      .unique();
    const open = checkout ? checkout.enabled : flagDefault("commerce.checkout");
    return { deploymentEnv: env, label: open ? null : ("early_access" as const) };
  },
});
