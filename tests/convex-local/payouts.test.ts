import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newTest } from "./setup";

type T = ReturnType<typeof newTest>;

const OWNER = { subject: "test|owner", issuer: "test" };
const CREATOR = { subject: "test|creator", issuer: "test" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A creator with matured earnings from real orders (two sales and a refund taken after one
// matured), a pending sale, a paid sale from before, and test earnings that are never paid.
async function ledger(t: T) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", { name: "Owner", authId: OWNER.subject, platformRole: "super_admin_owner" });
    const creator = await ctx.db.insert("users", { name: "Maker", authId: CREATOR.subject, username: "maker", usernameLower: "maker", creatorNumber: 2, walletAddress: "0x00000000000000000000000000000000000000aa" });
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      shopifyOrderId: "9001",
      shopDomain: "s.myshopify.com",
      isTest: false,
      simulated: false,
      financialState: "PAID",
      cancelled: false,
      currency: "USD",
      totalCents: 7200,
      fulfillmentState: "shipped",
      createdAt: now,
      updatedAt: now,
    });
    const orderItemId = await ctx.db.insert("orderItems", {
      orderId,
      shopifyLineItemId: "1",
      quantity: 2,
      unitPriceCents: 3600,
      discountCents: 0,
      configVersion: 1,
      recipients: [],
      baseCents: 7200,
      poolCents: 1080,
      unitPoolCents: [540, 540],
      createdAt: now,
    });
    const row = (fields: { amountCents: number; state: "available" | "pending" | "paid"; kind?: "sale" | "reversal"; simulated?: boolean; unit?: number }) =>
      ctx.db.insert("earnings", {
        recipientId: creator,
        orderId,
        orderItemId,
        unit: fields.unit ?? 1,
        kind: fields.kind ?? "sale",
        roles: ["creator"],
        amountCents: fields.amountCents,
        state: fields.state,
        simulated: fields.simulated ?? false,
        createdAt: now,
        updatedAt: now,
      });
    await row({ amountCents: 4000, state: "available" });
    await row({ amountCents: 2500, state: "available", unit: 2 });
    await row({ amountCents: -500, state: "available", kind: "reversal" });
    await row({ amountCents: 900, state: "pending" });
    await row({ amountCents: 1200, state: "paid" });
    await row({ amountCents: 7700, state: "available", simulated: true });
    return { creator: creator as Id<"users"> };
  });
}

describe("payouts", () => {
  it("shows each creator's payable balance from real orders, refunds after maturity included", async () => {
    const t = newTest();
    const { creator } = await ledger(t);
    const { creators, minimumCents } = await t.withIdentity(OWNER).query(api.payouts.balances, {});
    expect(minimumCents).toBe(5000);
    expect(creators).toEqual([
      {
        recipientId: creator,
        username: "maker",
        creatorNumber: 2,
        walletAddress: "0x00000000000000000000000000000000000000aa",
        availableCents: 6000,
        pendingCents: 900,
        paidCents: 1200,
        rows: 3,
      },
    ]);
    await expect(t.withIdentity(CREATOR).query(api.payouts.balances, {})).rejects.toThrow(/Owner only/u);
  });

  it("records a payout for exactly the balance shown, and the creator sees it", async () => {
    const t = newTest();
    const { creator } = await ledger(t);
    const owner = t.withIdentity(OWNER);
    // A balance that changed since the page loaded isn't recorded.
    await expect(owner.mutation(api.payouts.markPaid, { recipientId: creator, expectedCents: 6500, method: "usdc", reference: "0xabc" })).rejects.toThrow(/changed/u);
    await expect(owner.mutation(api.payouts.markPaid, { recipientId: creator, expectedCents: 6000, method: "usdc", reference: "  " })).rejects.toThrow(/reference/u);

    const done = await owner.mutation(api.payouts.markPaid, { recipientId: creator, expectedCents: 6000, method: "usdc", reference: "0xabc" });
    expect(done).toMatchObject({ amountCents: 6000, rows: 3 });
    const after = (await owner.query(api.payouts.balances, {})).creators[0];
    expect(after).toMatchObject({ availableCents: 0, paidCents: 7200, pendingCents: 900 });
    // Test earnings stay unpaid.
    const test = await t.run((ctx) => ctx.db.query("earnings").filter((q) => q.eq(q.field("simulated"), true)).first());
    expect(test?.state).toBe("available");
    expect(await owner.query(api.payouts.history, {})).toMatchObject([{ username: "maker", amountCents: 6000, method: "usdc", reference: "0xabc" }]);
    expect(await t.withIdentity(CREATOR).query(api.payouts.mine, {})).toMatchObject([{ amountCents: 6000, method: "usdc", reference: "0xabc" }]);
    await expect(owner.mutation(api.payouts.markPaid, { recipientId: creator, expectedCents: 0, method: "usdc", reference: "again" })).rejects.toThrow(/Nothing is payable/u);
  });
});

