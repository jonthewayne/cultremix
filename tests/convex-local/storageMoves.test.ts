import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";

// The database half of sizing.organize (convex/storageMoves.ts): batch numbers, where each old key
// goes, and patching a batch's inputs.

const SHA = "0123456789abcdef".repeat(4);
const OLD_DESIGN = "designs/" + SHA + "/original.png";
const OLD_UPLOAD = "uploads/" + SHA + "/original.jpg";
const OLD_GRID = "grids/" + SHA + "/original.png";
// Real Convex IDs are lowercase letters and digits; convex-test's aren't, so target paths use these.
const MEMBER = "k17cqvg0q4m23jgrwqt3zc92zn8fdce4";
const SESSION = "ks7fw0vp2ax9hn75jtv2aa3z458fj0mj";

async function seed(t: ReturnType<typeof newTest>) {
  return await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { authId: "test|alice", username: "alice" });
    const bob = await ctx.db.insert("users", { authId: "test|bob", username: "bob" });
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: alice,
      updatedAt: 0,
      phrase: "x",
      styleDirection: "",
      presets: [],
    });
    const batch = (extra: Record<string, unknown> = {}) =>
      ctx.db.insert("batches", {
        sessionId,
        ownerId: alice,
        instruction: "x",
        presets: [],
        backgroundColor: "#ffffff",
        operation: "edit" as const,
        model: "m",
        count: 4,
        ...extra,
      });
    const b1 = await batch();
    const b2 = await batch({ images: [], gridKey: OLD_GRID });
    const b3 = await batch();
    return { alice, bob, sessionId, batches: [b1, b2, b3] as Array<Id<"batches">> };
  });
}

describe("storageMoves", () => {
  it("numbers a session's batches in the order they were made, once", async () => {
    const t = newTest();
    const { sessionId, batches } = await seed(t);
    const first = await t.mutation(internal.storageMoves.numberPage, { cursor: null, numItems: 10 });
    expect(first.numbered).toBe(3);
    const numbers = await t.run(async (ctx) => Promise.all(batches.map(async (id) => (await ctx.db.get("batches", id))?.number)));
    expect(numbers).toEqual([1, 2, 3]);
    expect((await t.run((ctx) => ctx.db.get("creativeSessions", sessionId)))?.batchCount).toBe(3);
    expect((await t.mutation(internal.storageMoves.numberPage, { cursor: null, numItems: 10 })).numbered).toBe(0);
  });

  it("sends a published work's art to its work, a moved design where it went, and anything else to the member's uploads", async () => {
    const t = newTest();
    const { alice, bob, sessionId, batches } = await seed(t);
    const workId = await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        sessionId,
        batchId: batches[0],
        ownerId: alice,
        index: 0,
        kind: "concept",
        status: "succeeded",
        provider: "gateway",
        model: "m",
        charged: false,
        favorite: false,
        fullKey: OLD_DESIGN,
      });
      return await ctx.db.insert("works", {
        crFamily: 101,
        crExpression: 1,
        creatorId: alice,
        kind: "original",
        generationId,
        requestId: "r1",
        backgroundColor: "#ffffff",
        status: "published",
        artKey: OLD_DESIGN,
      });
    });
    expect(await t.query(internal.storageMoves.resolveKey, { key: OLD_DESIGN, memberId: bob })).toEqual({
      kind: "work",
      workId,
      family: 101,
      expression: 1,
    });

    const movedDesign = "designs/" + "f".repeat(64) + "/original.png";
    const target = "members/" + MEMBER + "/sessions/2026-10-03-" + SESSION + "/batch-01/design-1-" + "a".repeat(26) + "/original.png";
    await t.mutation(internal.storageMoves.recordMove, { from: movedDesign, to: target, sha256: "abc" });
    expect(await t.query(internal.storageMoves.resolveKey, { key: movedDesign, memberId: bob })).toEqual({
      kind: "moved",
      to: target,
      sha256: "abc",
    });

    // The same uploaded file stays separate per member.
    const forAlice = await t.query(internal.storageMoves.resolveKey, { key: OLD_UPLOAD, memberId: alice });
    expect(forAlice).toEqual({ kind: "upload", from: "upload:" + alice + ":" + OLD_UPLOAD });
    const aliceUpload = "members/" + MEMBER + "/uploads/2026-10-03-" + "b".repeat(26) + "/original.jpg";
    await t.mutation(internal.storageMoves.recordMove, { from: "upload:" + alice + ":" + OLD_UPLOAD, to: aliceUpload });
    expect(await t.query(internal.storageMoves.resolveKey, { key: OLD_UPLOAD, memberId: alice })).toMatchObject({
      kind: "moved",
      to: aliceUpload,
    });
    expect(await t.query(internal.storageMoves.resolveKey, { key: OLD_UPLOAD, memberId: bob })).toEqual({
      kind: "upload",
      from: "upload:" + bob + ":" + OLD_UPLOAD,
    });

    // A record from an earlier layout (its target isn't in the current one) is ignored.
    const older = "gen/" + SHA + ".png";
    await t.mutation(internal.storageMoves.recordMove, { from: older, to: OLD_DESIGN });
    expect(await t.query(internal.storageMoves.resolveKey, { key: older, memberId: alice })).toEqual({
      kind: "upload",
      from: "upload:" + alice + ":" + older,
    });
  });

  it("repoints a batch's grid and every input that moved", async () => {
    const t = newTest();
    const { alice, batches } = await seed(t);
    const imageId = await t.run((ctx) =>
      ctx.db.insert("userImages", { ownerId: alice, key: OLD_UPLOAD, sha256: SHA, analysis: "ready", usedAt: 0 }),
    );
    await t.run((ctx) =>
      ctx.db.patch("batches", batches[1], {
        inspirationKey: OLD_UPLOAD,
        images: [{ imageId, key: OLD_UPLOAD }],
        styles: [{ imageId, key: OLD_UPLOAD, weight: 100 }],
      }),
    );
    const to = "members/" + MEMBER + "/uploads/2026-10-03-" + "c".repeat(26) + "/original.jpg";
    const grid = "members/" + MEMBER + "/sessions/2026-10-03-" + SESSION + "/batch-02/grid-" + "d".repeat(26) + ".png";
    await t.mutation(internal.storageMoves.setBatch, { batchId: batches[1], gridKey: grid, inputs: [{ from: OLD_UPLOAD, to }] });
    const batch = await t.run((ctx) => ctx.db.get("batches", batches[1]));
    expect(batch?.gridKey).toBe(grid);
    expect(batch?.inspirationKey).toBe(to);
    expect(batch?.images?.[0].key).toBe(to);
    expect(batch?.styles?.[0]).toMatchObject({ key: to, weight: 100 });
  });
});
