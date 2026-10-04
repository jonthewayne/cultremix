import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { DEFAULT_APP_SETTINGS } from "./identity";
import { FIRST_ASSIGNED_CREATOR_NUMBER } from "./lib/creators";
import { FEATURE_FLAGS } from "./lib/flags";

// Idempotent setup for a fresh environment (scripts/seed-environment.ts). It only adds rows
// that are missing and never changes or copies existing data, so it is safe to run again.
// Flags start at their defaults: the studio and publishing on; checkout, Monad records,
// backs, and print-size art off until each is ready in that environment.
export const environment = internalMutation({
  args: {},
  returns: v.object({ created: v.array(v.string()), kept: v.array(v.string()) }),
  handler: async (ctx) => {
    const created: Array<string> = [];
    const kept: Array<string> = [];

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (settings) kept.push("appSettings.main");
    else {
      await ctx.db.insert("appSettings", { ...DEFAULT_APP_SETTINGS, updatedAt: Date.now() });
      created.push("appSettings.main");
    }

    for (const flag of FEATURE_FLAGS) {
      const row = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", flag.key))
        .unique();
      if (row) kept.push(`featureFlags.${flag.key}`);
      else {
        await ctx.db.insert("featureFlags", { key: flag.key, enabled: flag.defaultOn });
        created.push(`featureFlags.${flag.key}`);
      }
    }

    const counters = [
      { name: "crFamily", next: 101 },
      { name: "creatorNumber", next: FIRST_ASSIGNED_CREATOR_NUMBER },
    ];
    for (const counter of counters) {
      const row = await ctx.db
        .query("counters")
        .withIndex("by_name", (q) => q.eq("name", counter.name))
        .unique();
      if (row) kept.push(`counters.${counter.name}`);
      else {
        await ctx.db.insert("counters", counter);
        created.push(`counters.${counter.name}`);
      }
    }
    return { created, kept };
  },
});
