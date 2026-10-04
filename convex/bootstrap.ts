import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { DEFAULT_APP_SETTINGS } from "./identity";
import { CHAIN_WRITES_FLAG } from "./lib/chain/queue";

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
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", "gen.vercel"))
      .unique();
    if (!flag) {
      await ctx.db.insert("featureFlags", { key: "gen.vercel", enabled: true });
      created.push("featureFlags.gen.vercel");
    }
    // Chain writes fail closed without this row; they start on in dev only (convex/lib/chain/queue.ts).
    const chainFlag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", CHAIN_WRITES_FLAG))
      .unique();
    if (!chainFlag) {
      await ctx.db.insert("featureFlags", { key: CHAIN_WRITES_FLAG, enabled: process.env.DEPLOYMENT_ENV === "dev" });
      created.push(`featureFlags.${CHAIN_WRITES_FLAG}`);
    }
    const counter = await ctx.db
      .query("counters")
      .withIndex("by_name", (q) => q.eq("name", "crFamily"))
      .unique();
    if (!counter) {
      await ctx.db.insert("counters", { name: "crFamily", next: 101 });
      created.push("counters.crFamily");
    }
    return created;
  },
});

// Dev only: clears studio and publishing data so the dev feed starts clean
// (the CR counter restarts at 101). Run with `bunx convex run bootstrap:devReset`.
// Chain writes, Backs, and relayer state go too. The dev registry still holds the old CR numbers,
// so deploy a fresh dev registry (CHAIN_REGISTRY_ADDRESS) after a reset or registrations hit
// FamilyTaken.
export const devReset = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    if (process.env.DEPLOYMENT_ENV !== "dev") throw new Error("devReset runs only on dev.");
    const cleared: Array<string> = [];
    const tables = [
      "shootPhotos",
      "shoots",
      "works",
      "crFamilies",
      "generations",
      "batches",
      "creativeSessions",
      "chainWrites",
      "backs",
      "relayerState",
    ] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(table, row._id);
      cleared.push(`${table}: ${rows.length}`);
    }
    const ledger = await ctx.db.query("creditLedger").collect();
    let ledgerRows = 0;
    for (const row of ledger) {
      if (row.kind !== "grant") {
        await ctx.db.delete("creditLedger", row._id);
        ledgerRows++;
      }
    }
    cleared.push(`creditLedger (non-grant): ${ledgerRows}`);
    const counter = await ctx.db
      .query("counters")
      .withIndex("by_name", (q) => q.eq("name", "crFamily"))
      .unique();
    if (counter) await ctx.db.patch("counters", counter._id, { next: 101 });
    return cleared;
  },
});
