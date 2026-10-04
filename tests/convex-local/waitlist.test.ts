import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;
type Role = "user" | "super_admin_support" | "super_admin_ops" | "super_admin_owner";

async function addUser(t: T, name: string, role: Role = "user", email: string | null = `${name}@example.com`) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      authId: `test|${name}`,
      username: name,
      usernameLower: name,
      email: email ?? undefined,
      platformRole: role,
    }),
  );
  return { userId, as: t.withIdentity({ subject: `test|${name}`, issuer: "test" }) };
}

async function addWork(t: T, creatorId: Id<"users">, crFamily: number, status: "published" | "preparing" = "published") {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: creatorId,
      updatedAt: 0,
      phrase: "",
      styleDirection: "",
      presets: [],
    });
    const batchId = await ctx.db.insert("batches", {
      sessionId,
      ownerId: creatorId,
      instruction: "x",
      presets: [],
      backgroundColor: "#ffffff",
      operation: "create",
      model: "test",
      count: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      sessionId,
      batchId,
      ownerId: creatorId,
      index: 0,
      kind: "concept",
      status: "succeeded",
      provider: "test",
      model: "test",
      charged: true,
      favorite: false,
    });
    return await ctx.db.insert("works", {
      crFamily,
      crExpression: 1,
      creatorId,
      kind: "original",
      generationId,
      requestId: `r-${crFamily}`,
      title: `Work ${crFamily}`,
      backgroundColor: "#ffffff",
      status,
      publishedAt: status === "published" ? 1 : undefined,
    });
  });
}

const entries = (t: T) => t.run((ctx) => ctx.db.query("waitlist").collect());

describe("joining the early-access list", () => {
  it("dedupes repeat joins for the same work, ignoring case and spaces", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, 101);
    expect(await t.mutation(api.waitlist.join, { workId, email: "Fan@Example.com" })).toEqual({ ok: true });
    expect(await t.mutation(api.waitlist.join, { workId, email: "  fan@example.com " })).toEqual({ ok: true });
    const rows = await entries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ emailLower: "fan@example.com", kind: "buy", workId });
    expect(rows[0].userId).toBeUndefined();

    // A different work is a separate entry.
    const other = await addWork(t, alice.userId, 102);
    await t.mutation(api.waitlist.join, { workId: other, email: "fan@example.com" });
    expect(await entries(t)).toHaveLength(2);
    const totals = await t.run((ctx) => ctx.db.query("waitlistTotals").collect());
    expect(totals.map((row) => row.count)).toEqual([1, 1]);
  });

  it("validates the email and the work", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, 101);
    const draft = await addWork(t, alice.userId, 102, "preparing");
    for (const email of ["", "   ", "not-an-email", "a@b", "a b@example.com", `${"x".repeat(250)}@example.com`]) {
      await expect(t.mutation(api.waitlist.join, { workId, email })).rejects.toThrow(/email/i);
    }
    await expect(t.mutation(api.waitlist.join, { workId: draft, email: "fan@example.com" })).rejects.toThrow(
      /isn’t published/,
    );
    expect(await entries(t)).toHaveLength(0);
  });

  it("rate-limits repeated tries for one email", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, 101);
    for (let i = 0; i < 8; i += 1) {
      await t.mutation(api.waitlist.join, { workId, email: "fan@example.com" });
    }
    await expect(t.mutation(api.waitlist.join, { workId, email: "fan@example.com" })).rejects.toThrow(/a lot of tries/);
    // Still limited on the next try, and a different address is unaffected.
    await expect(t.mutation(api.waitlist.join, { workId, email: "FAN@example.com" })).rejects.toThrow(/a lot of tries/);
    await t.mutation(api.waitlist.join, { workId, email: "friend@example.com" });
    expect(await entries(t)).toHaveLength(2);
  });

  it("lets a signed-in member join with one tap, using their account email", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const bob = await addUser(t, "bob");
    const workId = await addWork(t, alice.userId, 101);
    expect(await bob.as.query(api.waitlist.status, { workId })).toEqual({
      open: true,
      signedIn: true,
      hasEmail: true,
      joined: false,
    });
    await bob.as.mutation(api.waitlist.join, { workId });
    expect(await bob.as.query(api.waitlist.status, { workId })).toMatchObject({ joined: true });
    expect((await entries(t))[0]).toMatchObject({ emailLower: "bob@example.com", userId: bob.userId });

    // A member signed up by phone has no email on file and is asked for one.
    const carol = await addUser(t, "carol", "user", null);
    expect(await carol.as.query(api.waitlist.status, { workId })).toMatchObject({ hasEmail: false, joined: false });
    await expect(carol.as.mutation(api.waitlist.join, { workId })).rejects.toThrow(/Add your email/);
    await carol.as.mutation(api.waitlist.join, { workId, email: "carol@example.com" });
    expect(await entries(t)).toHaveLength(2);
  });

  it("works signed out and never returns an email", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, 101);
    await t.mutation(api.waitlist.join, { workId, email: "fan@example.com" });
    const status = await t.query(api.waitlist.status, { workId });
    expect(status).toEqual({ open: true, signedIn: false, hasEmail: false, joined: false });
    expect(JSON.stringify(status)).not.toContain("@");
  });

  it("closes once checkout is on", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const workId = await addWork(t, alice.userId, 101);
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: "commerce.checkout", enabled: true }));
    expect((await t.query(api.waitlist.status, { workId })).open).toBe(false);
    await expect(t.mutation(api.waitlist.join, { workId, email: "fan@example.com" })).rejects.toThrow(/Buying is open/);
  });
});

describe("the admin waitlist", () => {
  it("shows counts per work to any admin and emails only to ops and the owner", async () => {
    const t = newTest();
    const alice = await addUser(t, "alice");
    const support = await addUser(t, "sam", "super_admin_support");
    const ops = await addUser(t, "olive", "super_admin_ops");
    const first = await addWork(t, alice.userId, 101);
    const second = await addWork(t, alice.userId, 102);
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
      await t.mutation(api.waitlist.join, { workId: second, email });
    }
    await alice.as.mutation(api.waitlist.join, { workId: first });

    const totals = await support.as.query(api.waitlist.adminTotals, {});
    expect(totals.total).toBe(4);
    expect(totals.works.map((row) => [row.cr, row.count])).toEqual([
      ["102-001", 3],
      ["101-001", 1],
    ]);

    const opts = { paginationOpts: { numItems: 3, cursor: null } };
    await expect(support.as.query(api.waitlist.adminExportPage, opts)).rejects.toThrow(/access/);
    for (const caller of [alice.as, t]) {
      await expect(caller.query(api.waitlist.adminTotals, {})).rejects.toThrow();
      await expect(caller.query(api.waitlist.adminExportPage, opts)).rejects.toThrow();
    }
    const page1 = await ops.as.query(api.waitlist.adminExportPage, opts);
    expect(page1.page).toHaveLength(3);
    expect(page1.isDone).toBe(false);
    const page2 = await ops.as.query(api.waitlist.adminExportPage, {
      paginationOpts: { numItems: 3, cursor: page1.continueCursor },
    });
    const all = [...page1.page, ...page2.page];
    expect(all.map((row) => row.email).sort()).toEqual([
      "a@example.com",
      "alice@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(all.find((row) => row.email === "alice@example.com")).toMatchObject({ cr: "101-001", member: true });
  });
});
