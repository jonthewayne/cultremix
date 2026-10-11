import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SHOPIFY_WEBHOOK_MAX_BYTES } from "../../shared/config/shopify";
import { rawOrder, type FixtureLine } from "../fixtures/shopifyOrder";
import { ensureCreatorNumber } from "../../convex/lib/creators";
import { newTest } from "./setup";
import { SHOP_ENV, deliver, fakeShopify, makeOnSale, makeUser, makeWork } from "./shopFixtures";

type T = ReturnType<typeof newTest>;
const DAY = 24 * 60 * 60 * 1000;

// The first webhook loads every Convex module; under a full parallel run that can pass 5 seconds.
vi.setConfig({ testTimeout: 30_000 });

const ORDER_ID = 5551234;
const GID = `gid://shopify/Order/${ORDER_ID}`;

// A variation by B in A's family, on sale with variants numbered from 1000.
async function variationOnSale(t: T, opts: { creatorNumbers?: boolean } = {}) {
  const numbered = opts.creatorNumbers ?? true;
  const a = await makeUser(t, { name: "A", creatorNumber: numbered ? 1 : undefined });
  const b = await makeUser(t, { name: "B", creatorNumber: numbered ? 2 : undefined, authId: "auth-b" });
  const root = await makeWork(t, { creatorId: a, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
  const work = await makeWork(t, { creatorId: b, family: 101, expression: 2, parent: root, root, printKey: "works/101/002/print-y/print.png" });
  await makeOnSale(t, work, "101-002", 1000);
  return { a, b, work };
}

const line = (quantity: number, extra: Partial<FixtureLine> = {}): FixtureLine => ({
  id: 11,
  variant: 1002,
  quantity,
  price: "36.00",
  ...extra,
});

async function earningsFor(t: T, who: Id<"users">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("earnings")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", who))
      .collect(),
  );
  return rows.sort((x, y) => x.unit - y.unit || x._creationTime - y._creationTime);
}

const sum = (rows: Array<{ amountCents: number }>) => rows.reduce((total, r) => total + r.amountCents, 0);
const sumState = (rows: Array<{ amountCents: number; state: string }>, ...states: Array<string>) =>
  sum(rows.filter((r) => states.includes(r.state)));

async function onlyOrder(t: T) {
  const orders = await t.run((ctx) => ctx.db.query("orders").collect());
  expect(orders).toHaveLength(1);
  return orders[0];
}

let shopify: ReturnType<typeof fakeShopify>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
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

describe("POST /webhooks/shopify", () => {
  it("refuses a missing or bad HMAC and writes nothing", async () => {
    const t = newTest();
    const missing = await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, signature: null });
    expect(missing.status).toBe(401);
    const bad = await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, signature: "AAAA" });
    expect(bad.status).toBe(401);
    const wrongKey = createHmac("sha256", "other").update(JSON.stringify({ id: ORDER_ID })).digest("base64");
    expect((await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, signature: wrongKey })).status).toBe(401);
    const written = await t.run(async (ctx) => [
      ...(await ctx.db.query("webhookEvents").collect()),
      ...(await ctx.db.query("webhookPayloads").collect()),
      ...(await ctx.db.query("shopifyInbox").collect()),
    ]);
    expect(written).toHaveLength(0);
  });

  it("answers 503 before the client secret is set", async () => {
    const t = newTest();
    vi.stubEnv("SHOPIFY_CLIENT_SECRET", "");
    expect((await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, signature: "x" })).status).toBe(503);
  });

  it("refuses an oversized body", async () => {
    const t = newTest();
    const raw = JSON.stringify({ id: ORDER_ID, note: "x".repeat(SHOPIFY_WEBHOOK_MAX_BYTES) });
    expect((await deliver(t, { topic: "orders/paid", body: {}, raw })).status).toBe(413);
  });

  it("ignores another shop and unknown topics, recording why", async () => {
    const t = newTest();
    const other = await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, shop: "someone-else.myshopify.com" });
    expect(other.status).toBe(200);
    const topic = await deliver(t, { topic: "products/update", body: { id: 1 } });
    expect(topic.status).toBe(200);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events.map((e) => [e.outcome, e.reason])).toEqual([
      ["ignored", "other shop"],
      ["ignored", "unknown topic"],
    ]);
    expect(await t.run((ctx) => ctx.db.query("shopifyInbox").collect())).toHaveLength(0);
  });

  it("refuses malformed bodies", async () => {
    const t = newTest();
    expect((await deliver(t, { topic: "orders/paid", body: {}, raw: "{nope" })).status).toBe(400);
    expect((await deliver(t, { topic: "orders/paid", body: { name: "#1" } })).status).toBe(400);
  });

  it("stores the delivery, hydrates the order, and writes earnings once across duplicates", async () => {
    const t = newTest();
    const { a, b } = await variationOnSale(t);
    // 2 x $36 with $7.20 off: base 6480, pool 972, units 486 + 486; A and B each 243 per unit.
    shopify.set(rawOrder({ lines: [line(2, { discount: "7.20" })], ref: "friend" }));

    const first = await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, webhookId: "dup-1" });
    expect(first.status).toBe(200);
    const again = await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID }, webhookId: "dup-1" });
    expect(await again.text()).toBe("Duplicate");

    const stored = await t.run(async (ctx) => ({
      events: await ctx.db.query("webhookEvents").collect(),
      payloads: await ctx.db.query("webhookPayloads").collect(),
      inbox: await ctx.db.query("shopifyInbox").collect(),
    }));
    expect(stored.events).toHaveLength(1);
    expect(stored.payloads[0].body).toBe(JSON.stringify({ id: ORDER_ID }));
    expect(stored.payloads[0].expiresAt).toBe(Date.now() + 30 * DAY);
    expect(stored.inbox[0]).toMatchObject({ hydration: "complete", events: [{ topic: "orders/paid", webhookId: "dup-1" }] });

    const order = await onlyOrder(t);
    expect(order).toMatchObject({ isTest: false, simulated: false, ref: "friend", fulfillmentState: "waiting", totalCents: 6480 });
    expect(order.economicEventAt).toBe(Date.parse("2026-10-01T17:00:00Z"));
    const items = await t.run((ctx) => ctx.db.query("orderItems").collect());
    expect(items[0]).toMatchObject({ baseCents: 6480, poolCents: 972, unitPoolCents: [486, 486] });

    // A second, different delivery for the same order re-hydrates without new rows.
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    for (const who of [a, b]) {
      const rows = await earningsFor(t, who);
      expect(rows.map((r) => [r.unit, r.amountCents, r.state])).toEqual([
        [1, 243, "pending"],
        [2, 243, "pending"],
      ]);
    }
    expect((await earningsFor(t, a))[0].roles).toEqual(["family_root"]);
  });

  it("handles cancel before paid", async () => {
    const t = newTest();
    const { b } = await variationOnSale(t);
    shopify.set(rawOrder({ paid: false, cancelledAt: "2026-10-01T17:30:00Z", lines: [line(1)] }));
    await deliver(t, { topic: "orders/cancelled", body: { id: ORDER_ID } });
    let order = await onlyOrder(t);
    expect(order).toMatchObject({ cancelled: true, fulfillmentState: "canceled" });
    expect(await earningsFor(t, b)).toHaveLength(0);

    // The payment lands afterwards; the cancellation still wins and nets the sale to zero.
    shopify.set(rawOrder({ cancelledAt: "2026-10-01T17:30:00Z", updatedAt: "2026-10-01T18:30:00Z", lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    order = await onlyOrder(t);
    expect(order.fulfillmentState).toBe("canceled");
    const rows = await earningsFor(t, b);
    expect(rows.map((r) => [r.kind, r.amountCents, r.state])).toEqual([
      ["sale", 270, "reversed"],
      ["reversal", -270, "reversed"],
    ]);
    // A sale cancelled before it was paid tells nobody it sold.
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(0);
  });

  it("tells each person a sale pays what it earned them, once", async () => {
    const t = newTest();
    const { a, b, work } = await variationOnSale(t);
    // 2 x $36 with $7.20 off: A (the family's original) and B (the remixer) each earn 243 per unit.
    shopify.set(rawOrder({ lines: [line(2, { discount: "7.20" })] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });

    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(2);
    const root = (await t.run((ctx) => ctx.db.get("works", work)))?.parentWorkId;
    const toB = rows.find((r) => r.recipientId === b);
    const toA = rows.find((r) => r.recipientId === a);
    expect(toB).toMatchObject({ kind: "sale", workId: work, sale: { cents: 486, units: 2, test: false } });
    expect(toB?.actorId).toBeUndefined();
    expect(toB?.ownWorkId).toBeUndefined();
    expect(toA).toMatchObject({ kind: "sale", workId: work, ownWorkId: root, sale: { cents: 486, units: 2, test: false } });

    const viewer = t.withIdentity({ subject: "auth-b" });
    expect(await viewer.query(api.notifications.status, {})).toMatchObject({ unread: 1 });
    const list = await viewer.query(api.notifications.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(list.page).toHaveLength(1);
    expect(list.page[0]).toMatchObject({ kind: "sale", work: { cr: "101-002" }, sale: { cents: 486, units: 2, test: false } });
    expect(list.page[0].actor.username).toBeUndefined();
    expect(list.page[0].parent).toBeUndefined();
  });

  it("emails each person a real sale pays while sale emails are on, unless they turned them off", async () => {
    const saleEmailJobs = async (t: T) =>
      (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("saleEmails"));
    // Off by default: notifications only.
    const off = newTest();
    vi.stubEnv("DEPLOYMENT_ENV", "prod");
    await variationOnSale(off);
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(off, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect(await saleEmailJobs(off)).toHaveLength(0);

    // On: one email per person with an address; B turned them off.
    const t = newTest();
    const { a, b } = await variationOnSale(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "email.sales", enabled: true });
      await ctx.db.patch("users", a, { email: "a@example.com" });
      await ctx.db.patch("users", b, { email: "b@example.com", saleEmails: false });
    });
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    const jobs = await saleEmailJobs(t);
    expect(jobs.map((job) => (job.args[0] as { to: string }).to)).toEqual(["a@example.com"]);
    expect((jobs[0].args[0] as { lines: Array<{ cr: string; from?: { cr: string } }> }).lines).toEqual([
      expect.objectContaining({ cr: "101-002", from: expect.objectContaining({ cr: "101-001" }) }),
    ]);
  });

  it("never emails about a test order", async () => {
    const t = newTest();
    const { a } = await variationOnSale(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "email.sales", enabled: true });
      await ctx.db.patch("users", a, { email: "a@example.com" });
    });
    shopify.set(rawOrder({ test: true, lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    const jobs = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("saleEmails"));
    expect(jobs).toHaveLength(0);
  });

  it("never tells a kept design's creator that someone bought it (they did), but tells the original's", async () => {
    const t = newTest();
    const { a, b, work } = await variationOnSale(t);
    await t.run((ctx) => ctx.db.patch("works", work, { status: "private", keep: "private" }));
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    // Both still earn their shares.
    expect(await earningsFor(t, a)).toHaveLength(1);
    expect(await earningsFor(t, b)).toHaveLength(1);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.recipientId)).toEqual([a]);
  });

  it("never names a kept design to anyone else it pays: not in the notification, the email, or Earnings", async () => {
    const t = newTest();
    const { a, work } = await variationOnSale(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("works", work, { status: "private", keep: "private", title: "Our Family" });
      await ctx.db.insert("featureFlags", { key: "email.sales", enabled: true });
      await ctx.db.patch("users", a, { email: "a@example.com", authId: "auth-a" });
    });
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });

    const original = t.withIdentity({ subject: "auth-a" });
    const list = await original.query(api.notifications.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(list.page).toHaveLength(1);
    expect(list.page[0]).toMatchObject({ kind: "sale", privateRemix: true, parent: { cr: "101-001" } });
    expect(list.page[0].work).toBeUndefined();
    const email = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).find((job) => job.name.includes("saleEmails"));
    expect((email?.args[0] as { lines: Array<Record<string, unknown>> }).lines).toEqual([
      expect.objectContaining({ from: expect.objectContaining({ cr: "101-001" }) }),
    ]);
    expect(JSON.stringify(email?.args)).not.toContain("Our Family");
    expect(JSON.stringify(email?.args)).not.toContain("101-002");
    const earned = await original.query(api.earnings.mine, {});
    expect(earned?.entries[0]).toMatchObject({ cr: null, title: null, keptId: null, privateRemix: true });
    // Its own creator sees it by name, linked to its private page.
    const kept = await t.withIdentity({ subject: "auth-b" }).query(api.earnings.mine, {});
    expect(kept?.entries[0]).toMatchObject({ cr: null, title: "Our Family", keptId: work, privateRemix: false });
  });

  it("handles refund before paid, reversing only the refunded unit", async () => {
    const t = newTest();
    const { a, b } = await variationOnSale(t);
    shopify.set(
      rawOrder({
        lines: [line(2)],
        refunds: [{ id: 900, lines: [{ lineItem: 11, quantity: 1, subtotal: "36.00", tax: "2.88" }], total: "38.88" }],
      }),
    );
    await deliver(t, { topic: "refunds/create", body: { id: 900, order_id: ORDER_ID } });
    const inbox = await t.run((ctx) => ctx.db.query("shopifyInbox").collect());
    expect(inbox[0].events[0]).toMatchObject({ topic: "refunds/create", refundId: "900" });
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });

    for (const who of [a, b]) {
      const rows = await earningsFor(t, who);
      // Unit 2 (the highest unshipped) is reversed; unit 1 stays pending.
      expect(rows.map((r) => [r.unit, r.kind, r.amountCents, r.state])).toEqual([
        [1, "sale", 270, "pending"],
        [2, "sale", 270, "reversed"],
        [2, "reversal", -270, "reversed"],
      ]);
    }
    const refunds = await t.run((ctx) => ctx.db.query("refunds").collect());
    expect(refunds).toHaveLength(1);
    expect(refunds[0].lines[0]).toMatchObject({ quantity: 1, amountCents: 3600 });
    // The sale notification counts only the shirt that wasn't refunded.
    const sold = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(sold.map((r) => r.sale)).toEqual([
      { cents: 270, units: 1, test: false },
      { cents: 270, units: 1, test: false },
    ]);
  });

  it("holds a unit while its refund is pending and releases it when the refund fails", async () => {
    const t = newTest();
    const { b } = await variationOnSale(t);
    const pending = { id: 901, lines: [{ lineItem: 11, quantity: 1, subtotal: "36.00" }], total: "36.00", transactionStatus: "PENDING" as const };
    shopify.set(rawOrder({ lines: [line(1)], refunds: [pending] }));
    await deliver(t, { topic: "refunds/create", body: { id: 901, order_id: ORDER_ID } });
    let rows = await earningsFor(t, b);
    expect(rows.map((r) => [r.kind, r.state, r.holdReason])).toEqual([["sale", "held", "refund"]]);

    shopify.set(rawOrder({ updatedAt: "2026-10-01T19:00:00Z", lines: [line(1)], refunds: [{ ...pending, transactionStatus: "FAILURE" }] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    rows = await earningsFor(t, b);
    expect(rows.map((r) => [r.kind, r.state, r.holdReason])).toEqual([["sale", "pending", undefined]]);
  });

  it("ignores a snapshot older than the one already applied", async () => {
    const t = newTest();
    await variationOnSale(t);
    shopify.set(rawOrder({ cancelledAt: "2026-10-01T18:00:00Z", updatedAt: "2026-10-01T18:00:00Z", lines: [line(1)] }));
    await deliver(t, { topic: "orders/cancelled", body: { id: ORDER_ID } });
    shopify.set(rawOrder({ updatedAt: "2026-10-01T17:10:00Z", lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await onlyOrder(t)).cancelled).toBe(true);
  });

  it("never creates earnings for a test order in production", async () => {
    const t = newTest();
    vi.stubEnv("DEPLOYMENT_ENV", "prod");
    const { b } = await variationOnSale(t);
    shopify.set(rawOrder({ test: true, lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect(await onlyOrder(t)).toMatchObject({ isTest: true, simulated: false, fulfillmentState: "test_ignored" });
    expect(await t.run((ctx) => ctx.db.query("earnings").collect())).toHaveLength(0);
    expect(b).toBeDefined();
  });

  it("treats an unknown deployment like production for test orders", async () => {
    const t = newTest();
    vi.stubEnv("DEPLOYMENT_ENV", "");
    await variationOnSale(t);
    shopify.set(rawOrder({ test: true, lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await onlyOrder(t)).fulfillmentState).toBe("test_ignored");
    expect(await t.run((ctx) => ctx.db.query("earnings").collect())).toHaveLength(0);
  });

  it("labels test-order earnings Test in staging and keeps them out of real balances", async () => {
    const t = newTest();
    const { b } = await variationOnSale(t);
    shopify.set(rawOrder({ test: true, lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect(await onlyOrder(t)).toMatchObject({ isTest: true, simulated: true });
    const viewer = t.withIdentity({ subject: "auth-b" });
    const mine = await viewer.query(api.earnings.mine, {});
    expect(mine?.totals).toEqual({ pendingCents: 0, availableCents: 0, paidCents: 0 });
    expect(mine?.testTotals.pendingCents).toBe(270);
    expect(mine?.entries[0]).toMatchObject({ test: true, status: "Pending", cr: "101-002", kind: "sale" });
    expect((await earningsFor(t, b))[0].simulated).toBe(true);
    const sold = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(sold.map((r) => r.sale?.test)).toEqual([true, true]);
  });

  it("holds shares for members without creator access until they get a creator number", async () => {
    const t = newTest();
    const { a } = await variationOnSale(t, { creatorNumbers: false });
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect((await earningsFor(t, a)).map((r) => [r.state, r.holdReason])).toEqual([["held", "not_creator"]]);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.find((n) => n.recipientId === a)?.sale).toMatchObject({ held: true });

    // Getting a creator number (an admin grant or a judge account) schedules the release.
    await t.run(async (ctx) => {
      const user = await ctx.db.get("users", a);
      await ensureCreatorNumber(ctx, user!);
    });
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((job) => job.name.includes("releaseCreatorHolds") && (job.args[0] as { userId?: string })?.userId === a)).toBe(true);
    expect(await t.mutation(internal.earnings.releaseCreatorHolds, { userId: a })).toBe(1);
    expect((await earningsFor(t, a))[0].state).toBe("pending");
  });

  it("matures a shipped unit after 30 days, with its partial reversal", async () => {
    const t = newTest();
    const { b } = await variationOnSale(t);
    shopify.set(
      rawOrder({
        lines: [line(1)],
        refunds: [{ id: 902, lines: [{ lineItem: 11, quantity: 0, subtotal: "12.00" }], total: "12.00" }],
      }),
    );
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    const order = await onlyOrder(t);
    const [item] = await t.run((ctx) => ctx.db.query("orderItems").collect());
    await t.run((ctx) =>
      ctx.db.insert("orderShipments", {
        orderId: order._id,
        printfulShipmentId: "s1",
        shippedAt: Date.now(),
        lines: [{ orderItemId: item._id, fromUnit: 1, toUnit: 1 }],
      }),
    );
    await t.action(internal.orders.hydrate, { shopifyOrderId: String(ORDER_ID) });
    let rows = await earningsFor(t, b);
    // $12 of $36 refunded: floor(540 x 1200 / 3600) = 180 pool cents, 90 from B.
    expect(rows.map((r) => [r.kind, r.amountCents, r.state])).toEqual([
      ["sale", 270, "pending"],
      ["reversal", -90, "pending"],
    ]);
    expect(rows[0].maturesAt).toBe(Date.now() + 30 * DAY);

    expect(await t.mutation(internal.earnings.matureDue, {})).toBe(0);
    vi.setSystemTime(Date.now() + 30 * DAY + 1);
    expect(await t.mutation(internal.earnings.matureDue, {})).toBe(2);
    rows = await earningsFor(t, b);
    expect(sumState(rows, "available")).toBe(180);
  });

  it("waits, without failing, until Shopify is configured", async () => {
    const t = newTest();
    vi.stubEnv("SHOPIFY_CLIENT_ID", "");
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    const [inbox] = await t.run((ctx) => ctx.db.query("shopifyInbox").collect());
    expect(inbox).toMatchObject({ hydration: "pending", attempts: 0, lastError: "Shopify is not configured yet." });
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(0);
  });

  it("flags lines that aren't CultRemix designs", async () => {
    const t = newTest();
    await variationOnSale(t);
    shopify.set(rawOrder({ lines: [line(1, { variant: 99999 })] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect(await onlyOrder(t)).toMatchObject({ fulfillmentState: "needs_attention" });
    expect(await t.run((ctx) => ctx.db.query("earnings").collect())).toHaveLength(0);
  });
});

describe("Shopify reconciliation", () => {
  it("hydrates an order whose webhook never arrived and retries failed hydrations", async () => {
    const t = newTest();
    const { b } = await variationOnSale(t);
    shopify.set(rawOrder({ lines: [line(1)] }));
    shopify.updated.push({ id: GID, updatedAt: "2026-10-01T18:00:00Z" });
    await t.action(internal.orders.reconcile, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await earningsFor(t, b))).toHaveLength(1);
    const cursor = await t.query(internal.orders.reconcileCursor, {});
    expect(cursor).toBeGreaterThanOrEqual(Date.parse("2026-10-01T18:00:00Z"));

    // Already current: the next pass queues nothing.
    const before = shopify.hydrations();
    expect((await t.action(internal.orders.reconcile, {})).queued).toBe(0);
    expect(shopify.hydrations()).toBe(before);
  });

  it("purges payloads after 30 days", async () => {
    const t = newTest();
    await variationOnSale(t);
    shopify.set(rawOrder({ lines: [line(1)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    expect(await t.mutation(internal.orders.purgeExpiredPayloads, {})).toBe(0);
    vi.setSystemTime(Date.now() + 31 * DAY);
    expect(await t.mutation(internal.orders.purgeExpiredPayloads, {})).toBe(1);
  });
});

describe("orders.adminList", () => {
  it("is owner-only", async () => {
    const t = newTest();
    await makeUser(t, { authId: "member" });
    await makeUser(t, { authId: "owner", platformRole: "super_admin_owner" });
    await variationOnSale(t);
    shopify.set(rawOrder({ lines: [line(2)] }));
    await deliver(t, { topic: "orders/paid", body: { id: ORDER_ID } });
    await expect(t.query(api.orders.adminList, {})).rejects.toThrow();
    await expect(t.withIdentity({ subject: "member" }).query(api.orders.adminList, {})).rejects.toThrow();
    const list = await t.withIdentity({ subject: "owner" }).query(api.orders.adminList, {});
    // Paid, and waiting to go to print because Printful isn't set up in this test: Admin says why.
    expect(list.orders[0]).toMatchObject({
      name: "#1001",
      paid: true,
      fulfillmentState: "waiting",
      retrying: "Printful is not configured yet.",
      poolCents: 1080,
    });
    expect(list.orders[0].lines).toEqual([{ cr: "101-002", kept: false, sku: null, quantity: 2, refunded: 0 }]);
  });
});

describe("orders.simulateSale", () => {
  it("rehearses a sale outside production: Test earnings and notifications, nothing to print", async () => {
    const t = newTest();
    await makeUser(t, { authId: "owner", platformRole: "super_admin_owner" });
    const { a, b, work } = await variationOnSale(t);
    const owner = t.withIdentity({ subject: "owner" });

    const sale = await owner.mutation(api.orders.simulateSale, { workId: work, quantity: 2 });
    expect(sale).toMatchObject({ orderName: "Simulated sale of CR 101-002", recipients: 2 });
    expect(sale.poolCents).toBeGreaterThan(0);
    expect(await onlyOrder(t)).toMatchObject({ isTest: true, simulated: true, fulfillmentState: "test_ignored" });
    for (const who of [a, b]) {
      const rows = await earningsFor(t, who);
      expect(rows.map((r) => [r.kind, r.state, r.simulated])).toEqual([
        ["sale", "pending", true],
        ["sale", "pending", true],
      ]);
    }
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => [n.kind, n.sale?.units, n.sale?.test])).toEqual([
      ["sale", 2, true],
      ["sale", 2, true],
    ]);

    // Members can't, and production refuses even the owner.
    await expect(t.withIdentity({ subject: "auth-b" }).mutation(api.orders.simulateSale, { workId: work })).rejects.toThrow();
    vi.stubEnv("DEPLOYMENT_ENV", "prod");
    await expect(owner.mutation(api.orders.simulateSale, { workId: work })).rejects.toThrow(/dev and staging/);
  });
});
