import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

async function member(t: T, name: string) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { authId: `test|${name}`, username: name, usernameLower: name, email: `${name}@example.com` }),
  );
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

// A finished studio tile on a background, optionally made while remixing a work.
async function tile(t: T, ownerId: Id<"users">, backgroundColor = "#ffffff", remixOfWorkId?: Id<"works">) {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId,
      updatedAt: Date.now(),
      phrase: "",
      styleDirection: "",
      presets: [],
      remixOfWorkId,
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: "a secret prompt",
      presets: [],
      backgroundColor,
      operation: remixOfWorkId ? "remix" : "create",
      model: "test",
      count: 1,
    });
    return await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId,
      index: 0,
      kind: remixOfWorkId ? "remix" : "concept",
      status: "succeeded",
      provider: "test",
      model: "test",
      charged: true,
      favorite: false,
      fullKey: `fake:${Math.random()}`,
    });
  });
}

let requestCounter = 0;
const requestId = () => `pub-${(requestCounter += 1)}`;

const setFlag = (t: T, key: string, enabled: boolean) =>
  t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", { key, enabled });
  });

describe("offered colors", () => {
  it("saves the chosen colors, lead first, the description, and the lead as the background", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId);
    const { workId } = await alice.as.mutation(api.publish.quick, {
      requestId: requestId(),
      generationId,
      title: "Night swim",
      description: "  Made for the last warm night.  ",
      offeredColors: ["black", " Butter ", "black"],
    });
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work).toMatchObject({
      title: "Night swim",
      description: "Made for the last warm night.",
      offeredColors: ["black", "butter"],
      backgroundColor: "#1f1f1f",
    });
  });

  it("refuses colors the shirt doesn't come in, and an empty list", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId);
    await expect(
      alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId, offeredColors: ["black", "#ff00ff"] }),
    ).rejects.toThrow(/swatch board/);
    await expect(
      alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId, offeredColors: [] }),
    ).rejects.toThrow(/at least one/);
    const works = await t.run((ctx) => ctx.db.query("works").collect());
    expect(works).toHaveLength(0);
  });

  it("starts from the design's own shade plus the defaults when no colors are sent", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId, "#2d3548");
    const { workId } = await alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId });
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work?.offeredColors).toEqual(["true-navy", "ivory", "black", "butter"]);
    expect(work?.backgroundColor).toBe("#2c3447");
  });

  it("keeps descriptions short", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId);
    const { workId } = await alice.as.mutation(api.publish.quick, {
      requestId: requestId(),
      generationId,
      description: "x".repeat(500),
    });
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work?.description).toHaveLength(280);
  });
});

describe("the publishing flag", () => {
  it("refuses new publishes while off, and still answers a publish already made", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const first = await tile(t, alice.userId);
    const firstRequest = requestId();
    const made = await alice.as.mutation(api.publish.quick, { requestId: firstRequest, generationId: first });

    await setFlag(t, "publishing", false);
    expect(await t.query(api.publish.availability, {})).toEqual({ publishing: false });
    const second = await tile(t, alice.userId);
    await expect(alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId: second })).rejects.toThrow(
      /Publishing is paused/,
    );
    // A retry of the earlier publish (a double tap, a dropped connection) still gets its number.
    const retried = await alice.as.mutation(api.publish.quick, { requestId: firstRequest, generationId: first });
    expect(retried).toEqual(made);
    // The publish already under way keeps going: its art copy and photo still read it, and the
    // studio's preview says publishing is paused.
    expect(await t.query(internal.publish.assetJob, { workId: made.workId })).toMatchObject({ crFamily: 101 });
    expect((await alice.as.query(api.publish.preview, { generationId: second }))?.publishing).toBe(false);
  });

  it("is on when no one has set it", async () => {
    const t = newTest();
    expect(await t.query(api.publish.availability, {})).toEqual({ publishing: true });
  });
});

describe("the publish preview", () => {
  it("shows the next family number, and the variation number and a lineage line for a remix", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const generationId = await tile(t, alice.userId);
    const before = await alice.as.query(api.publish.preview, { generationId });
    expect(before).toMatchObject({ publishing: true, newFamilyCr: "101-001" });
    expect(before?.remix).toBeUndefined();
    expect(before?.defaultColors).toHaveLength(4);

    const root = await alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId, title: "Tide" });
    await t.run((ctx) => ctx.db.patch("works", root.workId, { status: "published", publishedAt: Date.now() }));

    const remix = await tile(t, bob.userId, "#ffffff", root.workId);
    const preview = await bob.as.query(api.publish.preview, { generationId: remix });
    expect(preview).toMatchObject({
      newFamilyCr: "102-001",
      remix: { parentCr: "101-001", variationCr: "101-002", summary: "A remix of CR 101-001 “Tide” by @alice." },
    });
    // Only the tile's owner sees it.
    expect(await alice.as.query(api.publish.preview, { generationId: remix })).toBeNull();
    expect(await t.query(api.publish.preview, { generationId: remix })).toBeNull();
  });
});

describe("the shop page signed out", () => {
  it("returns only public fields, with the description and the offered colors", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId);
    const { workId, cr } = await alice.as.mutation(api.publish.quick, {
      requestId: requestId(),
      generationId,
      title: "Tide",
      description: "Salt and sun.",
      offeredColors: ["moss", "ivory"],
    });
    await t.run((ctx) =>
      ctx.db.patch("works", workId, { status: "published", publishedAt: Date.now(), notes: "private style notes" }),
    );

    const page = await t.query(api.feed.byCr, { cr });
    expect(page).not.toBeNull();
    for (const key of Object.keys(page!)) expect(["colors", "contentHash", "description", "item"]).toContain(key);
    expect(page!.description).toBe("Salt and sun.");
    expect(page!.colors).toEqual([
      { key: "moss", name: "Moss", hex: "#6c6c47" },
      { key: "ivory", name: "Ivory", hex: "#efe8d8" },
    ]);
    const text = JSON.stringify(page);
    for (const secret of ["a secret prompt", "private style notes", "alice@example.com", "requestId", "generationId", "notes"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(page!.item.creator).sort()).toEqual(["username"]);
  });

  it("shows one color for works published before colors were chosen", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const generationId = await tile(t, alice.userId);
    const { workId, cr } = await alice.as.mutation(api.publish.quick, { requestId: requestId(), generationId });
    await t.run((ctx) =>
      ctx.db.patch("works", workId, {
        status: "published",
        publishedAt: Date.now(),
        offeredColors: undefined,
        backgroundColor: "#f4f1ea",
      }),
    );
    const page = await t.query(api.feed.byCr, { cr });
    expect(page?.colors).toEqual([{ key: "custom", name: "Off-white", hex: "#f4f1ea" }]);
    expect(page?.description).toBeUndefined();
  });
});
