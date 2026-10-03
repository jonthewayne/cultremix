import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { newTest } from "./setup";

describe("convex-test harness", () => {
  it("runs a mutation against the schema and reads the rows back", async () => {
    const t = newTest();
    const created = await t.mutation(internal.bootstrap.ensureDefaults, {});
    expect(created).toContain("appSettings.main");
    expect(await t.mutation(internal.bootstrap.ensureDefaults, {})).toEqual([]);
    const counter = await t.run((ctx) =>
      ctx.db.query("counters").withIndex("by_name", (q) => q.eq("name", "crFamily")).unique(),
    );
    expect(counter?.next).toBe(101);
  });
});
