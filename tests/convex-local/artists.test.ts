import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { rawOrder } from "../fixtures/shopifyOrder";
import { newTest } from "./setup";
import { SHOP_ENV, deliver, fakeShopify, makeOnSale, makeUser, makeWork } from "./shopFixtures";
import type { Id } from "../../convex/_generated/dataModel";

// Outside artists' credits end to end (convex/artists.ts, economics v5): a credit on the family's
// original, a sale of a variation that inherits it, the share held for the unclaimed artist, a
// claim, and the held share moving to the artist's account.
type T = ReturnType<typeof newTest>;
vi.setConfig({ testTimeout: 30_000 });

const ORDER_ID = 5557001;
const ADMIN = { subject: "auth-admin", issuer: "test" };
const ARTIST = { subject: "auth-jane", issuer: "test" };
const B = { subject: "auth-b", issuer: "test" };

let shopify: ReturnType<typeof fakeShopify>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));
  for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("DEPLOYMENT_ENV", "staging");
  shopify = fakeShopify();
  vi.stubGlobal("fetch", shopify.fetchFake);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function earningsFor(t: T, who: Id<"users">) {
  return await t.run((ctx) => ctx.db.query("earnings").withIndex("by_recipient_created", (q) => q.eq("recipientId", who)).collect());
}

describe("crediting an outside artist", () => {
  it("holds a variation's inherited credit for the artist, then pays it to them once their claim is approved", async () => {
    const t = newTest();
    const admin = await makeUser(t, { name: "Owner", platformRole: "super_admin_owner", authId: ADMIN.subject });
    const a = await makeUser(t, { name: "A", creatorNumber: 2 });
    const b = await makeUser(t, { name: "B", creatorNumber: 3, authId: B.subject });
    await t.run((ctx) => ctx.db.patch("users", b, { username: "bee", usernameLower: "bee" }));
    const jane = await t.run((ctx) => ctx.db.insert("users", { name: "Jane", authId: ARTIST.subject, username: "janedoe", usernameLower: "janedoe" }));
    const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
    const work = await makeWork(t, { creatorId: b, family: 101, expression: 2, parent: root, root, printKey: "works/101/002/print-y/print.png" });
    await makeOnSale(t, work, "101-002", 1000);

    // Staff credit Jane on the original. Bad input is refused.
    const owner = t.withIdentity(ADMIN);
    await expect(owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "" }] })).rejects.toThrow(/link/u);
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "instagram.com/janedoe" }] });
    expect(await t.query(api.artists.forWork, { cr: "101-002" })).toEqual([{ name: "Jane Doe", slug: "jane-doe", claimed: false, via: "101-001" }]);
    // Crediting her again by the same link finds the same artist.
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "https://www.instagram.com/JaneDoe/" }] });
    const artists = await t.run((ctx) => ctx.db.query("artists").collect());
    expect(artists).toHaveLength(1);
    const payee = artists[0].payeeId;

    // The economics panel names her share: a fifth of the family root's half of the pool.
    const panel = await t.query(api.workEconomics.panel, { cr: "101-002" });
    expect(panel?.shares.map((s) => [s.artist?.name ?? s.roles.join("+"), s.bps])).toEqual([
      ["creator", 5000],
      ["family_root", 4000],
      ["Jane Doe", 1000],
    ]);

    // One $36 shirt: base 3600, pool 540; B 270, A 216, Jane 54, held for her.
    shopify.set(rawOrder({ id: ORDER_ID, lines: [{ id: 11, variant: 1002, quantity: 1, price: "36.00" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await earningsFor(t, b)).map((r) => [r.amountCents, r.state])).toEqual([[270, "pending"]]);
    expect((await earningsFor(t, a)).map((r) => [r.amountCents, r.state])).toEqual([[216, "pending"]]);
    expect((await earningsFor(t, payee)).map((r) => [r.amountCents, r.state, r.holdReason, r.roles])).toEqual([[54, "held", "not_creator", ["artist"]]]);
    // Her hidden payee hears nothing.
    expect(await t.run((ctx) => ctx.db.query("notifications").filter((q) => q.eq(q.field("recipientId"), payee)).collect())).toHaveLength(0);
    expect(await t.query(api.artists.page, { slug: "jane-doe" })).toMatchObject({ status: "unclaimed", heldCents: 54, works: [{ cr: "101-001" }] });

    // Jane claims the page.
    const her = t.withIdentity(ARTIST);
    const claimId = await her.mutation(api.artists.startClaim, { artistId: artists[0]._id });
    expect(await her.mutation(api.artists.startClaim, { artistId: artists[0]._id })).toBe(claimId);
    await expect(her.mutation(api.artists.submitClaim, { claimId, proofUrl: "my bio" })).rejects.toThrow(/link/u);
    await her.mutation(api.artists.submitClaim, { claimId, proofUrl: "https://instagram.com/p/abc" });
    await expect(t.withIdentity(B).mutation(api.artists.approveClaim, { claimId })).rejects.toThrow();
    const overview = await owner.query(api.artists.adminOverview, {});
    expect(overview.claims).toMatchObject([{ username: "janedoe", proofUrl: "https://instagram.com/p/abc" }]);
    await owner.mutation(api.artists.approveClaim, { claimId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // What was held is hers now, pending like any creator's share, and the line names her.
    expect(await earningsFor(t, payee)).toHaveLength(0);
    expect((await earningsFor(t, jane)).map((r) => [r.amountCents, r.state])).toEqual([[54, "pending"]]);
    const item = await t.run(async (ctx) => (await ctx.db.query("orderItems").collect())[0]);
    expect(item.recipients.find((r) => r.roles.includes("artist"))?.who).toBe(jane);
    expect(await t.query(api.artists.forWork, { cr: "101-002" })).toEqual([{ name: "Jane Doe", slug: "jane-doe", claimed: true, via: "101-001" }]);

    // A replay of the order changes nothing.
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await earningsFor(t, jane)).map((r) => r.amountCents)).toEqual([54]);
    expect(await earningsFor(t, payee)).toHaveLength(0);

    // She turns the credit down: pages stop showing it and new sales stop paying it.
    await her.mutation(api.artists.updateMine, { artistId: artists[0]._id, decline: true });
    expect(await t.query(api.artists.forWork, { cr: "101-002" })).toEqual([]);
    const after = await t.query(api.workEconomics.panel, { cr: "101-002" });
    expect(after?.shares.map((s) => s.bps)).toEqual([5000, 5000]);
    void admin;
  });

  it("folds the artist's held share into a claimant who is already paid on the line, and a cancellation takes both back", async () => {
    const t = newTest();
    await makeUser(t, { name: "Owner", platformRole: "super_admin_owner", authId: ADMIN.subject });
    const a = await makeUser(t, { name: "A", creatorNumber: 2 });
    // Jane is a member who remixed the original that credits her outside identity.
    const jane = await makeUser(t, { name: "Jane", creatorNumber: 3, authId: ARTIST.subject });
    await t.run((ctx) => ctx.db.patch("users", jane, { username: "janedoe", usernameLower: "janedoe" }));
    const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
    const work = await makeWork(t, { creatorId: jane, family: 101, expression: 2, parent: root, root, printKey: "works/101/002/print-y/print.png" });
    await makeOnSale(t, work, "101-002", 1000);
    const owner = t.withIdentity(ADMIN);
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "instagram.com/janedoe" }] });
    const artist = (await t.run((ctx) => ctx.db.query("artists").collect()))[0];

    shopify.set(rawOrder({ id: ORDER_ID, lines: [{ id: 11, variant: 1002, quantity: 1, price: "36.00" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await earningsFor(t, jane)).map((r) => [r.amountCents, r.state])).toEqual([[270, "pending"]]);
    expect((await earningsFor(t, artist.payeeId)).map((r) => r.amountCents)).toEqual([54]);

    const her = t.withIdentity(ARTIST);
    const claimId = await her.mutation(api.artists.startClaim, { artistId: artist._id });
    await her.mutation(api.artists.submitClaim, { claimId, proofUrl: "https://instagram.com/p/abc" });
    await owner.mutation(api.artists.approveClaim, { claimId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Nothing is left on the payee: her sale keeps its 270, and the 54 joins it as a claim adjustment.
    expect(await earningsFor(t, artist.payeeId)).toHaveLength(0);
    const rows = await earningsFor(t, jane);
    expect(rows.map((r) => [r.kind, r.reason ?? null, r.amountCents, r.state])).toEqual([
      ["sale", null, 270, "pending"],
      ["reversal", "claim", 54, "pending"],
    ]);
    const item = await t.run(async (ctx) => (await ctx.db.query("orderItems").collect())[0]);
    expect(item.recipients.filter((r) => r.who === jane)).toEqual([{ who: jane, roles: ["creator", "artist"], bps: 900 }]);
    expect(item.recipients.some((r) => r.who === artist.payeeId)).toBe(false);
    // Her earnings page shows the adjustment as a sale.
    const mine = await her.query(api.earnings.mine, {});
    expect(mine?.entries.map((e) => [e.kind, e.amountCents]).sort()).toEqual([["sale", 270], ["sale", 54]].sort());

    // A replay changes nothing; a cancellation reverses both parts.
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await earningsFor(t, jane)).length).toBe(2);
    shopify.set(rawOrder({ id: ORDER_ID, lines: [{ id: 11, variant: 1002, quantity: 1, price: "36.00" }], cancelledAt: "2026-11-03T00:00:00Z" }));
    await deliver(t, { topic: "orders/cancelled", body: { id: ORDER_ID } });
    const net = (await earningsFor(t, jane)).reduce((sum, r) => sum + r.amountCents, 0);
    expect(net).toBe(0);
  });

  it("treats the same link as the same artist, whatever the name, and keeps a declined artist declined", async () => {
    const t = newTest();
    await makeUser(t, { name: "Owner", platformRole: "super_admin_owner", authId: ADMIN.subject });
    const a = await makeUser(t, { name: "A", creatorNumber: 2 });
    await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
    await makeWork(t, { creatorId: a, family: 102, expression: 1, printKey: "works/102/001/print-x/print.png" });
    const owner = t.withIdentity(ADMIN);
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "instagram.com/janedoe" }] });
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "102-001", artists: [{ name: "J. Doe", link: "https://instagram.com/janedoe/" }] });
    const artists = await t.run((ctx) => ctx.db.query("artists").collect());
    expect(artists).toHaveLength(1);
    // Declined: crediting her again by her link doesn't open a fresh page that holds shares.
    await t.run((ctx) => ctx.db.patch("artists", artists[0]._id, { status: "declined" }));
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "102-001", artists: [{ name: "Jane D", link: "instagram.com/janedoe" }] });
    expect(await t.run((ctx) => ctx.db.query("artists").collect())).toHaveLength(1);
    expect(await t.query(api.artists.forWork, { cr: "102-001" })).toEqual([]);
  });

  it("moves a claimed artist's held shares across many orders, a few at a time", async () => {
    const t = newTest();
    await makeUser(t, { name: "Owner", platformRole: "super_admin_owner", authId: ADMIN.subject });
    const a = await makeUser(t, { name: "A", creatorNumber: 2 });
    const jane = await t.run((ctx) => ctx.db.insert("users", { name: "Jane", authId: ARTIST.subject, username: "janedoe", usernameLower: "janedoe" }));
    const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
    await makeOnSale(t, root, "101-001", 1000);
    const owner = t.withIdentity(ADMIN);
    await owner.mutation(api.artists.adminSetWorkCredits, { cr: "101-001", artists: [{ name: "Jane Doe", link: "instagram.com/janedoe" }] });
    const artist = (await t.run((ctx) => ctx.db.query("artists").collect()))[0];
    const ORDERS = 25;
    for (let i = 0; i < ORDERS; i++) {
      shopify.set(rawOrder({ id: ORDER_ID + 100 + i, lines: [{ id: 200 + i, variant: 1002, quantity: 1, price: "36.00" }] }));
      await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID + 100 + i } });
    }
    expect(await earningsFor(t, artist.payeeId)).toHaveLength(ORDERS);
    const her = t.withIdentity(ARTIST);
    const claimId = await her.mutation(api.artists.startClaim, { artistId: artist._id });
    await her.mutation(api.artists.submitClaim, { claimId, proofUrl: "https://instagram.com/p/abc" });
    await owner.mutation(api.artists.approveClaim, { claimId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await earningsFor(t, artist.payeeId)).toHaveLength(0);
    const rows = await earningsFor(t, jane);
    expect(rows).toHaveLength(ORDERS);
    expect(rows.every((r) => r.state === "pending")).toBe(true);
  });

  it("lets a creator credit artists while publishing, and checks what they typed", async () => {
    const t = newTest();
    const b = await makeUser(t, { name: "B", creatorNumber: 3, authId: B.subject });
    await t.run((ctx) => ctx.db.patch("users", b, { username: "bee", usernameLower: "bee" }));
    const generationId = await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("creativeSessions", { ownerId: b, updatedAt: Date.now(), phrase: "", styleDirection: "", presets: [] });
      const batchId = await ctx.db.insert("batches", {
        sessionId,
        ownerId: b,
        instruction: "a mushroom",
        presets: [],
        backgroundColor: "#ffffff",
        operation: "create",
        model: "test",
        count: 1,
      });
      return await ctx.db.insert("generations", {
        sessionId,
        batchId,
        ownerId: b,
        index: 0,
        kind: "concept",
        status: "succeeded",
        provider: "test",
        model: "test",
        charged: true,
        favorite: false,
        fullKey: "fake:1",
      });
    });
    const bee = t.withIdentity(B);
    const four = ["a.art", "b.art", "c.art", "d.art"].map((link, i) => ({ name: "Artist " + i, link }));
    await expect(bee.mutation(api.publish.quick, { requestId: "r0", generationId, artists: four })).rejects.toThrow(/up to 3/u);
    const result = await bee.mutation(api.publish.quick, {
      requestId: "r1",
      generationId,
      artists: [{ name: "Jane Doe", link: "janedoe.art" }, { name: "", link: "" }],
    });
    const credits = await t.run((ctx) => ctx.db.query("artistCredits").withIndex("by_work", (q) => q.eq("workId", result.workId)).collect());
    expect(credits.map((c) => c.source)).toEqual(["creator"]);
    const payee = await t.run(async (ctx) => {
      const artist = await ctx.db.query("artists").first();
      return await ctx.db.get("users", artist!.payeeId);
    });
    // The payee is a hidden account: no sign-in, no username, and no wallet to make.
    expect(payee).toMatchObject({ artistPayee: true, walletStatus: "ready" });
    expect(payee?.authId).toBeUndefined();
  });
});
