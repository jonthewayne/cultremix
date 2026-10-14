import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

async function member(t: T, name: string, platformRole?: "super_admin_owner" | "super_admin_ops") {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { authId: `test|${name}`, username: name, usernameLower: name, platformRole }),
  );
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

// A finished studio tile, optionally made while remixing a work. A remix's batch can say what it
// asked for and which art was image 1.
async function tile(
  t: T,
  ownerId: Id<"users">,
  remixOfWorkId?: Id<"works">,
  made: { instruction?: string; inspirationKey?: string } = {},
) {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId,
      updatedAt: Date.now(),
      phrase: "",
      styleDirection: "",
      presets: [],
      remixOfWorkId,
      remixMode: remixOfWorkId ? "variation" : undefined,
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: made.instruction ?? "x",
      presets: [],
      inspirationKey: made.inspirationKey,
      backgroundColor: "#ffffff",
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

// Publishes a tile and marks it published (the asset copy can't run here). A fork needs the
// comparison's "new design" verdict first (convex/remixCheck.ts), so one is recorded for it.
async function publish(
  t: T,
  who: Awaited<ReturnType<typeof member>>,
  remixOf?: Id<"works">,
  remixKind?: "variation" | "fork",
) {
  const generationId = await tile(t, who.userId, remixOf);
  if (remixKind === "fork") {
    await t.run((ctx) =>
      ctx.db.patch("generations", generationId, {
        remixCheck: { status: "done", requestedAt: Date.now(), attempts: 1, verdict: "fork", reason: "A new design." },
      }),
    );
  }
  const result = await who.as.mutation(api.publish.quick, {
    requestId: `req-${(requestCounter += 1)}`,
    generationId,
    remixKind,
  });
  await t.run((ctx) => ctx.db.patch("works", result.workId, { status: "published", publishedAt: Date.now() }));
  return result;
}

const getWork = (t: T, id: Id<"works">) => t.run((ctx) => ctx.db.get("works", id));

describe("publishing a remix as a variation or a fork", () => {
  it("numbers a variation in the parent's family and a fork as a new family", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const root = await publish(t, alice);
    expect(root.cr).toBe("101-001");
    const variation = await publish(t, bob, root.workId);
    expect(variation.cr).toBe("101-002");
    const fork = await publish(t, bob, root.workId, "fork");
    expect(fork.cr).toBe("102-001");
    const again = await publish(t, alice, root.workId, "variation");
    expect(again.cr).toBe("101-003");

    const forkDoc = (await getWork(t, fork.workId))!;
    expect(forkDoc).toMatchObject({
      kind: "fork",
      parentWorkId: root.workId,
      effectiveParentWorkId: root.workId,
      familyRootId: fork.workId,
      crFamily: 102,
      crExpression: 1,
    });
    expect((await getWork(t, variation.workId))!).toMatchObject({
      kind: "variation",
      familyRootId: root.workId,
      effectiveParentWorkId: root.workId,
    });
    // A variation of the fork joins family 102.
    const inFork = await publish(t, alice, fork.workId);
    expect(inFork.cr).toBe("102-002");
  });

  it("keeps a words-only remix a variation and allows a fork only once the remix reads as a new design", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const root = await publish(t, alice);
    const artKey = "works/101/001/original.png";
    await t.run((ctx) => ctx.db.patch("works", root.workId, { artKey }));
    const relation = async (generationId: Id<"generations">) =>
      (await bob.as.query(api.publish.preview, { generationId }))?.remix?.relation;
    const asFork = (generationId: Id<"generations">, requestId: string) =>
      bob.as.mutation(api.publish.quick, { requestId, generationId, remixKind: "fork" });
    const check = (generationId: Id<"generations">) =>
      t.run(async (ctx) => (await ctx.db.get("generations", generationId))?.remixCheck ?? null);

    // Only the boxes changed, on the parent's own art: a variation, never compared, never a fork.
    const wordsOnly = await tile(t, bob.userId, root.workId, { instruction: "", inspirationKey: artKey });
    expect(await relation(wordsOnly)).toEqual({ status: "words" });
    await bob.as.mutation(api.publish.checkRemix, { generationId: wordsOnly });
    expect(await check(wordsOnly)).toBeNull();
    await expect(asFork(wordsOnly, "words-fork")).rejects.toThrow(/changed only the design's remixable words/);
    const variation = await bob.as.mutation(api.publish.quick, { requestId: "words-variation", generationId: wordsOnly, remixKind: "variation" });
    expect(variation.cr).toBe("101-002");

    // Words in the request as well: compared first. Until the verdict, no fork.
    const small = await tile(t, bob.userId, root.workId, { instruction: "Add SINCE 1999 under the mushroom", inspirationKey: artKey });
    expect(await relation(small)).toEqual({ status: "none" });
    await expect(asFork(small, "small-early")).rejects.toThrow(/Still comparing/);
    await bob.as.mutation(api.publish.checkRemix, { generationId: small });
    expect(await check(small)).toMatchObject({ status: "pending", attempts: 1 });
    // Asking again while it runs starts nothing new.
    await bob.as.mutation(api.publish.checkRemix, { generationId: small });
    expect(await check(small)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await relation(small)).toEqual({ status: "pending" });

    // It reads as the same design: a variation, and the reason shows.
    await t.mutation(internal.publish.saveRemixCheck, {
      generationId: small,
      verdict: "variation",
      reason: "The same mushroom design with a new line of words under it.",
      subject: "same",
      layout: "same",
      style: "same",
    });
    expect(await relation(small)).toEqual({ status: "variation", reason: "The same mushroom design with a new line of words under it." });
    await expect(asFork(small, "small-fork")).rejects.toThrow(/reads as the same design/);

    // A remix that reads as a new design may start a new family.
    const big = await tile(t, bob.userId, root.workId, { instruction: "Redraw it all as a pixel-art arcade poster", inspirationKey: artKey });
    await bob.as.mutation(api.publish.checkRemix, { generationId: big });
    await t.mutation(internal.publish.saveRemixCheck, { generationId: big, verdict: "fork", reason: "Redrawn as pixel art.", style: "changed" });
    expect(await relation(big)).toEqual({ status: "fork", reason: "Redrawn as pixel art." });
    const fork = await asFork(big, "big-fork");
    expect(fork.cr).toBe("102-001");

    // When the comparison can't run, the remixer chooses; it's tried at most three times.
    const unknown = await tile(t, bob.userId, root.workId, { instruction: "", inspirationKey: "members/bob/uploads/x/original.png" });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await bob.as.mutation(api.publish.checkRemix, { generationId: unknown });
      if (attempt <= 3) await t.mutation(internal.publish.saveRemixCheck, { generationId: unknown, error: "timed out" });
    }
    expect(await check(unknown)).toMatchObject({ status: "failed", attempts: 3, error: "timed out" });
    expect(await relation(unknown)).toEqual({ status: "failed" });
    expect((await asFork(unknown, "unknown-fork")).cr).toBe("103-001");

    // Only the design's own creator can start a comparison.
    const other = await tile(t, bob.userId, root.workId, { instruction: "x", inspirationKey: artKey });
    await alice.as.mutation(api.publish.checkRemix, { generationId: other });
    expect(await check(other)).toBeNull();
  });

  it("refuses to publish a remix, public or kept, of a design taken down after it was made", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const root = await publish(t, alice);
    const generationId = await tile(t, bob.userId, root.workId);
    await t.run((ctx) => ctx.db.patch("works", root.workId, { status: "withdrawn", withdrawReason: "Not ours to sell." }));
    for (const keep of [undefined, "private" as const]) {
      await expect(
        bob.as.mutation(api.publish.quick, { requestId: `late-${keep ?? "world"}`, generationId, ...(keep ? { keep } : {}) }),
      ).rejects.toThrow(/was taken down/u);
    }
  });

  it("refuses to publish a remix whose parent is gone", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const root = await publish(t, alice);
    const generationId = await tile(t, alice.userId, root.workId);
    await t.run((ctx) => ctx.db.patch("works", root.workId, { status: "asset_failed" }));
    await expect(
      alice.as.mutation(api.publish.quick, { requestId: "late", generationId }),
    ).rejects.toThrow(/isn't published anymore/);
  });

  it("offers the choice only for the member's own remix tile", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const root = await publish(t, alice);
    const remixTile = await tile(t, bob.userId, root.workId);
    expect(await bob.as.query(api.lineage.publishOptions, { generationId: remixTile })).toEqual({
      parentCr: "101-001",
      parentTitle: undefined,
      family: 101,
    });
    expect(await alice.as.query(api.lineage.publishOptions, { generationId: remixTile })).toBeNull();
    expect(await t.query(api.lineage.publishOptions, { generationId: remixTile })).toBeNull();
    expect(await bob.as.query(api.lineage.publishOptions, { generationId: await tile(t, bob.userId) })).toBeNull();
  });
});

describe("work page lineage", () => {
  it("shows the trail across a fork, direct remixes, the family, and shares", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const cara = await member(t, "cara");
    const root = await publish(t, alice);
    const variation = await publish(t, bob, root.workId);
    const fork = await publish(t, cara, variation.workId, "fork");
    const deep = await publish(t, alice, fork.workId);

    const trail = await t.query(api.lineage.trail, { cr: deep.cr });
    expect(trail?.steps.map((step) => [step.cr, step.via, step.username])).toEqual([
      ["102-001", "variation", "cara"],
      ["101-002", "fork", "bob"],
      ["101-001", "variation", "alice"],
    ]);
    expect(trail).toMatchObject({ kind: "variation", amended: false, pending: false, broken: false });

    const remixes = await t.query(api.lineage.directRemixes, {
      cr: variation.cr,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(remixes.page.map((card) => [card.cr, card.kind])).toEqual([["102-001", "fork"]]);

    const family = await t.query(api.lineage.family, { cr: root.cr });
    expect(family?.works.map((card) => card.cr)).toEqual(["101-001", "101-002"]);

    const panel = await t.query(api.workEconomics.panel, { cr: deep.cr });
    expect(panel?.shares).toEqual([
      { username: "alice", roles: ["creator"], bps: 5000 },
      { username: "cara", roles: ["family_root"], bps: 3000 },
      { username: "bob", roles: ["upstream"], bps: 2000 },
    ]);
    expect(panel).toMatchObject({ configVersion: 4, configPath: "/economics/v4.json", provenance: "pending", affiliateBps: 500, brand: null });
    expect(panel?.configSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(panel!.shares.reduce((sum, share) => sum + share.bps, 0)).toBe(10000);
  });

  it("returns nothing for unpublished or unknown works", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const root = await publish(t, alice);
    await t.run((ctx) => ctx.db.patch("works", root.workId, { status: "preparing" }));
    expect(await t.query(api.lineage.trail, { cr: root.cr })).toBeNull();
    expect(await t.query(api.workEconomics.panel, { cr: "999-001" })).toBeNull();
    expect(await t.query(api.lineage.family, { cr: "nonsense" })).toBeNull();
  });
});

describe("lineage amendments", () => {
  async function setup() {
    const t = newTest();
    const owner = await member(t, "owner", "super_admin_owner");
    const alice = await member(t, "alice");
    const bob = await member(t, "bob");
    const a = await publish(t, alice); // 101-001
    const g = await publish(t, bob); // 102-001
    const fork = await publish(t, bob, a.workId, "fork"); // 103-001
    const child = await publish(t, alice, fork.workId); // 103-002
    return { t, owner, alice, bob, a, g, fork, child };
  }

  it("refuses non-admins", async () => {
    const { alice, fork } = await setup();
    await expect(
      alice.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "mine" }),
    ).rejects.toThrow(/Only admins/);
    await expect(alice.as.query(api.lineage.adminHistory, {})).rejects.toThrow(/Only admins/);
  });

  it("validates like the registry", async () => {
    const { owner, a, fork, child } = await setup();
    const request = (cr: string, newKind: "original" | "variation" | "fork", newParentCr?: string) =>
      owner.as.mutation(api.lineage.requestAmendment, { cr, newKind, newParentCr, reason: "fix" });
    await expect(request(child.cr, "fork", a.cr)).rejects.toThrow(/keeps its kind/);
    await expect(request(fork.cr, "fork", child.cr)).rejects.toThrow(/another family/);
    await expect(request(a.cr, "fork", child.cr)).rejects.toThrow(/would loop/);
    await expect(request(fork.cr, "fork", a.cr)).rejects.toThrow(/already its lineage/);
    await expect(
      owner.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "  " }),
    ).rejects.toThrow(/why/);
  });

  it("moves requested -> confirmed offchain, changes the effective parent, and leaves descendants alone", async () => {
    const { t, owner, a, g, fork, child } = await setup();
    const id = await owner.as.mutation(api.lineage.requestAmendment, {
      cr: fork.cr,
      newKind: "fork",
      newParentCr: g.cr,
      reason: "It was forked from 102-001",
    });
    // Requested is not effective, but the page says a correction is pending.
    let trail = await t.query(api.lineage.trail, { cr: fork.cr });
    expect(trail?.steps.map((step) => step.cr)).toEqual([a.cr]);
    expect(trail).toMatchObject({ pending: true, amended: false });
    await expect(
      owner.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "again" }),
    ).rejects.toThrow(/already has a correction/);

    await owner.as.mutation(api.lineage.confirmOffchain, { amendmentId: id });
    const doc = (await getWork(t, fork.workId))!;
    expect(doc).toMatchObject({ parentWorkId: a.workId, kind: "fork", effectiveParentWorkId: g.workId, effectiveKind: "fork" });
    trail = await t.query(api.lineage.trail, { cr: fork.cr });
    expect(trail?.steps.map((step) => step.cr)).toEqual([g.cr]);
    expect(trail).toMatchObject({ pending: false, amended: true });
    expect(trail?.history[0]).toMatchObject({
      status: "confirmed",
      fromParentCr: a.cr,
      newParentCr: g.cr,
      offchainOnly: true,
    });

    // The descendant keeps its parent; its trail now runs through the new upstream.
    expect((await getWork(t, child.workId))!.effectiveParentWorkId).toBe(fork.workId);
    const childTrail = await t.query(api.lineage.trail, { cr: child.cr });
    expect(childTrail?.steps.map((step) => step.cr)).toEqual([fork.cr, g.cr]);

    // Direct remixes follow the effective parent.
    const page = { numItems: 10, cursor: null };
    expect((await t.query(api.lineage.directRemixes, { cr: a.cr, paginationOpts: page })).page).toEqual([]);
    expect(
      (await t.query(api.lineage.directRemixes, { cr: g.cr, paginationOpts: page })).page.map((card) => card.cr),
    ).toEqual([fork.cr]);

    // Shares follow too: upstream is now bob (g's creator), not alice.
    const panel = await t.query(api.workEconomics.panel, { cr: child.cr });
    expect(panel?.shares.find((share) => share.roles.includes("upstream"))?.username).toBe("bob");
  });

  it("makes a fork an original", async () => {
    const { t, owner, fork } = await setup();
    const id = await owner.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "New design" });
    await owner.as.mutation(api.lineage.confirmOffchain, { amendmentId: id });
    const doc = (await getWork(t, fork.workId))!;
    expect(doc.effectiveKind).toBe("original");
    expect(doc.effectiveParentWorkId).toBeUndefined();
    const panel = await t.query(api.workEconomics.panel, { cr: fork.cr });
    expect(panel?.shares).toEqual([{ username: "bob", roles: ["creator"], bps: 10000 }]);
  });

  it("refuses offchain confirmation while chain writes are on, and runs the chain path", async () => {
    const { t, owner, fork, g } = await setup();
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "chain.writes", enabled: true }));
    const id = await owner.as.mutation(api.lineage.requestAmendment, {
      cr: fork.cr,
      newKind: "fork",
      newParentCr: g.cr,
      reason: "fix",
    });
    await expect(owner.as.mutation(api.lineage.confirmOffchain, { amendmentId: id })).rejects.toThrow(/on Monad/);

    const queued = await t.query(internal.lineage.requestedForChain, {});
    expect(queued).toEqual([expect.objectContaining({ amendmentId: id, chainSequence: 1, newKind: "fork", newParentId: g.workId })]);
    // Can't confirm before submitting.
    expect(await t.mutation(internal.lineage.markConfirmed, { amendmentId: id })).toBe(false);
    expect(await t.mutation(internal.lineage.markSubmitted, { amendmentId: id, chainWriteId: "w1" })).toBe(true);
    expect(await t.mutation(internal.lineage.markSubmitted, { amendmentId: id, chainWriteId: "w1" })).toBe(true);
    expect((await getWork(t, fork.workId))!.effectiveKind).toBeUndefined();
    expect(await t.mutation(internal.lineage.markConfirmed, { amendmentId: id, confirmedAt: 1234 })).toBe(true);
    expect(await t.mutation(internal.lineage.markConfirmed, { amendmentId: id })).toBe(true);
    expect((await getWork(t, fork.workId))!).toMatchObject({ effectiveParentWorkId: g.workId, lineageAmendedAt: 1234 });

    // The next onchain amendment gets sequence 2.
    const second = await owner.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "again" });
    const row = await t.run((ctx) => ctx.db.get("lineageAmendments", second));
    expect(row).toMatchObject({ sequence: 2, chainSequence: 2 });
  });

  it("keeps a rejected amendment out of the lineage and off the public page", async () => {
    const { t, owner, fork, g, a } = await setup();
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "chain.writes", enabled: true }));
    const id = await owner.as.mutation(api.lineage.requestAmendment, {
      cr: fork.cr,
      newKind: "fork",
      newParentCr: g.cr,
      reason: "fix",
    });
    await t.mutation(internal.lineage.markSubmitted, { amendmentId: id, chainWriteId: "w1" });
    expect(await t.mutation(internal.lineage.markRejected, { amendmentId: id, reason: "reverted" })).toBe(true);
    expect(await t.mutation(internal.lineage.markConfirmed, { amendmentId: id })).toBe(false);
    expect((await getWork(t, fork.workId))!.effectiveParentWorkId).toBe(a.workId);
    const trail = await t.query(api.lineage.trail, { cr: fork.cr });
    expect(trail).toMatchObject({ pending: false, amended: false, history: [] });
    const history = await owner.as.query(api.lineage.adminHistory, {});
    expect(history.amendments[0]).toMatchObject({ status: "rejected", rejectReason: "reverted", admin: "owner" });
    // A rejected sequence doesn't consume the chain sequence.
    const next = await owner.as.mutation(api.lineage.requestAmendment, { cr: fork.cr, newKind: "original", reason: "x" });
    expect(await t.run((ctx) => ctx.db.get("lineageAmendments", next))).toMatchObject({ sequence: 2, chainSequence: 1 });
  });

  it("refuses a stale offchain confirmation and lets an admin cancel", async () => {
    const { t, owner, fork, g } = await setup();
    const id = await owner.as.mutation(api.lineage.requestAmendment, {
      cr: fork.cr,
      newKind: "fork",
      newParentCr: g.cr,
      reason: "fix",
    });
    await t.run((ctx) => ctx.db.patch("works", fork.workId, { effectiveKind: "original", effectiveParentWorkId: undefined }));
    await expect(owner.as.mutation(api.lineage.confirmOffchain, { amendmentId: id })).rejects.toThrow(/changed since/);
    await owner.as.mutation(api.lineage.cancelAmendment, { amendmentId: id });
    expect(await t.run((ctx) => ctx.db.get("lineageAmendments", id))).toMatchObject({ status: "rejected", rejectReason: "cancelled" });
  });

  it("shows an admin the work's lineage before correcting", async () => {
    const { owner, fork, a } = await setup();
    expect(await owner.as.query(api.lineage.adminWork, { cr: fork.cr })).toMatchObject({
      kind: "fork",
      parentCr: a.cr,
      effectiveKind: "fork",
      effectiveParentCr: a.cr,
      allowedKinds: ["original", "fork"],
      open: false,
    });
  });
});

describe("backfillEffectiveParents", () => {
  it("fills old remixes' effective parent once", async () => {
    const t = newTest();
    const alice = await member(t, "alice");
    const root = await publish(t, alice);
    const child = await publish(t, alice, root.workId);
    await t.run((ctx) => ctx.db.patch("works", child.workId, { effectiveParentWorkId: undefined }));
    expect(await t.mutation(internal.lineage.backfillEffectiveParents, {})).toEqual({ updated: 1, cursor: null });
    expect((await getWork(t, child.workId))!.effectiveParentWorkId).toBe(root.workId);
    expect(await t.mutation(internal.lineage.backfillEffectiveParents, {})).toEqual({ updated: 0, cursor: null });
  });
});
