import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { affiliateFor } from "../../convex/orders";
import { newTest } from "./setup";
import { makeUser, makeWork } from "./shopFixtures";
import type { Id } from "../../convex/_generated/dataModel";

// Economics v2: a sale pays the design's creators their 15%, the family's brand its rate, and the
// member whose link brought the buyer 5%, each exact to the cent.

type T = ReturnType<typeof newTest>;

async function member(t: T, username: string, extra: { creatorNumber?: number; authId?: string } = {}) {
  return t.run((ctx) =>
    ctx.db.insert("users", { name: username, username, usernameLower: username.toLowerCase(), email: `${username.toLowerCase()}@example.com`, ...extra }),
  );
}

async function sales(t: T, who: Id<"users">) {
  const rows = await t.run((ctx) => ctx.db.query("earnings").collect());
  return rows.filter((row) => row.recipientId === who && row.kind === "sale").map((row) => [row.amountCents, row.state, row.roles]);
}

async function setup() {
  // Simulated sales run outside production only.
  vi.stubEnv("DEPLOYMENT_ENV", "dev");
  const t = newTest();
  await makeUser(t, { authId: "owner", platformRole: "super_admin_owner" });
  const owner = t.withIdentity({ subject: "owner" });
  const ana = await member(t, "Ana", { creatorNumber: 1 });
  const cam = await member(t, "Cam", { authId: "auth-cam" });
  const nike = await member(t, "Nike");
  const work = await makeWork(t, { creatorId: ana, family: 101, expression: 1, printKey: "works/101/001/print-x/print.png" });
  return { t, owner, ana, cam, nike, work };
}

describe("economics v2: brands and affiliates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("pays the brand and the member whose link brought the buyer, on top of the creator's 15%", async () => {
    const { t, owner, ana, cam, nike, work } = await setup();
    await owner.mutation(api.brands.save, { username: "@nike", name: "Nike", bps: 1000, families: [101] });

    // A $36 shirt (the built-in launch shirt): 15% + 5% + 10% = $10.80.
    const sale = await owner.mutation(api.orders.simulateSale, { workId: work, ref: "CAM" });
    expect(sale).toMatchObject({ recipients: 3, poolCents: 1080 });
    expect(await sales(t, ana)).toEqual([[540, "pending", ["creator"]]]);
    // An affiliate's or a brand's share isn't held for creator access.
    expect(await sales(t, cam)).toEqual([[180, "pending", ["affiliate"]]]);
    expect(await sales(t, nike)).toEqual([[360, "pending", ["brand"]]]);

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    const via = (who: Id<"users">) => notes.find((note) => note.recipientId === who)?.sale?.via ?? null;
    expect([via(ana), via(cam), via(nike)]).toEqual([null, "link", "brand"]);

    // The design's page shows the brand and the share for sharing it.
    const panel = await t.query(api.workEconomics.panel, { cr: "101-001" });
    expect(panel).toMatchObject({ configVersion: 3, affiliateBps: 500, brand: { name: "Nike", username: "Nike", bps: 1000, creatorBps: null } });
  });

  it("lets a big brand's agreement take 15% and set its family's creators at 10% (economics v3)", async () => {
    const { t, owner, ana, cam, nike, work } = await setup();
    await owner.mutation(api.brands.save, { username: "nike", name: "Nike", bps: 1500, creatorBps: 1000, families: [101] });

    // A $36 shirt: creators 10% ($3.60), the link 5% ($1.80), the brand 15% ($5.40).
    const sale = await owner.mutation(api.orders.simulateSale, { workId: work, ref: "cam" });
    expect(sale).toMatchObject({ recipients: 3, poolCents: 1080 });
    expect(await sales(t, ana)).toEqual([[360, "pending", ["creator"]]]);
    expect(await sales(t, cam)).toEqual([[180, "pending", ["affiliate"]]]);
    expect(await sales(t, nike)).toEqual([[540, "pending", ["brand"]]]);

    // The design's page shows the family's split.
    const panel = await t.query(api.workEconomics.panel, { cr: "101-001" });
    expect(panel).toMatchObject({ configVersion: 3, creatorPoolBps: 1000, brand: { name: "Nike", bps: 1500, creatorBps: 1000 } });

    // Whole percents, never under 5%, and the two together at most 50% of the price.
    const save = (bps: number, creatorBps: number) =>
      owner.mutation(api.brands.save, { username: "nike", name: "Nike", bps, creatorBps, families: [101] });
    await expect(save(1500, 400)).rejects.toThrow(/at least 5%/u);
    await expect(save(1500, 1050)).rejects.toThrow(/whole percent/u);
    await expect(save(4000, 1500)).rejects.toThrow(/more than 50%/u);
    const list = await owner.query(api.brands.list, {});
    expect(list).toMatchObject({ defaultCreatorBps: 1500, minCreatorBps: 500 });
    expect(list.brands[0]).toMatchObject({ name: "Nike", bps: 1500, creatorBps: 1000 });
  });

  it("finds the link's member by username, never for their own purchase or an unknown name", async () => {
    const { t, cam } = await setup();
    await t.run(async (ctx) => {
      expect(await affiliateFor(ctx, "@CAM", "buyer@example.com")).toBe(cam);
      expect(await affiliateFor(ctx, "cam", " Cam@Example.com ")).toBeNull();
      expect(await affiliateFor(ctx, "nobody", undefined)).toBeNull();
      expect(await affiliateFor(ctx, undefined, undefined)).toBeNull();
    });
  });

  it("keeps each family to one brand, stops a brand on new sales, and lets only managers set brands", async () => {
    const { t, owner, ana, work } = await setup();
    const brandId = await owner.mutation(api.brands.save, { username: "nike", name: "Nike", bps: 1000, families: [101, 104] });
    await member(t, "Adidas");
    await expect(owner.mutation(api.brands.save, { username: "adidas", name: "Adidas", bps: 800, families: [104] })).rejects.toThrow(
      /already belongs to Nike/u,
    );
    await expect(owner.mutation(api.brands.save, { username: "adidas", name: "Adidas", bps: 6000, families: [105] })).rejects.toThrow(/50%/u);
    await expect(t.withIdentity({ subject: "auth-cam" }).mutation(api.brands.save, { username: "cam", name: "Cam", bps: 1000, families: [106] })).rejects.toThrow();

    await owner.mutation(api.brands.deactivate, { brandId });
    const sale = await owner.mutation(api.orders.simulateSale, { workId: work });
    expect(sale).toMatchObject({ recipients: 1, poolCents: 540 });
    expect(await sales(t, ana)).toEqual([[540, "pending", ["creator"]]]);
    // Stopped, its families are free for another brand.
    await owner.mutation(api.brands.save, { username: "adidas", name: "Adidas", bps: 800, families: [104] });
    const list = await owner.query(api.brands.list, {});
    expect(list.brands.map((brand) => [brand.name, brand.active, brand.families])).toEqual([
      ["Adidas", true, [104]],
      ["Nike", false, [101, 104]],
    ]);
  });
});
