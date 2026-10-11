import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { formatCr } from "../../convex/lib/r2";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";
import type { RemixPart } from "../../convex/lib/remixParts";

// Remixable parts (convex/remixParts.ts): a design's characters, people, and groups, set up in the
// studio or on the work, filled in by a remix, checked by the server, and carried into publishing.

vi.setConfig({ testTimeout: 30_000 });

type T = ReturnType<typeof newTest>;
type As = ReturnType<T["withIdentity"]>;

const ENV_KEYS = ["IMAGE_PROVIDER", "STUDIO_LAYOUT", "CHATGPT_ACCESS_TOKEN", "CHATGPT_ACCOUNT_ID"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.IMAGE_PROVIDER = "gateway";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const PARTS: Array<RemixPart> = [
  { id: "p1", kind: "person", label: "Santa", text: "Santa Claus in his red suit", on: true, empty: "require" },
  { id: "p2", kind: "person", label: "Mrs. Claus", text: "Mrs. Claus in a red dress", on: true, empty: "omit" },
  { id: "p3", kind: "group", label: "Elves", text: "three elves in green pointed hats", on: true, count: 3, max: 4 },
  { id: "p4", kind: "character", label: "The reindeer", text: "a reindeer with a red nose", on: false },
];

async function addUser(t: T, name: string) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      authId: `test|${name}`,
      email: `${name}@example.com`,
      username: name,
      usernameLower: name,
      platformRole: "user",
    });
    await ctx.db.insert("creditLedger", { userId: id, kind: "grant", amount: 40, reason: "admin" });
    await ctx.db.insert("appSettings", {
      key: `main${name}`,
      signupGrant: { enabled: true, credits: 24 },
      dailyBudgetCents: 100_000,
      shootsPerMemberPerDay: 3,
      updatedAt: 0,
    });
    return id;
  });
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

async function roomyBudget(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("appSettings", {
      key: "main",
      signupGrant: { enabled: true, credits: 24 },
      dailyBudgetCents: 100_000,
      shootsPerMemberPerDay: 3,
      updatedAt: 0,
    });
  });
}

let family = 800;

// A design in a session and, when published, its work with the Santa parts.
async function design(t: T, ownerId: Id<"users">) {
  family += 1;
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", { ownerId, updatedAt: 1, phrase: "", styleDirection: "", presets: [] });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId,
      instruction: "Santa, Mrs. Claus, and three elves",
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "fake",
      count: 4,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "fake",
      model: "fake",
      charged: true,
      favorite: false,
      fullKey: `cvx:santadesign${family}`,
    });
    return { sessionId, batchId, generationId, key: `cvx:santadesign${family}` };
  });
}

async function publishedWork(t: T, creatorId: Id<"users">) {
  const made = await design(t, creatorId);
  const crFamily = family;
  const workId = await t.run((ctx) =>
    ctx.db.insert("works", {
      crFamily,
      crExpression: 1,
      creatorId,
      kind: "original",
      generationId: made.generationId,
      requestId: `req-${crFamily}`,
      backgroundColor: "#ffffff",
      status: "published",
      publishedAt: Date.now(),
      artKey: `cvx:santaartwork${crFamily}`,
      remixFields: [],
      remixParts: PARTS,
    }),
  );
  return { workId, cr: formatCr(crFamily, 1), artKey: `cvx:santaartwork${crFamily}` };
}

async function photo(as: As, key: string) {
  return await as.mutation(api.images.adopt, { key });
}

async function remixSession(as: As, cr: string, artKey: string) {
  const { sessionId } = await as.mutation(api.studio.startRemix, { cr, fresh: true });
  const imageId = await as.mutation(api.images.adopt, { key: artKey });
  return { sessionId, images: [imageId] };
}

const batchOf = (t: T, batchId: Id<"batches">) => t.run((ctx) => ctx.db.get("batches", batchId));

describe("a remix fills in the parts", () => {
  it("follows the creator's rules for people and groups, and records what changed", async () => {
    const t = newTest();
    await roomyBudget(t);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const { cr, artKey } = await publishedWork(t, alice.userId);
    const { sessionId, images } = await remixSession(bob.as, cr, artKey);
    const base = { sessionId, instruction: "", backgroundColor: "#ffffff", images };

    // Santa needs a photo.
    await expect(bob.as.mutation(api.studio.generate, base)).rejects.toThrow(/Add a photo for Santa/);

    const dad = await photo(bob.as, "cvx:photodad1");
    const kids = [await photo(bob.as, "cvx:photokid1x"), await photo(bob.as, "cvx:photokid2x"), await photo(bob.as, "cvx:photokid3x"), await photo(bob.as, "cvx:photokid4x"), await photo(bob.as, "cvx:photokid5x")];

    // The elves take up to four photos, and the reindeer is switched off.
    await expect(
      bob.as.mutation(api.studio.generate, { ...base, parts: [{ partId: "p1", photos: [dad] }, { partId: "p3", photos: kids }] }),
    ).rejects.toThrow(/Elves takes up to 4 photos/);
    await expect(
      bob.as.mutation(api.studio.generate, { ...base, parts: [{ partId: "p1", photos: [dad] }, { partId: "p4", to: "a moose", photos: [] }] }),
    ).rejects.toThrow(/isn't remixable/);

    const result = await bob.as.mutation(api.studio.generate, {
      ...base,
      parts: [{ partId: "p1", photos: [dad] }, { partId: "p3", photos: kids.slice(0, 4) }],
    });
    if ("refused" in result) throw new Error("refused");
    const batch = await batchOf(t, result.batchId);
    expect(batch?.partChanges?.map((c) => [c.label, c.photos.map((p) => p.key), c.omit ?? false])).toEqual([
      ["Santa", ["cvx:photodad1"], false],
      ["Elves", ["cvx:photokid1x", "cvx:photokid2x", "cvx:photokid3x", "cvx:photokid4x"], false],
      // Mrs. Claus had no photo and her rule is to leave her out.
      ["Mrs. Claus", [], true],
    ]);

    // The prompt numbers the photos after image 1 and asks for exactly four elves.
    const job = await t.query(internal.studio.batchJob, { batchId: result.batchId });
    expect(job?.attachments.map((a) => a.partFor ?? (a.styleOnly ? "style" : "image"))).toEqual(["image", "Santa", "Elves", "Elves", "Elves", "Elves"]);
    expect(job?.partChanges).toContain("- Santa: the person in image 2 becomes image 1's Santa");
    expect(job?.partChanges).toContain("draw exactly 4 elves (image 1 shows 3), no more and no fewer");
    expect(job?.partChanges).toContain("- Mrs. Claus: leave image 1's Mrs. Claus out of the design");
    expect(job?.partChanges).toContain("Count check: 1 Santa, 4 elves, no Mrs. Claus");

    // Only the parts changed: publishing it is a variation, without a comparison.
    const preview = await bob.as.query(api.publish.preview, { generationId: (await t.run((ctx) => ctx.db.query("generations").withIndex("by_batch", (q) => q.eq("batchId", result.batchId)).first()))!._id });
    expect(preview?.remix?.relation.status).toBe("words");

    // "Try again" asks for the same parts, and Mrs. Claus is left out by her rule again.
    const again = await bob.as.mutation(api.studio.retryBatch, { batchId: result.batchId });
    if ("refused" in again) throw new Error("refused");
    expect((await batchOf(t, again.batchId))?.partChanges).toEqual(batch?.partChanges);
  });

  it("keeps a remix without image 1 from changing parts", async () => {
    const t = newTest();
    await roomyBudget(t);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const { cr, artKey } = await publishedWork(t, alice.userId);
    const { sessionId } = await remixSession(bob.as, cr, artKey);
    const other = await photo(bob.as, "cvx:photoother");
    await expect(
      bob.as.mutation(api.studio.generate, { sessionId, instruction: "", backgroundColor: "#ffffff", images: [other], parts: [{ partId: "p1", photos: [other] }] }),
    ).rejects.toThrow(/can't be changed here/);
  });
});

describe("setting up a design in the studio", () => {
  it("reads the design, saves the creator's edits, tries it as a remix, and publishes with it", async () => {
    const t = newTest();
    await roomyBudget(t);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const made = await design(t, alice.userId);
    const target = { generationId: made.generationId };

    expect(await bob.as.query(api.remixParts.editor, { target })).toBeNull();
    await expect(bob.as.mutation(api.remixParts.setup, target)).rejects.toThrow(/isn't available/);

    await alice.as.mutation(api.remixParts.setup, target);
    expect(await alice.as.query(api.remixParts.editor, { target })).toMatchObject({ status: "reading" });
    await t.mutation(internal.remixParts.saveDesignSetup, { generationId: made.generationId, fields: [], parts: PARTS });
    const ready = await alice.as.query(api.remixParts.editor, { target });
    expect(ready?.status).toBe("ready");
    expect(ready?.parts.map((p) => p.label)).toEqual(["Santa", "Mrs. Claus", "Elves", "The reindeer"]);
    // The browser never gets what the prompt says about each part.
    expect(JSON.stringify(ready)).not.toContain("red suit");

    // Santa no longer needs a photo; the reindeer is removed.
    await alice.as.mutation(api.remixParts.update, {
      target,
      fields: [],
      parts: [
        { id: "p1", label: "Santa", on: true, empty: "keep" },
        { id: "p2", label: "Mrs. Claus", on: true, empty: "omit" },
        { id: "p3", label: "Elves", on: true, max: 6, note: "pointed green hats" },
      ],
    });
    const edited = await alice.as.query(api.remixParts.editor, { target });
    expect(edited?.parts.map((p) => [p.label, p.empty ?? p.max])).toEqual([["Santa", "keep"], ["Mrs. Claus", "omit"], ["Elves", 6]]);

    // Trying it as a remix: the design is image 1, and the same rules apply.
    const image1 = await photo(alice.as, made.key);
    const kid = await photo(alice.as, "cvx:photokid0");
    const tried = await alice.as.mutation(api.studio.generate, {
      sessionId: made.sessionId,
      instruction: "",
      backgroundColor: "#ffffff",
      images: [image1],
      parts: [{ partId: "p3", photos: [kid] }],
      tryDesign: made.generationId,
    });
    if ("refused" in tried) throw new Error("refused");
    const job = await t.query(internal.studio.batchJob, { batchId: tried.batchId });
    expect(job?.remixOfParent).toBe(true);
    expect(job?.partChanges).toContain("Creator's note: pointed green hats");
    // Someone else can't try it.
    const theirs = await photo(bob.as, made.key);
    await expect(
      bob.as.mutation(api.studio.generate, { instruction: "", backgroundColor: "#ffffff", images: [theirs], newSession: true, tryDesign: made.generationId }),
    ).rejects.toThrow(/Set up this design/);

    // Publishing the design carries the setup to the work.
    const { workId } = await alice.as.mutation(api.publish.quick, { requestId: "r-santa", generationId: made.generationId });
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work?.remixParts?.map((p) => p.label)).toEqual(["Santa", "Mrs. Claus", "Elves"]);
    expect(work?.remixParts?.[2]).toMatchObject({ max: 6, note: "pointed green hats" });
  });
});
