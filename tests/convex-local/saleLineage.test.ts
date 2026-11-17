import { describe, expect, it } from "vitest";
import { resolveLineage } from "../../convex/lib/shopLineage";
import { newTest } from "./setup";
import { makeUser, makeWork } from "./shopFixtures";

// Sales follow a confirmed lineage correction (works.effectiveKind and effectiveParentWorkId), as
// the work page's economics panel does.
describe("a sale's lineage", () => {
  it("follows a confirmed correction from variation to fork", async () => {
    const t = newTest();
    const a = await makeUser(t, { name: "A", creatorNumber: 2 });
    const b = await makeUser(t, { name: "B", creatorNumber: 3 });
    const u = await makeUser(t, { name: "U", creatorNumber: 4 });
    const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/p/print.png" });
    const elsewhere = await makeWork(t, { creatorId: u, family: 102, expression: 1, printKey: "works/102/001/p/print.png" });
    const remix = await makeWork(t, { creatorId: b, family: 101, expression: 2, parent: root, root, printKey: "works/101/002/p/print.png" });
    const before = await t.run(async (ctx) => resolveLineage(ctx.db, (await ctx.db.get("works", remix))!));
    expect(before).toEqual({ kind: "variation", creator: b, root: { kind: "original", creator: a } });
    // Staff find it was really a fork of another design.
    await t.run((ctx) => ctx.db.patch("works", remix, { effectiveKind: "fork", effectiveParentWorkId: elsewhere }));
    const after = await t.run(async (ctx) => resolveLineage(ctx.db, (await ctx.db.get("works", remix))!));
    expect(after).toEqual({ kind: "fork", creator: b, parentCreator: u });
  });
});
