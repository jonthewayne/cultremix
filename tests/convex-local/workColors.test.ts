import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { GARMENT_COLORS } from "../../convex/lib/garments";
import { newTest } from "./setup";
import { PRINT_FILE_SHA256, makeOnSale, makeWork } from "./shopFixtures";
import type { Id } from "../../convex/_generated/dataModel";

// Changing a published design's shirt colors from its page (convex/publish.ts setOfferedColors):
// the colors and the lead change, its shop products sell the new colors with the same print file,
// and a new lead color can bring a new model photo.

type T = ReturnType<typeof newTest>;

// Scheduled actions (Shopify, the model photo) never run here: timers stay fake.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function member(t: T, username: string, extra: { platformRole?: "super_admin_owner" } = {}) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      name: username,
      username,
      usernameLower: username.toLowerCase(),
      email: `${username.toLowerCase()}@example.com`,
      authId: `auth-${username.toLowerCase()}`,
      ...extra,
    }),
  );
}

async function scheduled(t: T, name: string) {
  return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes(name));
}

async function setup() {
  const t = newTest();
  const ana = await member(t, "Ana");
  await member(t, "Cam");
  await member(t, "Jon", { platformRole: "super_admin_owner" });
  const workId = await makeWork(t, {
    creatorId: ana,
    family: 101,
    expression: 1,
    printKey: "works/101/001/print-x/print.png",
    offeredColors: ["white", "black"],
  });
  const listingId = await makeOnSale(t, workId, "101-001");
  return {
    t,
    workId,
    listingId,
    ana: t.withIdentity({ subject: "auth-ana" }),
    cam: t.withIdentity({ subject: "auth-cam" }),
    owner: t.withIdentity({ subject: "auth-jon" }),
  };
}

async function listingOf(t: T, listingId: Id<"shopProducts">) {
  return (await t.run((ctx) => ctx.db.get("shopProducts", listingId)))!;
}

describe("changing a published design's shirt colors", () => {
  it("lets its creator pick new colors and a lead, and relists its shop product with the same print file", async () => {
    const { t, workId, listingId, ana } = await setup();
    expect(await ana.query(api.publish.colorSetup, { workId })).toEqual({ colors: ["white", "black"], onSale: true, isOwner: false, canRetake: true });

    const result = await ana.mutation(api.publish.setOfferedColors, { workId, colors: ["true-navy", "white", "ivory"], retakePhoto: false });
    expect(result).toEqual({ colors: ["true-navy", "white", "ivory"], relisted: 1, kept: [], photo: false });
    const work = (await t.run((ctx) => ctx.db.get("works", workId)))!;
    expect(work.offeredColors).toEqual(["true-navy", "white", "ivory"]);
    // The lead is the design's background now: the feed and its page show it on navy.
    expect(work.backgroundColor).toBe(GARMENT_COLORS.find((color) => color.key === "true-navy")!.hex);

    const listing = await listingOf(t, listingId);
    expect(listing.status).toBe("live");
    expect(listing.listing!.colors.map((color) => color.key)).toEqual(["true-navy", "white", "ivory"]);
    expect(listing.printFile!.sha256).toBe(PRINT_FILE_SHA256);
    expect(await scheduled(t, "syncListing")).toHaveLength(1);
    expect(await scheduled(t, "reshoot")).toHaveLength(0);

    // The same colors again change nothing in the shop.
    expect(await ana.mutation(api.publish.setOfferedColors, { workId, colors: ["true-navy", "white", "ivory"] })).toMatchObject({ relisted: 0 });
    expect(await scheduled(t, "syncListing")).toHaveLength(1);
  });

  it("takes a new model photo on a new lead color when asked: the creator's counts against the day's photo shoots", async () => {
    const { t, workId, ana, owner } = await setup();
    expect(await ana.mutation(api.publish.setOfferedColors, { workId, colors: ["black", "white"], retakePhoto: true })).toMatchObject({ photo: true });
    expect((await scheduled(t, "reshoot")).map((job) => job.args[0])).toEqual([{ cr: "101-001", skipLimit: false }]);

    // Same lead, no new photo; the owner's photo doesn't count against anyone's photo shoots.
    expect(await ana.mutation(api.publish.setOfferedColors, { workId, colors: ["black", "ivory"], retakePhoto: true })).toMatchObject({ photo: false });
    expect(await owner.mutation(api.publish.setOfferedColors, { workId, colors: ["ivory", "black"], retakePhoto: true })).toMatchObject({ photo: true });
    expect((await scheduled(t, "reshoot")).map((job) => job.args[0])).toEqual([
      { cr: "101-001", skipLimit: false },
      { cr: "101-001", skipLimit: true },
    ]);
  });

  it("keeps a paused product paused, with the new colors for when it goes back on sale", async () => {
    const { t, workId, listingId, ana } = await setup();
    await t.run((ctx) => ctx.db.patch("shopProducts", listingId, { status: "paused" }));
    expect(await ana.query(api.publish.colorSetup, { workId })).toMatchObject({ onSale: false });
    expect(await ana.mutation(api.publish.setOfferedColors, { workId, colors: ["butter"] })).toMatchObject({ relisted: 0 });
    const listing = await listingOf(t, listingId);
    expect(listing.status).toBe("paused");
    expect(listing.listing!.colors.map((color) => color.key)).toEqual(["butter"]);
    expect(await scheduled(t, "syncListing")).toHaveLength(0);
  });

  it("takes only colors on offer, at least one, from the design's creator or the owner", async () => {
    const { workId, ana, cam, owner } = await setup();
    await expect(ana.mutation(api.publish.setOfferedColors, { workId, colors: ["chartreuse"] })).rejects.toThrow(/swatch board/u);
    await expect(ana.mutation(api.publish.setOfferedColors, { workId, colors: [] })).rejects.toThrow(/at least one/u);
    await expect(cam.mutation(api.publish.setOfferedColors, { workId, colors: ["white"] })).rejects.toThrow(/isn't yours/u);
    expect(await cam.query(api.publish.colorSetup, { workId })).toBeNull();
    expect(await owner.query(api.publish.colorSetup, { workId })).toMatchObject({ isOwner: true });
    expect(await owner.mutation(api.publish.setOfferedColors, { workId, colors: ["moss", "white"] })).toMatchObject({ colors: ["moss", "white"] });
  });
});
