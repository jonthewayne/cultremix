import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { newTest } from "./setup";

// Studio uploads (imageGen.uploadInspiration): each new file is stored and read for its notes, so
// a member can add at most 60 new images an hour (images.admitUpload). "Add a part" asks a model
// each time, at most 30 an hour (remixParts.admitDescribe).

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("studio uploads", () => {
  it("lets a member store 60 new images an hour, then asks them to wait", async () => {
    const t = newTest();
    const [maker, other] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { authId: "test|maker", username: "maker", usernameLower: "maker" }),
      await ctx.db.insert("users", { authId: "test|other", username: "other", usernameLower: "other" }),
    ]);
    for (let i = 0; i < 60; i++) await t.mutation(internal.images.admitUpload, { userId: maker });
    await expect(t.mutation(internal.images.admitUpload, { userId: maker })).rejects.toThrow(/a lot of new images/u);
    // Someone else isn't held up, and the hour passing lets the member go on.
    await t.mutation(internal.images.admitUpload, { userId: other });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    await t.mutation(internal.images.admitUpload, { userId: maker });
  });

  it("lets a creator describe 30 new remixable parts an hour", async () => {
    const t = newTest();
    const maker = await t.run((ctx) => ctx.db.insert("users", { authId: "test|maker", username: "maker", usernameLower: "maker" }));
    for (let i = 0; i < 30; i++) await t.mutation(internal.remixParts.admitDescribe, { userId: maker });
    await expect(t.mutation(internal.remixParts.admitDescribe, { userId: maker })).rejects.toThrow(/a lot of new parts/u);
  });
});
