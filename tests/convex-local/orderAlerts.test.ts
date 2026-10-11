import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { newTest } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

// Orders that can't go on by themselves tell the owner and ops (convex/orderAlerts.ts).

type T = ReturnType<typeof newTest>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function order(t: T, fields: { name: string; state: "needs_attention" | "on_hold" | "submitted"; reason?: string }) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("orders", {
      shopifyOrderId: fields.name.replace("#", ""),
      orderName: fields.name,
      shopDomain: "s.myshopify.com",
      isTest: false,
      simulated: false,
      financialState: "PAID",
      cancelled: false,
      currency: "USD",
      totalCents: 3600,
      fulfillmentState: fields.state,
      ...(fields.reason ? { attentionReason: fields.reason } : {}),
      createdAt: now,
      updatedAt: now,
    });
  });
}

const bell = (t: T, subject: string) =>
  t.withIdentity({ subject }).query(api.notifications.list, { paginationOpts: { numItems: 20, cursor: null } });

describe("stuck order alerts", () => {
  it("tell the owner and ops once per state and reason, and email the owner", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "owner", email: "owner@example.com", username: "owner", usernameLower: "owner", platformRole: "super_admin_owner" });
      await ctx.db.insert("users", { authId: "ops", username: "ops", usernameLower: "ops", platformRole: "super_admin_ops" });
      await ctx.db.insert("users", { authId: "member", username: "member", usernameLower: "member" });
    });
    const stuck: Id<"orders"> = await order(t, { name: "#1001", state: "needs_attention", reason: "CR 101-001 was taken down." });
    await order(t, { name: "#1002", state: "on_hold" });
    await order(t, { name: "#1003", state: "submitted" });

    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(2);
    for (const who of ["owner", "ops"]) {
      const items = (await bell(t, who)).page.map((item) => item.order);
      expect(items).toEqual(
        expect.arrayContaining([
          { name: "#1001", reason: "CR 101-001 was taken down." },
          { name: "#1002", reason: expect.stringMatching(/^Printful put it on hold/u) },
        ]),
      );
      expect(items).toHaveLength(2);
    }
    expect((await bell(t, "member")).page).toEqual([]);
    const emails = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("orderAlerts"));
    expect(emails.map((job) => (job.args[0] as { to: string; orderName: string }).orderName).sort()).toEqual(["#1001", "#1002"]);
    expect(emails.every((job) => (job.args[0] as { to: string }).to === "owner@example.com")).toBe(true);

    // The same trouble doesn't alert again; a new reason does.
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(0);
    await t.run((ctx) => ctx.db.patch("orders", stuck, { attentionReason: "Printful refused the address." }));
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(1);
    expect((await bell(t, "owner")).page[0]).toMatchObject({ kind: "order_attention", order: { name: "#1001", reason: "Printful refused the address." } });
  });

  it("tell the owner about a paid order still waiting an hour on, and a production draft past its hold", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "owner", email: "owner@example.com", username: "owner", usernameLower: "owner", platformRole: "super_admin_owner" });
    });
    const hour = 60 * 60 * 1000;
    const insert = (name: string, fields: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const now = Date.now();
        return await ctx.db.insert("orders", {
          shopifyOrderId: name.replace("#", ""),
          orderName: name,
          shopDomain: "s.myshopify.com",
          isTest: false,
          simulated: false,
          financialState: "PAID",
          cancelled: false,
          currency: "USD",
          totalCents: 3600,
          fulfillmentState: "waiting",
          createdAt: now,
          updatedAt: now,
          ...fields,
        });
      });
    const now = Date.now();
    const late = await insert("#2001", { economicEventAt: now - 2 * hour, fulfillmentError: "Printful is not configured yet." });
    await insert("#2002", { economicEventAt: now - 10 * 60 * 1000 });
    await insert("#2003", { financialState: "PENDING", createdAt: now - 5 * hour });
    await insert("#2004", { fulfillmentState: "draft", printfulOrderId: 77, economicEventAt: now - 3 * hour, holdUntil: now - 2 * hour });
    const names = async () => (await bell(t, "owner")).page.map((item) => item.order?.name);

    // Dev stops at drafts, so only the order that never reached Printful is late.
    vi.stubEnv("DEPLOYMENT_ENV", "dev");
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(1);
    expect((await bell(t, "owner")).page[0]).toMatchObject({ kind: "order_attention", order: { name: "#2001", reason: expect.stringMatching(/Printful isn't connected/u) } });

    // Production with PRINTFUL_AUTO_CONFIRM unset: the draft past its hold is late too.
    vi.stubEnv("DEPLOYMENT_ENV", "prod");
    vi.stubEnv("PRINTFUL_AUTO_CONFIRM", "");
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(1);
    expect((await bell(t, "owner")).page[0]).toMatchObject({ order: { name: "#2004", reason: expect.stringMatching(/PRINTFUL_AUTO_CONFIRM/u) } });
    expect((await names()).sort()).toEqual(["#2001", "#2004"]);

    // Printful connected but failing is new trouble; failing again with a new message isn't.
    await t.run((ctx) => ctx.db.patch("orders", late, { fulfillmentError: "Printful said 503." }));
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(1);
    await t.run((ctx) => ctx.db.patch("orders", late, { fulfillmentError: "Printful said 502." }));
    expect(await t.mutation(internal.orderAlerts.alertStuck, {})).toBe(0);
    const emails = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes("orderAlerts"));
    expect(emails.map((job) => (job.args[0] as { orderName: string }).orderName).sort()).toEqual(["#2001", "#2001", "#2004"]);

    // Admin, Orders says the same.
    const list = await t.withIdentity({ subject: "owner" }).query(api.orders.adminList, {});
    const lateNote = (name: string) => list.orders.find((o) => o.name === name)?.late;
    expect(lateNote("#2001")).toBe("It was paid over an hour ago and still hasn't reached Printful. The last try said: Printful said 502.");
    expect(lateNote("#2004")).toMatch(/PRINTFUL_AUTO_CONFIRM/u);
    expect(lateNote("#2002")).toBeNull();
    expect(lateNote("#2003")).toBeNull();
  });
});
