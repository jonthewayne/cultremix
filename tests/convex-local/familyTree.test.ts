import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { TREE_CHILD_SCAN, TREE_MAX, TREE_PAGE } from "../../convex/lineage";
import { chainSummary } from "../../src/lib/familyTree";
import { newTest } from "./setup";
import type { Doc, Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

async function member(t: T, name: string) {
  return await t.run((ctx) => ctx.db.insert("users", { authId: `test|${name}`, username: name, usernameLower: name }));
}

// One finished studio tile for every work in a test: the tree never reads it.
async function generation(t: T, ownerId: Id<"users">) {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId,
      updatedAt: 0,
      phrase: "",
      styleDirection: "",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: "x",
      presets: [],
      backgroundColor: "#ffffff",
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
    });
  });
}

let requests = 0;

function seeder(t: T, creatorId: Id<"users">, generationId: Id<"generations">) {
  return async (
    family: number,
    expression: number,
    parent?: Id<"works">,
    extra: Partial<Doc<"works">> = {},
  ): Promise<Id<"works">> =>
    await t.run(async (ctx) => {
      const parentDoc = parent ? await ctx.db.get("works", parent) : null;
      const kind = !parentDoc ? "original" : parentDoc.crFamily === family ? "variation" : "fork";
      return await ctx.db.insert("works", {
        crFamily: family,
        crExpression: expression,
        creatorId,
        kind,
        parentWorkId: parent,
        effectiveParentWorkId: parent,
        generationId,
        requestId: `req-${(requests += 1)}`,
        title: `Design ${family}-${expression}`,
        backgroundColor: "#ffd400",
        status: "published",
        publishedAt: family * 1000 + expression,
        artKey: `fake:${family}-${expression}`,
        ...extra,
      });
    });
}

async function setup() {
  const t = newTest();
  const alice = await member(t, "alice");
  const bob = await member(t, "bob");
  const generationId = await generation(t, alice);
  return { t, alice, bob, seed: seeder(t, alice, generationId), seedAs: (user: Id<"users">) => seeder(t, user, generationId) };
}

describe("lineage.familyTree", () => {
  it("returns the family in CR order with parents, spread counts, forks out, and where it came from", async () => {
    const { t, bob, seed, seedAs } = await setup();
    const origin = await seed(100, 1);
    const root = await seed(101, 1, origin);
    const a = await seedAs(bob)(101, 2, root);
    await seed(101, 3, a);
    await seed(101, 4, root);
    await seed(102, 1, a);
    await seed(103, 1, root);
    await t.run(async (ctx) => {
      await ctx.db.insert("workSocialStats", { workId: a, hearts: 7 });
      await ctx.db.insert("workSocialStats", { workId: root, hearts: 2 });
    });

    // Signed out.
    const tree = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(tree.family).toBe(101);
    expect(tree.more).toBe(false);
    expect(tree.works.map((w) => [w.cr, w.parentCr, w.remixes, w.hearts])).toEqual([
      ["101-001", "100-001", 3, 2],
      ["101-002", "101-001", 2, 7],
      ["101-003", "101-002", 0, 0],
      ["101-004", "101-001", 0, 0],
    ]);
    expect(tree.works[1]).toEqual({
      cr: "101-002",
      family: 101,
      expression: 2,
      kind: "variation",
      parentCr: "101-001",
      withdrawn: false,
      title: "Design 101-2",
      username: "bob",
      backgroundColor: "#ffd400",
      thumbUrl: expect.any(String),
      remixes: 2,
      remixesMore: false,
      hearts: 7,
    });
    expect(tree.works[0].kind).toBe("fork");
    expect(tree.forks.map((w) => [w.cr, w.parentCr, w.kind]).sort()).toEqual([
      ["102-001", "101-002", "fork"],
      ["103-001", "101-001", "fork"],
    ]);
    expect(tree.origins.map((w) => [w.cr, w.username])).toEqual([["100-001", "alice"]]);
  });

  it("follows corrected (effective) lineage", async () => {
    const { t, seed } = await setup();
    const root = await seed(101, 1);
    const a = await seed(101, 2, root);
    const b = await seed(101, 3, root);
    await t.run((ctx) => ctx.db.patch("works", b, { effectiveParentWorkId: a, effectiveKind: "variation" }));
    const tree = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(tree.works.map((w) => w.parentCr)).toEqual([undefined, "101-001", "101-002"]);
    expect(tree.works[1].remixes).toBe(1);
    expect(tree.works[0].remixes).toBe(1);
  });

  it("keeps a withdrawn work as a bare CR number and leaves out designs still being prepared", async () => {
    const { t, seed } = await setup();
    const root = await seed(101, 1);
    const gone = await seed(101, 2, root, { status: "withdrawn" });
    await seed(101, 3, gone);
    await seed(101, 4, root, { status: "preparing" });
    const tree = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(tree.works.map((w) => w.cr)).toEqual(["101-001", "101-002", "101-003"]);
    expect(tree.works[1]).toEqual({
      cr: "101-002",
      family: 101,
      expression: 2,
      kind: "variation",
      parentCr: "101-001",
      withdrawn: true,
    });
    expect(tree.works[2].parentCr).toBe("101-002");
    // Only published remixes count.
    expect(tree.works[0].remixes).toBe(0);
  });

  it("returns null for a family with nothing published", async () => {
    const { t, seed } = await setup();
    await seed(101, 1, undefined, { status: "withdrawn" });
    expect(await t.query(api.lineage.familyTree, { family: 101 })).toBeNull();
    expect(await t.query(api.lineage.familyTree, { family: 999 })).toBeNull();
  });

  it("caps the family at `limit`, with more set, and clamps the limit", async () => {
    const { t, seed } = await setup();
    const root = await seed(101, 1);
    for (let n = 2; n <= 8; n += 1) await seed(101, n, root);
    const first = (await t.query(api.lineage.familyTree, { family: 101, limit: 5 }))!;
    expect(first.works.map((w) => w.expression)).toEqual([1, 2, 3, 4, 5]);
    expect(first.more).toBe(true);
    // The root still counts all its remixes, loaded or not.
    expect(first.works[0].remixes).toBe(7);
    const all = (await t.query(api.lineage.familyTree, { family: 101, limit: 8 }))!;
    expect(all.works).toHaveLength(8);
    expect(all.more).toBe(false);
    const tiny = (await t.query(api.lineage.familyTree, { family: 101, limit: 0 }))!;
    expect(tiny.works).toHaveLength(1);
    expect(TREE_PAGE).toBeLessThanOrEqual(TREE_MAX);
  });

  it("stops counting remixes at the scan bound", async () => {
    const { t, seed } = await setup();
    const root = await seed(101, 1);
    for (let n = 2; n <= TREE_CHILD_SCAN + 2; n += 1) await seed(101, n, root);
    const tree = (await t.query(api.lineage.familyTree, { family: 101, limit: 2 }))!;
    expect(tree.works[0]).toMatchObject({ remixes: TREE_CHILD_SCAN, remixesMore: true });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const HASH = (n: number) => `0x${String(n).repeat(64).slice(0, 64)}`;
const TX = (n: number) => `https://testnet.monadscan.com/tx/${HASH(n)}`;

describe("lineage.familyTree onchain state", () => {
  it("marks recorded and recording works from works.provenanceStatus, with explorer links", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    vi.stubEnv("MONAD_RPC_URL", "");
    const { t, seed } = await setup();
    const origin = await seed(100, 1, undefined, { provenanceStatus: "confirmed", chainTxHash: HASH(1) });
    const root = await seed(101, 1, origin, { provenanceStatus: "confirmed", chainTxHash: HASH(2) });
    await seed(101, 2, root, { provenanceStatus: "pending" });
    await seed(101, 3, root, { provenanceStatus: "submitted", chainTxHash: HASH(3) });
    await seed(101, 4, root, { provenanceStatus: "failed" });
    await seed(101, 5, root);
    await seed(101, 6, root, { status: "withdrawn", provenanceStatus: "confirmed", chainTxHash: HASH(4) });
    await seed(102, 1, root, { provenanceStatus: "confirmed", chainTxHash: HASH(5) });

    // Signed out.
    const tree = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(tree.works.map((w) => [w.cr, w.chain, w.chainTxUrl])).toEqual([
      ["101-001", "recorded", TX(2)],
      ["101-002", "recording", undefined],
      ["101-003", "recording", TX(3)],
      ["101-004", undefined, undefined],
      ["101-005", undefined, undefined],
      // A withdrawn work stays a bare CR number.
      ["101-006", undefined, undefined],
    ]);
    expect(tree.origins.map((w) => [w.cr, w.chain, w.chainTxUrl])).toEqual([["100-001", "recorded", TX(1)]]);
    expect(tree.forks.map((w) => [w.cr, w.chain, w.chainTxUrl])).toEqual([["102-001", "recorded", TX(5)]]);

    // Only public fields: no hashes, write IDs, or statuses beyond the two states.
    expect(Object.keys(tree.works[0]).sort()).toEqual(
      ["backgroundColor", "chain", "chainTxUrl", "cr", "expression", "family", "hearts", "kind", "parentCr", "remixes", "remixesMore", "thumbUrl", "title", "username", "withdrawn"].sort(),
    );
    expect(Object.keys(tree.works[5]).sort()).toEqual(["cr", "expression", "family", "kind", "parentCr", "withdrawn"]);

    // The header line: 1 of the 5 live designs, linking to the original's registration.
    expect(chainSummary(tree)).toEqual({ recorded: 1, total: 5, rootTxUrl: TX(2) });
  });

  it("has no header line while nothing is recorded, and no links on a local node", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    vi.stubEnv("MONAD_RPC_URL", "http://127.0.0.1:8545");
    const { t, seed } = await setup();
    const root = await seed(101, 1, undefined, { provenanceStatus: "pending" });
    await seed(101, 2, root);
    const waiting = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(chainSummary(waiting)).toBeNull();

    await t.run((ctx) => ctx.db.patch("works", root, { provenanceStatus: "confirmed", chainTxHash: HASH(7) }));
    const local = (await t.query(api.lineage.familyTree, { family: 101 }))!;
    expect(local.works[0]).toMatchObject({ chain: "recorded" });
    expect(local.works[0].chainTxUrl).toBeUndefined();
    expect(chainSummary(local)).toEqual({ recorded: 1, total: 2 });
  });
});

describe("lineage.trail corrections onchain", () => {
  it("says which corrections are recorded on Monad, linking to the transaction", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    vi.stubEnv("MONAD_RPC_URL", "");
    const { t, alice, seed } = await setup();
    const root = await seed(101, 1);
    const a = await seed(101, 2, root);
    const b = await seed(101, 3, root);
    const write = (status: "submitted" | "confirmed", txHash?: string) =>
      t.run((ctx) =>
        ctx.db.insert("chainWrites", {
          kind: "amendLineage",
          subjectKey: `amend:${b}:${crypto.randomUUID()}`,
          status,
          chainId: 10143,
          workId: b,
          txs: [],
          replacements: 0,
          attempts: 1,
          createdAt: 0,
          updatedAt: 0,
          ...(txHash && { txHash }),
        }),
      );
    const confirmedWrite = await write("confirmed", HASH(8));
    const sentWrite = await write("submitted");
    await t.run(async (ctx) => {
      const row = { workId: b, fromKind: "variation" as const, newKind: "variation" as const, reason: "Fixed", adminId: alice, requestedAt: 1 };
      // 1: recorded on Monad. 2: confirmed while chain writes were off. 3: sent, waiting.
      await ctx.db.insert("lineageAmendments", {
        ...row,
        sequence: 1,
        chainSequence: 1,
        fromParentId: root,
        newParentId: a,
        status: "confirmed",
        effectiveFrom: 2,
        chainWriteId: confirmedWrite,
      });
      await ctx.db.insert("lineageAmendments", {
        ...row,
        sequence: 2,
        chainSequence: 2,
        fromParentId: a,
        newParentId: root,
        status: "confirmed",
        effectiveFrom: 3,
        offchainOnly: true,
      });
      await ctx.db.insert("lineageAmendments", {
        ...row,
        sequence: 3,
        chainSequence: 2,
        fromParentId: root,
        newParentId: a,
        status: "submitted",
        chainWriteId: sentWrite,
      });
    });

    // Signed out.
    const trail = (await t.query(api.lineage.trail, { cr: "101-003" }))!;
    expect(trail.history.map((row) => [row.sequence, row.chain, row.chainTxUrl])).toEqual([
      [3, "recording", undefined],
      [2, undefined, undefined],
      [1, "recorded", TX(8)],
    ]);
    expect(Object.keys(trail.history[2]).sort()).toEqual(
      ["chain", "chainTxUrl", "effectiveFrom", "fromKind", "fromParentCr", "newKind", "newParentCr", "offchainOnly", "reason", "requestedAt", "sequence", "status"].sort(),
    );
  });
});

describe("provenance.registry", () => {
  it("says the dev registry isn't deployed yet, on Monad testnet, signed out", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    vi.stubEnv("MONAD_RPC_URL", "");
    vi.stubEnv("CHAIN_REGISTRY_ADDRESS", "");
    const { t } = await setup();
    expect(await t.query(api.provenance.registry, {})).toEqual({
      networkName: "Monad Testnet",
      testnet: true,
      address: null,
      addressUrl: null,
      explorerUrl: "https://testnet.monadscan.com",
      publicRpcUrl: "https://testnet-rpc.monad.xyz",
    });
  });

  it("uses a dev deployment's own registry, but never lets staging or prod point elsewhere", async () => {
    const address = `0x${"ab".repeat(20)}`;
    vi.stubEnv("MONAD_RPC_URL", "");
    vi.stubEnv("CHAIN_REGISTRY_ADDRESS", address);
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    const { t } = await setup();
    expect(await t.query(api.provenance.registry, {})).toMatchObject({
      address,
      addressUrl: `https://testnet.monadscan.com/address/${address}`,
    });
    vi.stubEnv("DEPLOYMENT_ENV", "prod");
    expect(await t.query(api.provenance.registry, {})).toEqual({
      networkName: "Monad",
      testnet: false,
      address: null,
      addressUrl: null,
      explorerUrl: "https://monadscan.com",
      publicRpcUrl: "https://rpc.monad.xyz",
    });
    // A private RPC (which may carry a provider's key) is never what the browser is told to use.
    vi.stubEnv("MONAD_RPC_URL", "https://monad-mainnet.example.com/secret-key");
    expect((await t.query(api.provenance.registry, {})).publicRpcUrl).toBe("https://rpc.monad.xyz");
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    vi.stubEnv("MONAD_RPC_URL", "http://127.0.0.1:8545");
    expect(await t.query(api.provenance.registry, {})).toMatchObject({ address, addressUrl: null, explorerUrl: null });
  });
});
