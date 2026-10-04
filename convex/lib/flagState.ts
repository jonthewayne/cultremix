import { flagDefault } from "./flags";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// A feature flag's current value: its row, or the flag's default when it has no row yet
// (convex/lib/flags.ts). Unlike studio.ts's flagEnabled, a default-off flag reads as off.
export async function isFlagOn(ctx: QueryCtx | MutationCtx, key: string): Promise<boolean> {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row ? row.enabled : flagDefault(key);
}
