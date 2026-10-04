import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { formatCr } from "../../convex/lib/r2";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// Remixable words (convex/remixFields.ts): proposed when a work's notes are written, adjusted by
// its creator, and the only words a remix may change.

vi.setConfig({ testTimeout: 30_000 });

type T = ReturnType<typeof newTest>;

const ENV_KEYS = ["IMAGE_PROVIDER", "STUDIO_LAYOUT", "CHATGPT_ACCESS_TOKEN", "CHATGPT_ACCOUNT_ID"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.IMAGE_PROVIDER = "gateway";
  // Fake timers keep scheduled actions (notes, art copies, images) from running.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const NOTES = [
  "### Subject and layout",
  "A mushroom under a rainbow.",
  "### Words",
  "- “GROW SLOW” — headline; arched across the top; chunky cream letters.",
  "- “EST. 1992” — date; small, under the mushroom.",
  "- “TAKE IT",
  "EASY” — tagline on two lines at the bottom.",
  "### Technique",
  "Screen print.",
].join("\n");

const NO_WORDS = ["### Subject and layout", "A fox.", "### Words", "None.", "### Technique", "Ink."].join("\n");

async function addUser(t: T, name: string, opts: { role?: "user" | "super_admin_owner"; username?: boolean } = {}) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      authId: `test|${name}`,
      email: `${name}@example.com`,
      ...(opts.username === false ? {} : { username: name, usernameLower: name }),
      platformRole: opts.role ?? "user",
    });
    await ctx.db.insert("creditLedger", { userId: id, kind: "grant", amount: 20, reason: "admin" });
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

let family = 700;

// A published work, as markPublished leaves it.
async function publishedWork(t: T, creatorId: Id<"users">, opts: { notes?: string; artKey?: string } = {}) {
  family += 1;
  const crFamily = family;
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: creatorId,
      updatedAt: 1,
      phrase: "",
      styleDirection: "",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: creatorId,
      instruction: "a secret prompt",
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "fake",
      count: 4,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: creatorId,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "fake",
      model: "fake",
      charged: true,
      favorite: false,
      fullKey: `cvx:design${crFamily}`,
    });
    const workId = await ctx.db.insert("works", {
      crFamily,
      crExpression: 0,
      creatorId,
      kind: "original",
      generationId,
      requestId: `req-${crFamily}`,
      backgroundColor: "#ffffff",
      status: "published",
      publishedAt: Date.now(),
      artKey: opts.artKey ?? `cvx:artwork${crFamily}`,
      notes: opts.notes,
    });
    return { workId, cr: formatCr(crFamily, 0), artKey: opts.artKey ?? `cvx:artwork${crFamily}` };
  });
}

const writeNotes = (t: T, workId: Id<"works">, notes: string) =>
  t.mutation(internal.images.saveWorkNotes, { workId, model: "test", notes });

const workDoc = (t: T, workId: Id<"works">) => t.run((ctx) => ctx.db.get("works", workId));

// A member remixing a work in the studio: the parent's art is image 1.
async function remixSession(as: ReturnType<T["withIdentity"]>, cr: string, artKey: string) {
  const { sessionId } = await as.mutation(api.studio.startRemix, { cr, fresh: true });
  const imageId = await as.mutation(api.images.adopt, { key: artKey });
  return { sessionId, images: [imageId] };
}

describe("fields saved when the notes are written", () => {
  it("proposes the notes' words, and an empty list for a design without words", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const parent = await publishedWork(t, alice.userId);
    const plain = await publishedWork(t, alice.userId);
    await writeNotes(t, parent.workId, NOTES);
    await writeNotes(t, plain.workId, NO_WORDS);
    expect((await workDoc(t, parent.workId))?.remixFields).toEqual([
      { id: "t1", kind: "text", label: "Headline", text: "GROW SLOW", maxLength: 14, on: true },
      { id: "t2", kind: "text", label: "Date", text: "EST. 1992", maxLength: 14, on: true },
      { id: "t3", kind: "text", label: "Tagline", text: "TAKE IT\nEASY", maxLength: 18, on: true },
    ]);
    expect((await workDoc(t, plain.workId))?.remixFields).toEqual([]);
  });
});

describe("editing the fields", () => {
  it("lets only the creator or an admin rename and switch them", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const owner = await addUser(t, "owner", { role: "super_admin_owner" });
    const { workId } = await publishedWork(t, alice.userId);

    // Before the notes: the editor says the words are still being read.
    expect(await alice.as.query(api.remixFields.forEditor, { workId })).toMatchObject({ preparing: false, fields: null });
    await expect(alice.as.mutation(api.remixFields.update, { workId, fields: [] })).rejects.toThrow(/NOT_READY/);
    await writeNotes(t, workId, NOTES);

    expect(await bob.as.query(api.remixFields.forEditor, { workId })).toBeNull();
    expect(await t.query(api.remixFields.forEditor, { workId })).toBeNull();
    const edit = { workId, fields: [{ id: "t2", label: "Year", on: false }] };
    await expect(bob.as.mutation(api.remixFields.update, edit)).rejects.toThrow(/FORBIDDEN/);
    await expect(t.mutation(api.remixFields.update, edit)).rejects.toThrow(/FORBIDDEN/);

    await alice.as.mutation(api.remixFields.update, { workId, fields: [{ id: "t2", label: "  The   year ", on: false }] });
    await owner.as.mutation(api.remixFields.update, { workId, fields: [{ id: "t1", label: "Big words", on: true }] });
    expect((await alice.as.query(api.remixFields.forEditor, { workId }))?.fields).toEqual([
      { id: "t1", label: "Big words", text: "GROW SLOW", on: true },
      { id: "t2", label: "The year", text: "EST. 1992", on: false },
      { id: "t3", label: "Tagline", text: "TAKE IT\nEASY", on: true },
    ]);

    for (const fields of [
      [{ id: "t9", label: "Nope", on: true }],
      [{ id: "t1", label: "A", on: true }, { id: "t1", label: "B", on: true }],
      [{ id: "t1", label: "   ", on: true }],
      [{ id: "t1", label: "x".repeat(41), on: true }],
    ]) {
      await expect(alice.as.mutation(api.remixFields.update, { workId, fields })).rejects.toThrow(/INVALID_INPUT/);
    }
  });
});

describe("what the browser sees", () => {
  it("signed out, only the switched-on fields' labels and text (no notes)", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const { workId } = await publishedWork(t, alice.userId);
    await writeNotes(t, workId, NOTES);
    await alice.as.mutation(api.remixFields.update, { workId, fields: [{ id: "t2", label: "Date", on: false }] });
    const view = await t.query(api.remixFields.forWork, { workId });
    expect(view).toEqual({
      fields: [
        { id: "t1", label: "Headline", text: "GROW SLOW", maxLength: 14 },
        { id: "t3", label: "Tagline", text: "TAKE IT\nEASY", maxLength: 18 },
      ],
      changes: [],
    });
    expect(JSON.stringify(view)).not.toMatch(/mushroom|Screen print|secret prompt/);

    await t.run((ctx) => ctx.db.patch("works", workId, { status: "withdrawn" }));
    expect(await t.query(api.remixFields.forWork, { workId })).toEqual({ fields: [], changes: [] });
  });
});

describe("remixing with the words", () => {
  async function setup() {
    const t = newTest();
    await roomyBudget(t);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const parent = await publishedWork(t, alice.userId);
    await writeNotes(t, parent.workId, NOTES);
    return { t, alice, bob, parent };
  }

  it("lets any member change switched-on words, checked against the parent's stored text", async () => {
    const { t, bob, parent } = await setup();
    const remix = await remixSession(bob.as, parent.cr, parent.artKey);
    const result = await bob.as.mutation(api.studio.generate, {
      ...remix,
      instruction: "",
      backgroundColor: "#ffffff",
      words: [
        { fieldId: "t1", text: "  GROW WILD " },
        // Unchanged: not a change.
        { fieldId: "t2", text: "EST. 1992" },
      ],
    });
    if ("refused" in result) throw new Error(result.refused);
    const batch = await t.run((ctx) => ctx.db.get("batches", result.batchId));
    expect(batch?.wordChanges).toEqual([{ fieldId: "t1", label: "Headline", from: "GROW SLOW", to: "GROW WILD" }]);

    // The prompt replaces the headline letter for letter and keeps the other pieces.
    const job = await t.query(internal.studio.batchJob, { batchId: result.batchId });
    expect(job?.remixOfParent).toBe(true);
    expect(job?.wordChanges).toContain('Headline: replace "GROW SLOW" with "GROW WILD", spelled letter for letter: G-R-O-W W-I-L-D.');
    expect(job?.wordChanges).toContain('- Date: "EST. 1992"');
    expect(job?.wordChanges).toContain('- Tagline: "TAKE IT / EASY"');

    // The studio's batch line shows what changed, without the field ids.
    const page = await bob.as.query(api.studio.sessionBatches, {
      sessionId: remix.sessionId,
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(page.page[0].wordChanges).toEqual([{ label: "Headline", from: "GROW SLOW", to: "GROW WILD" }]);
  });

  it("refuses words that are too long, switched off, unknown, or sent by someone without a username", async () => {
    const { t, alice, bob, parent } = await setup();
    await alice.as.mutation(api.remixFields.update, { workId: parent.workId, fields: [{ id: "t2", label: "Date", on: false }] });
    const remix = await remixSession(bob.as, parent.cr, parent.artKey);
    const ask = (words: Array<{ fieldId: string; text: string }>) =>
      bob.as.mutation(api.studio.generate, { ...remix, instruction: "", backgroundColor: "#ffffff", words });
    await expect(ask([{ fieldId: "t1", text: "GROW WILD AND FREE" }])).rejects.toThrow(/WORDS_TOO_LONG/);
    await expect(ask([{ fieldId: "t2", text: "EST. 2026" }])).rejects.toThrow(/WORDS_FIELD_LOCKED/);
    await expect(ask([{ fieldId: "t7", text: "HELLO" }])).rejects.toThrow(/WORDS_UNKNOWN_FIELD/);
    await expect(ask([{ fieldId: "t1", text: "   " }])).rejects.toThrow(/WORDS_EMPTY/);
    const batches = await t.run((ctx) => ctx.db.query("batches").collect());
    expect(batches.filter((b) => b.ownerId === bob.userId)).toHaveLength(0);

    const carol = await addUser(t, "carol", { username: false });
    await expect(carol.as.mutation(api.studio.startRemix, { cr: parent.cr, fresh: true })).rejects.toThrow(/username/i);
  });

  it("refuses words once the parent's art isn't image 1", async () => {
    const { bob, parent } = await setup();
    const remix = await remixSession(bob.as, parent.cr, parent.artKey);
    const other = await bob.as.mutation(api.images.adopt, { key: "cvx:somethingelse" });
    await expect(
      bob.as.mutation(api.studio.generate, {
        sessionId: remix.sessionId,
        images: [other, ...remix.images],
        instruction: "",
        backgroundColor: "#ffffff",
        words: [{ fieldId: "t1", text: "GROW WILD" }],
      }),
    ).rejects.toThrow(/WORDS_NOT_REMIXABLE/);
  });

  it("falls back to the free-text remix for works without fields", async () => {
    const t = newTest();
    await roomyBudget(t);
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const parent = await publishedWork(t, alice.userId, { notes: NOTES });
    expect(await t.query(api.remixFields.forWork, { workId: parent.workId })).toEqual({ fields: [], changes: [] });
    const remix = await remixSession(bob.as, parent.cr, parent.artKey);
    const result = await bob.as.mutation(api.studio.generate, { ...remix, instruction: "make it blue", backgroundColor: "#ffffff" });
    if ("refused" in result) throw new Error(result.refused);
    const job = await t.query(internal.studio.batchJob, { batchId: result.batchId });
    expect(job).toMatchObject({ remixOfParent: true, instruction: "make it blue" });
    expect(job?.wordChanges).toBeUndefined();
    await expect(
      bob.as.mutation(api.studio.generate, { ...remix, instruction: "", backgroundColor: "#ffffff", words: [{ fieldId: "t1", text: "HI" }] }),
    ).rejects.toThrow(/WORDS_NOT_REMIXABLE/);
  });

  it("gives a published remix its parent's fields with the new text, and shows what changed", async () => {
    const { t, bob, parent } = await setup();
    const remix = await remixSession(bob.as, parent.cr, parent.artKey);
    const result = await bob.as.mutation(api.studio.generate, {
      ...remix,
      instruction: "",
      backgroundColor: "#ffffff",
      words: [{ fieldId: "t3", text: "STAY\nWEIRD" }],
    });
    if ("refused" in result) throw new Error(result.refused);
    const generationId = await t.run(async (ctx) => {
      const tile = await ctx.db
        .query("generations")
        .withIndex("by_batch", (q) => q.eq("batchId", result.batchId))
        .first();
      await ctx.db.patch("generations", tile!._id, { status: "succeeded", fullKey: "cvx:remixdesign1" });
      return tile!._id;
    });
    const { workId } = await bob.as.mutation(api.publish.quick, { requestId: "remix-1", generationId });
    await t.mutation(internal.publish.markPublished, { workId, artKey: "cvx:remixart001", contentHash: "abc" });
    expect((await workDoc(t, workId))?.remixFields).toEqual([
      { id: "t1", kind: "text", label: "Headline", text: "GROW SLOW", maxLength: 14, on: true },
      { id: "t2", kind: "text", label: "Date", text: "EST. 1992", maxLength: 14, on: true },
      { id: "t3", kind: "text", label: "Tagline", text: "STAY\nWEIRD", maxLength: 18, on: true },
    ]);
    // Its notes arriving later don't replace them, and its creator can still adjust them.
    await writeNotes(t, workId, NOTES.replace("GROW SLOW", "SOMETHING ELSE"));
    expect((await workDoc(t, workId))?.remixFields?.[0].text).toBe("GROW SLOW");
    await bob.as.mutation(api.remixFields.update, { workId, fields: [{ id: "t1", label: "Headline", on: false }] });
    expect(await t.query(api.remixFields.forWork, { workId })).toEqual({
      fields: [
        { id: "t2", label: "Date", text: "EST. 1992", maxLength: 14 },
        { id: "t3", label: "Tagline", text: "STAY\nWEIRD", maxLength: 18 },
      ],
      changes: [{ label: "Tagline", from: "TAKE IT\nEASY", to: "STAY\nWEIRD" }],
    });
  });
});

describe("backfill", () => {
  it("proposes fields for published works that have notes, and leaves the rest", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const withNotes = await publishedWork(t, alice.userId, { notes: NOTES });
    const without = await publishedWork(t, alice.userId);
    const edited = await publishedWork(t, alice.userId, { notes: NOTES });
    await t.run((ctx) => ctx.db.patch("works", edited.workId, { remixFields: [] }));
    expect(await t.mutation(internal.remixFields.backfill, {})).toEqual({ checked: 3, saved: 1, done: true });
    expect((await workDoc(t, withNotes.workId))?.remixFields).toHaveLength(3);
    expect((await workDoc(t, without.workId))?.remixFields).toBeUndefined();
    expect((await workDoc(t, edited.workId))?.remixFields).toEqual([]);
  });
});
