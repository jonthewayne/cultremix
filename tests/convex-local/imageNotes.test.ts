import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { newTest } from "./setup";

// Notes are re-read when the notes prompt changes (images:reanalyze, images:reanalyzeAll). A re-read
// that fails must not cost an image the notes it already had: the studio uses notes only when ready.
describe("image notes", () => {
  it("keeps an image's notes when a re-read fails, and marks a failed first read", async () => {
    const t = newTest();
    const [reread, first] = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { authId: "test|sam", name: "sam" });
      const base = { ownerId, analysis: "pending" as const, usedAt: 1 };
      return [
        await ctx.db.insert("userImages", { ...base, key: "members/a/uploads/x/original.png", summary: "a cartoon", notes: "Technique: flat cartoon." }),
        await ctx.db.insert("userImages", { ...base, key: "members/a/uploads/y/original.png" }),
      ];
    });
    await t.mutation(internal.images.saveAnalysis, { imageId: reread, model: "m", error: "timed out" });
    await t.mutation(internal.images.saveAnalysis, { imageId: first, model: "m", error: "timed out" });
    const [a, b] = await t.run(async (ctx) => [await ctx.db.get("userImages", reread), await ctx.db.get("userImages", first)]);
    expect(a).toMatchObject({ analysis: "ready", summary: "a cartoon", notes: "Technique: flat cartoon." });
    expect(b).toMatchObject({ analysis: "failed", analysisError: "timed out" });
  });
});
