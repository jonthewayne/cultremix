import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

// Shop rollout switches (KTD-19). Unlike the studio's flags, these default OFF: checkout opens only
// when an admin sets featureFlags "commerce.checkout" to enabled.
export const COMMERCE_FLAG = "commerce.checkout";
export const AUTO_CONFIRM_FLAG = "fulfillment.autoConfirm";

async function flagRow(db: GenericDatabaseReader<DataModel>, key: string) {
  return db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export async function commerceOpen(ctx: { db: GenericDatabaseReader<DataModel> }): Promise<boolean> {
  return (await flagRow(ctx.db, COMMERCE_FLAG))?.enabled === true;
}

// The flag is a kill switch for auto-confirm: absent means allowed, false blocks. The env gate
// (autoConfirmAllowedByEnv) must also pass.
export async function autoConfirmFlagAllows(ctx: { db: GenericDatabaseReader<DataModel> }): Promise<boolean> {
  return (await flagRow(ctx.db, AUTO_CONFIRM_FLAG))?.enabled !== false;
}

export type DeploymentEnv = "dev" | "staging" | "prod" | "unknown";

// DEPLOYMENT_ENV, read strictly: anything unrecognized is "unknown", which is treated like
// production for test orders (no earnings, never printed) and never auto-confirms.
export function deploymentEnv(env: Record<string, string | undefined> = process.env): DeploymentEnv {
  const value = env.DEPLOYMENT_ENV?.trim().toLowerCase();
  if (value === "prod" || value === "production") return "prod";
  if (value === "staging") return "staging";
  if (value === "dev" || value === "development") return "dev";
  return "unknown";
}

// Test orders (Shopify Order.test) create simulated earnings only here.
export function simulatesTestOrders(env: Record<string, string | undefined> = process.env): boolean {
  const current = deploymentEnv(env);
  return current === "dev" || current === "staging";
}

// Printful orders are confirmed (sent to production) only in prod with PRINTFUL_AUTO_CONFIRM=true.
export function autoConfirmAllowedByEnv(env: Record<string, string | undefined> = process.env): boolean {
  return deploymentEnv(env) === "prod" && env.PRINTFUL_AUTO_CONFIRM?.trim().toLowerCase() === "true";
}
