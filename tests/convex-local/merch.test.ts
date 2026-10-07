import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// Shirt products (convex/merch.ts): the active product's offered colors are the palette that the
// studio previews on and publishing validates against; without one, the launch colors.

type T = ReturnType<typeof newTest>;

async function member(t: T, name: string, platformRole: "user" | "super_admin_owner" = "user") {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { authId: `test|${name}`, username: name, usernameLower: name, email: `${name}@example.com`, platformRole }),
  );
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

const COLORS = [
  { key: "black", name: "Black", hex: "#1b1b1c", variants: [{ size: "M", id: 1 }], inStock: true, offered: false },
  { key: "mustard", name: "Mustard", hex: "#ffbc5a", variants: [{ size: "M", id: 2 }], inStock: true, offered: false },
  { key: "emerald", name: "Emerald", hex: "#306d6e", variants: [{ size: "M", id: 3 }], inStock: true, offered: false },
];

async function tile(t: T, ownerId: Id<"users">) {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", { ownerId, updatedAt: 1, phrase: "", styleDirection: "", presets: [] });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: "x",
      presets: [],
      backgroundColor: "#ffc060",
      operation: "create",
      model: "test",
      count: 1,
    });
    return await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "test",
      model: "test",
      charged: true,
      favorite: false,
      fullKey: `fake:${Math.random()}`,
    });
  });
}

describe("the active shirt's palette", () => {
  it("falls back to the launch colors, then offers the active product's picked colors", async () => {
    const t = newTest();
    const owner = await member(t, "owner", "super_admin_owner");
    const alice = await member(t, "alice");
    expect((await t.query(api.merch.palette, {})).product).toBeNull();
    expect((await t.query(api.merch.palette, {})).colors.some((c) => c.key === "watermelon")).toBe(true);

    await t.mutation(internal.merch.saveProduct, { productId: 586, name: "Comfort Colors 1717", colors: COLORS, addedBy: owner.userId });
    const [product] = await owner.as.query(api.merch.adminList, {});
    // A new product starts with the colors offered now that it also has (black is a launch color).
    expect(product.colors.filter((c) => c.offered).map((c) => c.key)).toEqual(["black"]);
    await expect(alice.as.mutation(api.merch.adminSetColors, { productId: product._id, offered: ["mustard"] })).rejects.toThrow();
    await owner.as.mutation(api.merch.adminSetColors, { productId: product._id, offered: ["mustard", "emerald"] });
    await owner.as.mutation(api.merch.adminSetActive, { productId: product._id });
    await expect(owner.as.mutation(api.merch.adminSetColors, { productId: product._id, offered: [] })).rejects.toThrow(/at least one/);

    const palette = await t.query(api.merch.palette, {});
    expect(palette.product?.name).toBe("Comfort Colors 1717");
    expect(palette.colors.map((c) => c.key)).toEqual(["mustard", "emerald"]);

    // Publishing offers and validates the palette: the design's own nearest color leads.
    const generationId = await tile(t, alice.userId);
    expect((await alice.as.query(api.publish.preview, { generationId }))?.defaultColors).toEqual(["mustard", "emerald"]);
    await expect(alice.as.mutation(api.publish.quick, { requestId: "r1", generationId, offeredColors: ["watermelon"] })).rejects.toThrow(/swatch board/);
    const { workId } = await alice.as.mutation(api.publish.quick, { requestId: "r2", generationId });
    expect(await t.run((ctx) => ctx.db.get("works", workId))).toMatchObject({ offeredColors: ["mustard", "emerald"], backgroundColor: "#ffbc5a" });

    // Back to the launch colors.
    await owner.as.mutation(api.merch.adminSetActive, { productId: null });
    expect((await t.query(api.merch.palette, {})).product).toBeNull();
  });
});

