import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { newTest } from "./setup";
import { makeOnSale, makeUser, makeWork, setFlag } from "./shopFixtures";

// Taking a design down (convex/moderation.ts): the plan's admin withdraw (INV-27).

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("taking a design down", () => {
  it("hides it, stops its sale, drafts its Shopify products, and tells its creator why; an admin can put it back up", async () => {
    const t = newTest();
    const creator = await makeUser(t, { authId: "auth-creator", name: "Creator" });
    await t.run((ctx) => ctx.db.patch("users", creator, { username: "maker", usernameLower: "maker" }));
    await makeUser(t, { authId: "owner", platformRole: "super_admin_owner" });
    await makeUser(t, { authId: "member" });
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, title: "Grow Slow" });
    await makeOnSale(t, workId, "101-001");
    await setFlag(t, "commerce.checkout", true);
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).not.toBeNull();

    const owner = t.withIdentity({ subject: "owner" });
    await expect(t.withIdentity({ subject: "member" }).mutation(api.moderation.withdraw, { workId, reason: "No" })).rejects.toThrow();
    await expect(owner.mutation(api.moderation.withdraw, { workId, reason: "   " })).rejects.toThrow(/Say why/u);
    expect(await owner.mutation(api.moderation.withdraw, { workId, reason: "Uses a photo the creator doesn't own." })).toEqual({ cr: "101-001" });

    // Gone from public pages, and off sale.
    expect(await t.query(api.feed.byCr, { cr: "101-001" })).toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
    expect((await t.run((ctx) => ctx.db.query("shopProducts").collect())).map((row) => row.status)).toEqual(["paused"]);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.find((job) => job.name.includes("draftProducts"))?.args[0]).toEqual({ productIds: ["gid://shopify/Product/1000"] });

    // Its creator is told why, without a link to the page that's gone.
    const list = await t.withIdentity({ subject: "auth-creator" }).query(api.notifications.list, { paginationOpts: { numItems: 5, cursor: null } });
    expect(list.page[0]).toMatchObject({ kind: "takedown", takedown: { cr: "101-001", title: "Grow Slow", reason: "Uses a photo the creator doesn't own." } });
    expect(list.page[0].work).toBeUndefined();
    expect(await t.withIdentity({ subject: "auth-creator" }).query(api.notifications.status, {})).toMatchObject({ unread: 1 });

    // Admin, Overview lists it; members can't see that list.
    expect((await owner.query(api.moderation.withdrawn, {})).works).toMatchObject([
      { cr: "101-001", title: "Grow Slow", creator: "maker", reason: "Uses a photo the creator doesn't own." },
    ]);
    await expect(t.withIdentity({ subject: "member" }).query(api.moderation.withdrawn, {})).rejects.toThrow();
    await expect(owner.mutation(api.moderation.withdraw, { workId, reason: "Again" })).rejects.toThrow(/Only a published/u);

    // Put back up: published again, still off sale until an admin approves it.
    expect(await owner.mutation(api.moderation.restore, { workId })).toEqual({ cr: "101-001" });
    expect(await t.query(api.feed.byCr, { cr: "101-001" })).not.toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
    const back = await t.run((ctx) => ctx.db.get("works", workId));
    expect(back).toMatchObject({ status: "published" });
    expect(back?.withdrawReason).toBeUndefined();
  });
});

