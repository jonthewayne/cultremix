import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { DEFAULT_APP_SETTINGS } from "./identity";

// Idempotent defaults. Run with `bunx convex run bootstrap:ensureDefaults`.
export const ensureDefaults = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const created: Array<string> = [];
    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (!settings) {
      await ctx.db.insert("appSettings", { ...DEFAULT_APP_SETTINGS, updatedAt: Date.now() });
      created.push("appSettings.main");
    }
    return created;
  },
});
