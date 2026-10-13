import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {  addToCart } from "../../src/server/cart";
import { createStorefront } from "../../src/server/storefront";
import { productTitle } from "../../convex/lib/shopify/productSync";
import { GARMENT_KINDS } from "../../shared/config/print-products";
import { newTest } from "./setup";
import { SHOP_ENV, makeOnSale, makeUser, makeWork, setFlag } from "./shopFixtures";
import type {CartContext} from "../../src/server/cart";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof newTest>;

// Scheduled actions (sharp, fal, Shopify) never run here unless a test runs them: timers stay fake.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const OWNER = { subject: "test|owner", issuer: "test" };
const METRICS = { hasAlpha: true, solid: 600_000, visible: 620_000, haze: 1_000 };
const SIZES = ["S", "M", "L", "XL", "2XL"];
const variants = (base: number) => SIZES.map((size, i) => ({ size, id: base + i }));

function fakeShopify() {
  const productSets: Array<{ handle: string; skus: Array<string>; status?: string }> = [];
  const productUpdates: Array<{ id: string; status: string }> = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/admin/oauth/access_token")) return Response.json({ access_token: "tok", expires_in: 86399 });
    const { query, variables } = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: {
        identifier?: { handle: string };
        input?: { status?: string; variants?: Array<{ inventoryItem: { sku: string } }> };
        product?: { id: string; status: string };
      };
    };
    if (query.includes("productUpdate")) {
      productUpdates.push(variables!.product!);
      return Response.json({ data: { productUpdate: { product: variables!.product, userErrors: [] } } });
    }
    if (query.includes("productSet")) {
      // Shopify answers with the variants it was given.
      const skus = (variables?.input?.variants ?? []).map((v) => v.inventoryItem.sku);
      productSets.push({ handle: variables?.identifier?.handle ?? "", skus, status: variables?.input?.status });
      return Response.json({
        data: {
          productSet: {
            product: {
              id: "gid://shopify/Product/77",
              handle: variables?.identifier?.handle,
              variants: { nodes: skus.map((sku, i) => ({ id: `gid://shopify/ProductVariant/${700 + i}`, sku, selectedOptions: [] })) },
            },
            userErrors: [],
          },
        },
      });
    }
    if (query.includes("publications")) return Response.json({ data: { publications: { nodes: [{ id: "gid://shopify/Publication/3", name: "Headless" }] } } });
    return Response.json({ data: { publishablePublish: { userErrors: [] } } });
  });
  return { fetchFake, productSets, productUpdates };
}

// The scheduled jobs whose function name includes name, oldest first.
async function jobs(t: T, name: string) {
  return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) => job.name.includes(name));
}

// The owner, two products on offer (the 1717 tee as the default, and a hoodie that comes in black
// only and prints on the back), and a published work in black and white picked for both: the
// tee with the shared Medium placement, the hoodie with its own big back print.
async function shop() {
  const t = newTest();
  const owner = await t.run((ctx) => ctx.db.insert("users", { name: "Owner", authId: OWNER.subject, platformRole: "super_admin_owner" }));
  const creator = await makeUser(t, { name: "Creator" });
  await t.run(async (ctx) => {
    await ctx.db.insert("merchProducts", {
      provider: "printful",
      productId: 586,
      name: "Unisex Garment-Dyed Heavyweight T-Shirt | Comfort Colors 1717",
      colors: [
        { key: "black", name: "Black", hex: "#1b1b1c", variants: variants(15114), inStock: true, offered: true },
        { key: "white", name: "White", hex: "#ffffff", variants: variants(15124), inStock: true, offered: true },
      ],
      active: true,
      offered: true,
      placements: [
        { id: "front", extraCents: 0 },
        { id: "back", extraCents: 595 },
      ],
      fetchedAt: 0,
    });
    await ctx.db.insert("merchProducts", {
      provider: "printful",
      productId: 146,
      name: "Unisex Heavy Blend Hoodie | Gildan 18500",
      kind: "hoodie",
      colors: [{ key: "black", name: "Black", hex: "#000000", variants: variants(5530), inStock: true, offered: true }],
      active: false,
      offered: true,
      priceCents: 5400,
      largePriceCents: 5800,
      placements: [
        { id: "front", extraCents: 0 },
        { id: "back", extraCents: 595 },
      ],
      fetchedAt: 0,
    });
    await ctx.db.insert("featureFlags", { key: "gen.upscale", enabled: true });
  });
  const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, title: "Grow Slow", offeredColors: ["black", "white"] });
  await t.run((ctx) =>
    ctx.db.patch("works", workId, {
      contentHash: "a".repeat(64),
      printPlacement: { side: "front", size: 0.65, drop: 0.1 },
      printProducts: [{ productId: 586 }, { productId: 146, placement: { side: "back", size: 0.9, drop: 0.05 } }],
    }),
  );
  return { t, owner, creator, workId, admin: t.withIdentity(OWNER) };
}

async function rows(t: T, workId: Id<"works">) {
  return await t.run((ctx) => ctx.db.query("shopProducts").withIndex("by_work", (q) => q.eq("workId", workId)).collect());
}

async function versions(t: T, workId: Id<"works">) {
  return await t.run((ctx) => ctx.db.query("printVersions").withIndex("by_work_number", (q) => q.eq("workId", workId)).collect());
}

const FILE = (versionId: Id<"printVersions">, key: string) => ({
  key,
  sha256: "b".repeat(64),
  widthPx: 3600,
  heightPx: 4800,
  versionId,
  placement: { xIn: 2.43, yIn: 1.5, widthIn: 7.15, heightIn: 7.15 },
  dpi: 573,
  grade: "great" as const,
  warnings: [],
  madeAt: 1,
});

// Approves the work and walks its preparation to the point where both print files exist.
async function approveAndPrepare(t: T, admin: ReturnType<T["withIdentity"]>, workId: Id<"works">) {
  await admin.mutation(api.sales.approve, { workId });
  const [first] = await versions(t, workId);
  await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 1024, height: 1024, metrics: METRICS });
  await t.mutation(internal.sales.advance, { workId });
  const upscale = (await versions(t, workId)).find((version) => version.op === "upscale")!;
  await t.mutation(internal.print.recordVersion, { versionId: upscale._id, key: "fake:up.png", width: 4096, height: 4096, metrics: METRICS });
  await t.mutation(internal.sales.advance, { workId });
  for (const row of await rows(t, workId)) {
    await t.mutation(internal.sales.recordListingFile, { listingId: row._id, file: FILE(upscale._id, `works/101/001/print-${row.productKey === "printful-586" ? "a" : "b"}${"c".repeat(25)}/print.png`) });
  }
  return upscale;
}

describe("approving a work for sale", () => {
  it("lists it on every product its creator picked, each with its placement, price, and colors", async () => {
    const { t, admin, workId } = await shop();
    const result = await admin.mutation(api.sales.approve, { workId });
    expect(result).toEqual({
      products: [
        { name: "Garment-Dyed Heavyweight T-Shirt", status: "preparing", colors: 2 },
        { name: "Heavy Blend Hoodie", status: "preparing", colors: 1 },
      ],
      skipped: [],
    });
    const [tee, hoodie] = (await rows(t, workId)).sort((a, b) => (a.productKey ?? "").localeCompare(b.productKey ?? "")).reverse();
    expect(tee).toMatchObject({ productKey: "printful-586", handle: "cr-101-001-586", status: "preparing" });
    expect(tee.listing).toMatchObject({
      kind: "tee",
      placement: { side: "front", size: 0.65, drop: 0.1 },
      printArea: { widthIn: 12, heightIn: 16 },
      // A product added in Admin without its own prices starts at its kind's ($24 and $26 for a tee).
      priceCents: GARMENT_KINDS.tee.priceCents,
      largePriceCents: GARMENT_KINDS.tee.largePriceCents,
    });
    expect(tee.listing!.colors.map((c) => c.key)).toEqual(["black", "white"]);
    expect(hoodie.listing).toMatchObject({
      kind: "hoodie",
      placement: { side: "back", size: 0.9, drop: 0.05 },
      printArea: { widthIn: 12, heightIn: 16 },
      // The back print's extra: Printful's $5.95, rounded up to a dollar.
      priceCents: 6000,
      largePriceCents: 6400,
    });
    expect(hoodie.listing!.colors.map((c) => c.key)).toEqual(["black"]);
    // Preparing starts by reading the published art.
    expect((await versions(t, workId)).map((version) => [version.number, version.op, version.status])).toEqual([[1, "published", "pending"]]);
  });

  it("is for admins only", async () => {
    const { t, workId } = await shop();
    await expect(t.mutation(api.sales.approve, { workId })).rejects.toThrow();
    await expect(t.withIdentity({ subject: "test|someone", issuer: "test" }).mutation(api.sales.approve, { workId })).rejects.toThrow();
  });

  it("skips a product that carries none of the work's colors", async () => {
    const { t, admin, workId } = await shop();
    await t.run((ctx) => ctx.db.patch("works", workId, { offeredColors: ["white"] }));
    const result = await admin.mutation(api.sales.approve, { workId });
    expect(result.products.map((p) => p.name)).toEqual(["Garment-Dyed Heavyweight T-Shirt"]);
    expect(result.skipped).toEqual(["Heavy Blend Hoodie"]);
    expect(await rows(t, workId)).toHaveLength(1);
  });

  it("makes print-size art, then a print file per product, then sends each to Shopify", async () => {
    const { t, admin, workId } = await shop();
    await admin.mutation(api.sales.approve, { workId });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 1024, height: 1024, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    // An upscale of the art, at no credit cost.
    const upscale = (await versions(t, workId)).find((version) => version.op === "upscale")!;
    expect(upscale).toMatchObject({ parentId: first._id, status: "pending", charged: 0 });
    expect((await admin.query(api.sales.list, {})).page[0].step).toBe("Upscaling for print");

    await t.mutation(internal.print.recordVersion, { versionId: upscale._id, key: "fake:up.png", width: 4096, height: 4096, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    expect((await rows(t, workId)).every((row) => row.renderStartedAt !== undefined)).toBe(true);
    // The print file run gets each product's placement and print area.
    const job = await t.query(internal.sales.renderJob, { workId, versionId: upscale._id, listingIds: (await rows(t, workId)).map((row) => row._id) });
    expect(job?.version).toMatchObject({ key: "fake:up.png", width: 4096 });
    expect(job?.listings.map((listing) => [listing.productKey, listing.placement.side, listing.printArea])).toEqual([
      ["printful-586", "front", { widthIn: 12, heightIn: 16 }],
      ["printful-146", "back", { widthIn: 12, heightIn: 16 }],
    ]);
    // A second nudge while it runs starts nothing new.
    await t.mutation(internal.sales.advance, { workId });

    for (const row of await rows(t, workId)) {
      await t.mutation(internal.sales.recordListingFile, { listingId: row._id, file: FILE(upscale._id, "works/101/001/print-" + "a".repeat(26) + "/print.png") });
    }
    for (const row of await rows(t, workId)) {
      expect(row).toMatchObject({ status: "pending", attempts: 0 });
      expect(row.printFile?.versionId).toBe(upscale._id);
    }
  });

  it("uses the Print Studio's placement for the product it was placed on", async () => {
    const { t, admin, workId, creator } = await shop();
    await admin.mutation(api.sales.approve, { workId });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 3000, height: 3000, metrics: METRICS });
    await t.run((ctx) =>
      ctx.db.insert("printPlacements", { workId, versionId: first._id, xIn: 1, yIn: 2, widthIn: 8, color: "Black", updatedBy: creator, updatedAt: Date.now() }),
    );
    const job = await t.query(internal.sales.renderJob, { workId, versionId: first._id, listingIds: (await rows(t, workId)).map((row) => row._id) });
    // The tee's front gets the Print Studio's inches; the hoodie's back keeps its own placement.
    expect(job?.listings.map((listing) => listing.studio)).toEqual([{ xIn: 1, yIn: 2, widthIn: 8 }, undefined]);
  });

  it("uses large art as it is", async () => {
    const { t, admin, workId } = await shop();
    await admin.mutation(api.sales.approve, { workId });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 3000, height: 3000, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    expect((await versions(t, workId)).some((version) => version.op === "upscale")).toBe(false);
    expect((await rows(t, workId)).every((row) => row.renderStartedAt !== undefined)).toBe(true);
  });

  it("stops with a plain reason when print-size art is off, and starts again when approved again", async () => {
    const { t, admin, workId } = await shop();
    await setFlag(t, "gen.upscale", false);
    await admin.mutation(api.sales.approve, { workId });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 1024, height: 1024, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    expect((await rows(t, workId)).map((row) => row.prepError)).toEqual([
      "Turn on Print-size art in Admin, then approve again.",
      "Turn on Print-size art in Admin, then approve again.",
    ]);
    await setFlag(t, "gen.upscale", true);
    await admin.mutation(api.sales.approve, { workId });
    expect((await rows(t, workId)).every((row) => row.prepError === undefined)).toBe(true);
    expect((await versions(t, workId)).some((version) => version.op === "upscale" && version.status === "pending")).toBe(true);
  });

  it("holds a product whose print file failed until it's approved again", async () => {
    const { t, admin, workId } = await shop();
    await admin.mutation(api.sales.approve, { workId });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 3000, height: 3000, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    const [tee, hoodie] = await rows(t, workId);
    await t.mutation(internal.sales.failListingFile, { listingId: hoodie._id, error: "Too small to print well at that size." });
    await t.mutation(internal.sales.recordListingFile, { listingId: tee._id, file: FILE(first._id, "works/101/001/print-" + "d".repeat(26) + "/print.png") });
    const after = await rows(t, workId);
    expect(after.find((row) => row._id === tee._id)?.status).toBe("pending");
    expect(after.find((row) => row._id === hoodie._id)).toMatchObject({
      status: "preparing",
      prepError: "The print file failed: Too small to print well at that size.",
    });
    expect(after.find((row) => row._id === hoodie._id)?.renderStartedAt).toBeUndefined();
    // Another nudge doesn't retry it.
    await t.mutation(internal.sales.advance, { workId });
    expect((await rows(t, workId)).find((row) => row._id === hoodie._id)?.renderStartedAt).toBeUndefined();
    await admin.mutation(api.sales.approve, { workId });
    expect((await rows(t, workId)).find((row) => row._id === hoodie._id)?.renderStartedAt).toBeDefined();
  });

  it("keeps a print file when approved again unchanged, and makes a new one when the placement changed", async () => {
    const { t, admin, workId } = await shop();
    await approveAndPrepare(t, admin, workId);
    expect((await admin.mutation(api.sales.approve, { workId })).products.map((p) => p.status)).toEqual(["pending", "pending"]);
    await t.run((ctx) => ctx.db.patch("works", workId, { printPlacement: { side: "front", size: 0.4, drop: 0 } }));
    // The tee follows the shared placement; the hoodie has its own.
    expect((await admin.mutation(api.sales.approve, { workId })).products.map((p) => p.status)).toEqual(["preparing", "pending"]);
    const tee = (await rows(t, workId)).find((row) => row.productKey === "printful-586");
    expect(tee?.printFile).toBeUndefined();
  });

  it("gives a back print's chest mark its own file on the front, and lists it once both are made", async () => {
    const { t, admin, workId } = await shop();
    const markOn = (mark: number) =>
      t.run((ctx) =>
        ctx.db.patch("works", workId, { printProducts: [{ productId: 586 }, { productId: 146, placement: { side: "back", size: 0.9, drop: 0.05, mark } }] }),
      );
    await markOn(3);
    await admin.mutation(api.sales.approve, { workId });
    const hoodieId = (await rows(t, workId)).find((row) => row.productKey === "printful-146")!._id;
    const hoodie = async () => (await rows(t, workId)).find((row) => row._id === hoodieId)!;
    // The mark goes on the hoodie's front print area (its kind's 14 x 14 in), at the back print's price.
    expect((await hoodie()).listing).toMatchObject({
      placement: { side: "back", size: 0.9, drop: 0.05, mark: 3 },
      printArea: { widthIn: 12, heightIn: 16 },
      markArea: { widthIn: 14, heightIn: 14 },
      priceCents: 6000,
    });
    const [first] = await versions(t, workId);
    await t.mutation(internal.print.recordVersion, { versionId: first._id, key: "fake:art.png", width: 3000, height: 3000, metrics: METRICS });
    await t.mutation(internal.sales.advance, { workId });
    const job = await t.query(internal.sales.renderJob, { workId, versionId: first._id, listingIds: (await rows(t, workId)).map((row) => row._id) });
    expect(job?.listings.map((listing) => listing.markArea)).toEqual([undefined, { widthIn: 14, heightIn: 14 }]);

    // Its print file alone isn't enough to list it.
    await t.mutation(internal.sales.recordListingFile, { listingId: hoodieId, file: FILE(first._id, "works/101/001/print-" + "e".repeat(26) + "/print.png") });
    expect((await hoodie()).status).toBe("preparing");
    await t.mutation(internal.sales.recordListingFile, {
      listingId: hoodieId,
      file: FILE(first._id, "works/101/001/print-" + "f".repeat(26) + "/print.png"),
      markFile: FILE(first._id, "works/101/001/print-" + "g".repeat(26) + "/print.png"),
    });
    expect(await hoodie()).toMatchObject({ status: "pending", markFile: { key: "works/101/001/print-" + "g".repeat(26) + "/print.png" } });
    const listed = (await admin.query(api.sales.list, {})).page[0].listings.find((listing) => listing.productKey === "printful-146");
    expect(listed?.markFile).toMatchObject({ widthIn: 7.15, dpi: 573 });

    // Approved again unchanged, both files stay; a bigger mark makes both again.
    expect((await admin.mutation(api.sales.approve, { workId })).products.map((p) => p.status)).toEqual(["preparing", "pending"]);
    await markOn(4);
    await admin.mutation(api.sales.approve, { workId });
    const remade = await hoodie();
    expect(remade.status).toBe("preparing");
    expect(remade.printFile).toBeUndefined();
    expect(remade.markFile).toBeUndefined();
  });
});

describe("changing what it comes on and where it sits after publishing", () => {
  it("is its creator's to change, and the admin list asks for approval again", async () => {
    const { t, admin, workId, creator } = await shop();
    const CREATOR = { subject: "test|creator", issuer: "test" };
    await t.run((ctx) => ctx.db.patch("users", creator, { authId: CREATOR.subject, username: "maker", usernameLower: "maker" }));
    const someone = { subject: "test|someone", issuer: "test" };
    await t.run((ctx) => ctx.db.insert("users", { name: "Someone", authId: someone.subject, username: "someone", usernameLower: "someone" }));

    expect(await t.withIdentity(CREATOR).query(api.publish.printSetup, { workId })).toEqual({
      printPlacement: { side: "front", size: 0.65, drop: 0.1 },
      printProducts: [{ productId: 586 }, { productId: 146, placement: { side: "back", size: 0.9, drop: 0.05 } }],
      onSale: false,
      chestMarks: false,
    });
    expect(await t.withIdentity(someone).query(api.publish.printSetup, { workId })).toBeNull();
    await expect(
      t.withIdentity(someone).mutation(api.publish.setPrintSetup, { workId, printPlacement: { side: "front", size: 0.4, drop: 0 }, printProducts: [{ productId: 586 }] }),
    ).rejects.toThrow(/isn't yours/u);

    await approveAndPrepare(t, admin, workId);
    expect((await admin.query(api.sales.list, {})).page[0].changed).toBe(false);
    // Smaller on the tee, the hoodie dropped, and a product that isn't on offer ignored.
    await t.withIdentity(CREATOR).mutation(api.publish.setPrintSetup, {
      workId,
      printPlacement: { side: "front", size: 0.4, drop: 9 },
      printProducts: [{ productId: 586 }, { productId: 999 }],
    });
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work).toMatchObject({ printPlacement: { side: "front", size: 0.4, drop: 1 }, printProducts: [{ productId: 586 }] });
    expect((await admin.query(api.sales.list, {})).page[0].changed).toBe(true);
    await expect(
      t.withIdentity(CREATOR).mutation(api.publish.setPrintSetup, { workId, printPlacement: { side: "front", size: 0.4, drop: 0 }, printProducts: [{ productId: 999 }] }),
    ).rejects.toThrow(/at least one product/u);
  });

  it("adds a chest mark only while the Chest marks switch is on, and keeps one already chosen", async () => {
    const { t, workId, creator } = await shop();
    const CREATOR = { subject: "test|creator", issuer: "test" };
    await t.run((ctx) => ctx.db.patch("users", creator, { authId: CREATOR.subject, username: "maker", usernameLower: "maker" }));
    const me = t.withIdentity(CREATOR);
    const save = (mark: number) =>
      me.mutation(api.publish.setPrintSetup, {
        workId,
        printPlacement: { side: "front", size: 0.65, drop: 0.1 },
        printProducts: [{ productId: 586 }, { productId: 146, placement: { side: "back", size: 0.9, drop: 0.05, mark } }],
      });
    const hoodieMark = async () => (await t.run((ctx) => ctx.db.get("works", workId)))!.printProducts!.find((pick) => pick.productId === 146)!.placement!.mark;

    // Off (as it starts): no mark is added.
    await save(3);
    expect(await hoodieMark()).toBeUndefined();
    await setFlag(t, "print.chestMarks", true);
    expect((await me.query(api.publish.printSetup, { workId }))?.chestMarks).toBe(true);
    await save(3);
    expect(await hoodieMark()).toBe(3);
    // Off again: the mark it has stays when saved as it is, but can't change.
    await setFlag(t, "print.chestMarks", false);
    await save(3);
    expect(await hoodieMark()).toBe(3);
    await save(4);
    expect(await hoodieMark()).toBeUndefined();
    // A front print never keeps one.
    await setFlag(t, "print.chestMarks", true);
    await me.mutation(api.publish.setPrintSetup, {
      workId,
      printPlacement: { side: "front", size: 0.65, drop: 0.1, mark: 3 },
      printProducts: [{ productId: 586 }],
    });
    expect((await t.run((ctx) => ctx.db.get("works", workId)))!.printPlacement).toEqual({ side: "front", size: 0.65, drop: 0.1 });
  });
});

describe("selling it", () => {
  async function live(t: T, admin: ReturnType<T["withIdentity"]>, workId: Id<"works">) {
    await approveAndPrepare(t, admin, workId);
    for (const row of await rows(t, workId)) {
      const sold = row.listing!.colors.flatMap((color) =>
        color.variants.map((variant, i) => ({
          color: color.code,
          size: variant.size,
          sku: `CR-101-001-${row.listing!.printfulProductId}-${color.code}-${variant.size}`,
          priceCents: variant.size === "2XL" ? row.listing!.largePriceCents : row.listing!.priceCents,
          printfulVariantId: variant.id,
          shopifyVariantId: `gid://shopify/ProductVariant/${row.listing!.printfulProductId}${color.code}${i}`,
        })),
      );
      await t.mutation(internal.shopify.saveSynced, { listingId: row._id, productId: `gid://shopify/Product/${row.listing!.printfulProductId}`, variants: sold });
    }
  }

  it("offers each live product with its colors, sizes, prices, and side once checkout is on", async () => {
    const { t, admin, workId } = await shop();
    await live(t, admin, workId);
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
    await setFlag(t, "commerce.checkout", true);
    const offer = await t.query(api.shopify.offer, { cr: "101-001" });
    expect(offer?.products.map((p) => [p.key, p.side, p.colors.map((c) => c.key), p.sizes.length])).toEqual([
      ["printful-586", "front", ["black", "white"], 5],
      ["printful-146", "back", ["black"], 5],
    ]);
    const hoodie = offer!.products[1];
    expect(hoodie.variants.find((v) => v.size === "2XL")?.priceCents).toBe(6400);
    expect(hoodie.variants.find((v) => v.size === "M")?.priceCents).toBe(6000);
    // Each variant maps back to its listing.
    const mapped = await t.run((ctx) => ctx.db.query("workVariants").collect());
    expect(mapped).toHaveLength(15);
    expect(mapped.every((row) => row.listingId && row.productKey)).toBe(true);
  });

  it("drafts a paused product in Shopify, so an old cart can't buy it", async () => {
    const { t, admin, workId } = await shop();
    await live(t, admin, workId);
    const [row] = await rows(t, workId);
    await admin.mutation(api.sales.pause, { workId, productKey: row.productKey });
    expect((await jobs(t, "draftProducts")).map((job) => job.args[0])).toEqual([{ productIds: [row.shopifyProductId] }]);
  });

  it("takes one product off sale and puts it back", async () => {
    const { t, admin, workId } = await shop();
    await live(t, admin, workId);
    await setFlag(t, "commerce.checkout", true);
    await admin.mutation(api.sales.pause, { workId, productKey: "printful-146" });
    expect((await t.query(api.shopify.offer, { cr: "101-001" }))?.products.map((p) => p.key)).toEqual(["printful-586"]);
    await admin.mutation(api.sales.resume, { workId, productKey: "printful-146" });
    // Back on sale once it syncs again.
    expect((await rows(t, workId)).find((row) => row.productKey === "printful-146")?.status).toBe("pending");
  });

  it("refuses at checkout a product or color the work isn't sold in", async () => {
    const { t, admin, workId } = await shop();
    await live(t, admin, workId);
    await setFlag(t, "commerce.checkout", true);
    const shopifyCalls: Array<string> = [];
    const ctx: CartContext = {
      cookieHeader: null,
      buyerIp: null,
      secure: true,
      storefront: createStorefront({
        config: { shopDomain: "cultremix-dev.myshopify.com", privateToken: "private" },
        fetch: async (_input, init) => {
          shopifyCalls.push(String(init?.body));
          return new Response("down", { status: 503 });
        },
      }),
      lookupOffer: (cr) => t.query(api.shopify.offer, { cr }),
    };
    // The hoodie only comes in black.
    await expect(addToCart(ctx, { cr: "101-001", product: "printful-146", color: "WHITE", size: "M", quantity: 1 })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(addToCart(ctx, { cr: "101-001", product: "printful-71", color: "BLACK", size: "M", quantity: 1 })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(shopifyCalls).toHaveLength(0);
    // Black on the hoodie is sold, so the add reaches Shopify (which is down here).
    await expect(addToCart(ctx, { cr: "101-001", product: "printful-146", color: "BLACK", size: "M", quantity: 1 })).rejects.toBeTruthy();
    expect(shopifyCalls).toHaveLength(1);
  });

  it("offers only the listing's colors even when older variant rows remain", async () => {
    const t = newTest();
    await setFlag(t, "commerce.checkout", true);
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, offeredColors: ["black"] });
    const listingId = await makeOnSale(t, workId, "101-001");
    // A row kept from an earlier sync, so old orders still resolve. It isn't for sale.
    await t.run((ctx) =>
      ctx.db.insert("workVariants", {
        workId,
        listingId,
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        sku: "CR-101-001-586-WHITE-M",
        color: "WHITE",
        size: "M",
        priceCents: 3600,
      }),
    );
    const [product] = (await t.query(api.shopify.offer, { cr: "101-001" }))!.products;
    expect(product.colors.map((c) => c.key)).toEqual(["black"]);
    expect(product.variants).toHaveLength(5);
    expect(product.variants.every((v) => v.color === "BLACK")).toBe(true);
  });

  it("offers nothing while checkout is off, even for a work on sale", async () => {
    const t = newTest();
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1 });
    await makeOnSale(t, workId, "101-001");
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).toBeNull();
    await setFlag(t, "commerce.checkout", true);
    expect(await t.query(api.shopify.offer, { cr: "101-001" })).not.toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "101-002" })).toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "nope" })).toBeNull();
  });
});

describe("a kept design, printed for its creator alone", () => {
  const CREATOR = { subject: "test|creator", issuer: "test" };
  const SOMEONE = { subject: "test|someone", issuer: "test" };

  // The shop's work, kept just for its creator instead of published: family 0, never shown.
  async function keptShop() {
    const setup = await shop();
    await setup.t.run(async (ctx) => {
      await ctx.db.patch("users", setup.creator, { authId: CREATOR.subject, username: "maker", usernameLower: "maker" });
      await ctx.db.insert("users", { name: "Someone", authId: SOMEONE.subject, username: "someone", usernameLower: "someone" });
      await ctx.db.patch("works", setup.workId, { status: "private", keep: "private", crFamily: 0, crExpression: 1 });
    });
    return setup;
  }

  it("waits for its creator to ask, then shows in Admin, For sale", async () => {
    const { t, admin, workId } = await keptShop();
    const creator = t.withIdentity(CREATOR);
    expect(await admin.query(api.sales.keptRequests, {})).toEqual([]);
    expect((await creator.query(api.keeps.get, { workId }))?.ordering).toBe("ask");
    await expect(t.withIdentity(SOMEONE).mutation(api.keeps.requestPrint, { workId })).rejects.toThrow(/creator/u);
    await creator.mutation(api.keeps.requestPrint, { workId });
    expect((await creator.query(api.keeps.get, { workId }))?.ordering).toBe("requested");
    const requests = await admin.query(api.sales.keptRequests, {});
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ workId, kept: true, creator: "maker" });
    expect(requests[0].requestedAt).toBeGreaterThan(0);
    // It isn't one of the published works, and members can't see the requests.
    expect((await admin.query(api.sales.list, {})).page).toEqual([]);
    await expect(creator.query(api.sales.keptRequests, {})).rejects.toThrow();
  });

  it("can't be printed once the design it remixes is taken down", async () => {
    const { t, admin, workId } = await keptShop();
    const creator = t.withIdentity(CREATOR);
    // The design it remixes, taken down after it was kept.
    const original = await t.run(async (ctx) => {
      const { _id, _creationTime, keep, ...fields } = (await ctx.db.get("works", workId))!;
      const originalId = await ctx.db.insert("works", { ...fields, status: "withdrawn", crFamily: 105, crExpression: 1, withdrawReason: "Not ours to sell." });
      await ctx.db.patch("works", workId, { parentWorkId: originalId });
      return originalId;
    });
    expect(await creator.query(api.keeps.get, { workId })).toMatchObject({ parentWithdrawn: true, ordering: "ask", parent: { cr: "105-001" } });
    await expect(creator.mutation(api.keeps.requestPrint, { workId })).rejects.toThrow(/was taken down, so this one can't be printed/u);

    // One asked for before the takedown says why in Admin, For sale, and can't be approved.
    await t.run((ctx) => ctx.db.patch("works", workId, { printRequestedAt: Date.now() }));
    expect(await admin.query(api.sales.keptRequests, {})).toEqual([expect.objectContaining({ workId, parentWithdrawn: "105-001" })]);
    await expect(admin.mutation(api.sales.approve, { workId })).rejects.toThrow(/Its original, CR 105-001, was taken down/u);

    // Put back up, it can be asked for again.
    await t.run((ctx) => ctx.db.patch("works", original, { status: "published" }));
    expect((await admin.query(api.sales.keptRequests, {}))[0].parentWithdrawn).toBeUndefined();
    expect((await creator.query(api.keeps.get, { workId }))?.parentWithdrawn).toBe(false);
    await creator.mutation(api.keeps.requestPrint, { workId });
  });

  it("is prepared like a published work and offered to its creator alone", async () => {
    const { t, admin, workId } = await keptShop();
    const creator = t.withIdentity(CREATOR);
    await creator.mutation(api.keeps.requestPrint, { workId });
    await approveAndPrepare(t, admin, workId);
    expect((await creator.query(api.keeps.get, { workId }))?.ordering).toBe("preparing");
    const listings = await rows(t, workId);
    // Its handle is its work's ID, which nobody can guess, rather than its family-0 number.
    expect(listings.map((row) => row.handle).sort()).toEqual([`kept-${workId}-146`, `kept-${workId}-586`]);
    // Its Shopify product is named for what it is; it has no public number.
    const job = await t.query(internal.shopify.listingForSync, { listingId: listings[0]._id });
    expect(job).toMatchObject({ kept: true, cr: "000-001" });
    expect(productTitle(job!.cr, "Grow Slow", job!.listing.name, job!.kept)).toMatch(/^Kept design · Grow Slow · /u);

    for (const row of listings) {
      const sold = row.listing!.colors.flatMap((color) =>
        color.variants.map((variant, i) => ({
          color: color.code,
          size: variant.size,
          sku: `CR-000-001-${row.listing!.printfulProductId}-${color.code}-${variant.size}`,
          priceCents: row.listing!.priceCents,
          printfulVariantId: variant.id,
          shopifyVariantId: `gid://shopify/ProductVariant/${row.listing!.printfulProductId}${color.code}${i}`,
        })),
      );
      await t.mutation(internal.shopify.saveSynced, { listingId: row._id, productId: `gid://shopify/Product/${row.listing!.printfulProductId}`, variants: sold });
    }
    expect((await creator.query(api.keeps.get, { workId }))?.ordering).toBe("ready");
    expect(await creator.query(api.shopify.keptOffer, { workId })).toBeNull();
    // Its creator hears once that it's ready, with a link to its private page, however many
    // products came back.
    const bell = await creator.query(api.notifications.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(bell.page.filter((item) => item.kind === "kept_ready")).toMatchObject([{ kept: { workId, title: "Grow Slow" } }]);
    expect(bell.page.find((item) => item.kind === "kept_ready")?.work).toBeUndefined();
    expect(await t.withIdentity(SOMEONE).query(api.notifications.list, { paginationOpts: { numItems: 10, cursor: null } })).toMatchObject({ page: [] });

    await setFlag(t, "commerce.checkout", true);
    const offer = await creator.query(api.shopify.keptOffer, { workId });
    expect(offer?.products.map((p) => p.key)).toEqual(["printful-586", "printful-146"]);
    expect(await t.withIdentity(SOMEONE).query(api.shopify.keptOffer, { workId })).toBeNull();
    expect(await t.query(api.shopify.keptOffer, { workId })).toBeNull();
    expect(await t.query(api.shopify.offer, { cr: "000-001" })).toBeNull();

    // The cart asks for it by id as the signed-in member: its creator's add reaches Shopify (down
    // here); anyone else's is refused before Shopify hears of it.
    const shopifyCalls: Array<string> = [];
    const cart = (identity: typeof CREATOR): CartContext => ({
      cookieHeader: null,
      buyerIp: null,
      secure: true,
      storefront: createStorefront({
        config: { shopDomain: "cultremix-dev.myshopify.com", privateToken: "private" },
        fetch: async (_input, init) => {
          shopifyCalls.push(String(init?.body));
          return new Response("down", { status: 503 });
        },
      }),
      lookupOffer: async () => null,
      lookupKeptOffer: (id) => t.withIdentity(identity).query(api.shopify.keptOffer, { workId: id as Id<"works"> }),
    });
    const line = { keep: workId, product: "printful-146", color: "BLACK", size: "M", quantity: 1 };
    await expect(addToCart(cart(SOMEONE), line)).rejects.toMatchObject({ code: "CLOSED" });
    expect(shopifyCalls).toHaveLength(0);
    await expect(addToCart(cart(CREATOR), line)).rejects.toBeTruthy();
    expect(shopifyCalls).toHaveLength(1);
  });

  // Each listing's Shopify variants as saveSynced takes them, with SKUs under the given number.
  async function synced(t: T, workId: Id<"works">, cr: string, product: string) {
    for (const row of await rows(t, workId)) {
      const pid = row.listing!.printfulProductId;
      const sold = row.listing!.colors.flatMap((color) =>
        color.variants.map((variant, i) => ({
          color: color.code,
          size: variant.size,
          sku: `CR-${cr}-${pid}-${color.code}-${variant.size}`,
          priceCents: row.listing!.priceCents,
          printfulVariantId: variant.id,
          shopifyVariantId: `gid://shopify/ProductVariant/${product}${pid}${color.code}${i}`,
        })),
      );
      await t.mutation(internal.shopify.saveSynced, { listingId: row._id, productId: `gid://shopify/Product/${product}${pid}`, variants: sold });
    }
  }

  it("comes off sale when its creator shares it, and sells again only under its public number", async () => {
    const { t, admin, workId } = await keptShop();
    const creator = t.withIdentity(CREATOR);
    await setFlag(t, "commerce.checkout", true);
    await setFlag(t, "publishing", true);
    await creator.mutation(api.keeps.requestPrint, { workId });
    await approveAndPrepare(t, admin, workId);
    await synced(t, workId, "000-001", "kept");
    expect(await creator.query(api.shopify.keptOffer, { workId })).not.toBeNull();

    const { cr } = await creator.mutation(api.publish.shareKeep, { workId });
    // Its kept products come off sale, and their handles become the public number's.
    const paused = await rows(t, workId);
    expect(paused.map((row) => row.status)).toEqual(["paused", "paused"]);
    expect(paused.every((row) => row.shopifyProductId === undefined)).toBe(true);
    expect(paused.map((row) => row.handle).sort()).toEqual([`cr-${cr}-146`, `cr-${cr}-586`]);
    expect(await creator.query(api.shopify.keptOffer, { workId })).toBeNull();
    // Shopify archives the kept products.
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const archive = jobs.find((job) => job.name.includes("archiveProducts"));
    expect((archive?.args[0] as { productIds: Array<string> }).productIds.sort()).toEqual([
      "gid://shopify/Product/kept146",
      "gid://shopify/Product/kept586",
    ]);

    // Once published, nothing sells until an admin resumes it; then only the public product's
    // variants are offered, never the kept product's, though their rows stay for old orders.
    await t.run((ctx) => ctx.db.patch("works", workId, { status: "published" }));
    expect(await t.query(api.shopify.offer, { cr })).toBeNull();
    await admin.mutation(api.sales.resume, { workId });
    await synced(t, workId, cr, "public");
    const offer = await t.query(api.shopify.offer, { cr });
    const sold = offer!.products.flatMap((product) => product.variants.map((variant) => variant.merchandiseId));
    expect(sold.length).toBeGreaterThan(0);
    expect(sold.every((id) => id.includes("/public"))).toBe(true);
    const all = await t.run((ctx) => ctx.db.query("workVariants").withIndex("by_work", (q) => q.eq("workId", workId)).collect());
    expect(all.some((variant) => variant.shopifyVariantId.includes("/kept"))).toBe(true);
  });

  it("archives a kept product whose sync finishes after its creator shared it", async () => {
    const { t, admin, workId } = await keptShop();
    const creator = t.withIdentity(CREATOR);
    await setFlag(t, "publishing", true);
    await creator.mutation(api.keeps.requestPrint, { workId });
    await approveAndPrepare(t, admin, workId);
    // Shared while its first sync is still running.
    await creator.mutation(api.publish.shareKeep, { workId });
    const [row] = await rows(t, workId);
    await t.mutation(internal.shopify.saveSynced, { listingId: row._id, productId: "gid://shopify/Product/late", variants: [], kept: true });
    // The listing waits under its public number without the kept product, and Shopify archives it.
    const after = await t.run((ctx) => ctx.db.get("shopProducts", row._id));
    expect(after?.status).toBe("paused");
    expect(after?.shopifyProductId).toBeUndefined();
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("archiveProducts")).map((job) => job.args[0])).toContainEqual({
      productIds: ["gid://shopify/Product/late"],
    });
  });

  it("is unlisted, not active, while checkout is open, and a draft while it's closed", async () => {
    const { t, admin, workId } = await keptShop();
    await t.withIdentity(CREATOR).mutation(api.keeps.requestPrint, { workId });
    await approveAndPrepare(t, admin, workId);
    await synced(t, workId, "000-001", "kept");
    const listingIds = (await rows(t, workId)).map((row) => row._id);
    await setFlag(t, "commerce.checkout", true);
    expect((await t.query(internal.shopify.wantedStatuses, { listingIds })).map((item) => item.status)).toEqual(["UNLISTED", "UNLISTED"]);
    await setFlag(t, "commerce.checkout", false);
    expect((await t.query(internal.shopify.wantedStatuses, { listingIds })).map((item) => item.status)).toEqual(["DRAFT", "DRAFT"]);
  });
});

describe("Shopify product sync", () => {
  async function pending(t: T) {
    const creator = await makeUser(t);
    const workId = await makeWork(t, { creatorId: creator, family: 101, expression: 1, title: "Night Swim", printKey: "works/101/001/print-x/print.png" });
    const listingId = await makeOnSale(t, workId, "101-001");
    await t.run(async (ctx) => {
      await ctx.db.patch("shopProducts", listingId, { status: "pending", shopifyProductId: undefined, syncedAt: undefined });
      for (const row of await ctx.db.query("workVariants").collect()) await ctx.db.delete("workVariants", row._id);
    });
    return { workId, listingId };
  }

  it("creates one product per listing by its handle and maps every variant back", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, productSets } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    const { listingId } = await pending(t);
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("live");
    expect(productSets).toHaveLength(1);
    expect(productSets[0].handle).toBe("cr-101-001-586");
    expect(productSets[0].skus[0]).toBe("CR-101-001-586-WHITE-S");
    expect(productSets[0].skus).toHaveLength(20);
    const row = await t.run((ctx) => ctx.db.get("shopProducts", listingId));
    expect(row).toMatchObject({ status: "live", shopifyProductId: "gid://shopify/Product/77" });
    const mapped = await t.run((ctx) => ctx.db.query("workVariants").collect());
    expect(mapped).toHaveLength(20);
    expect(mapped.every((variant) => variant.listingId === listingId && variant.productKey === "printful-586")).toBe(true);
    expect(mapped.find((variant) => variant.sku === "CR-101-001-586-BLACK-2XL")).toMatchObject({ priceCents: 3900, printfulVariantId: 15118 });
  });

  it("waits without counting attempts while Shopify is not configured", async () => {
    const t = newTest();
    const { listingId } = await pending(t);
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("skipped");
    const row = await t.run((ctx) => ctx.db.get("shopProducts", listingId));
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: "Shopify is not configured yet." });
  });

  it("backs off after a Shopify failure", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("access_token") ? Response.json({ access_token: "tok", expires_in: 86399 }) : new Response("down", { status: 503 }),
    );
    const { listingId } = await pending(t);
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("failed");
    const row = await t.run((ctx) => ctx.db.get("shopProducts", listingId));
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row!.nextAttemptAt!).toBeGreaterThan(Date.now());
  });

  it("skips a paused listing and one still being prepared", async () => {
    const t = newTest();
    const { listingId } = await pending(t);
    await t.run((ctx) => ctx.db.patch("shopProducts", listingId, { status: "paused" }));
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("skipped");
    await t.run((ctx) => ctx.db.patch("shopProducts", listingId, { status: "preparing" }));
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("skipped");
  });

  it("keeps products as drafts while checkout is off, and makes them sellable while it's on", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, productSets, productUpdates } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    await t.run((ctx) => ctx.db.insert("users", { name: "Owner", authId: OWNER.subject, platformRole: "super_admin_owner" }));
    const owner = t.withIdentity(OWNER);
    const { listingId } = await pending(t);
    // Checkout is off: Shopify makes a draft, which nothing can buy.
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("live");
    expect(productSets[0].status).toBe("DRAFT");

    // On: every live listing's product becomes active, and a sync from now on makes it active.
    await owner.mutation(api.admin.setFlag, { key: "commerce.checkout", enabled: true });
    const [on] = await jobs(t, "applyCheckout");
    expect(on.args[0]).toEqual({ open: true, cursor: null });
    await t.action(internal.shopify.applyCheckout, { open: true, cursor: null });
    expect(productUpdates).toEqual([{ id: "gid://shopify/Product/77", status: "ACTIVE" }]);
    await t.run((ctx) => ctx.db.patch("shopProducts", listingId, { status: "pending" }));
    expect(await t.action(internal.shopify.syncListing, { listingId })).toBe("live");
    expect(productSets[1].status).toBe("ACTIVE");

    // Off: drafts again, so even a cart made while it was on can't check out. The same value again
    // starts nothing, and a run from an earlier turn of the switch changes nothing.
    await owner.mutation(api.admin.setFlag, { key: "commerce.checkout", enabled: false });
    await owner.mutation(api.admin.setFlag, { key: "commerce.checkout", enabled: false });
    expect((await jobs(t, "applyCheckout")).map((job) => job.args[0])).toEqual([
      { open: true, cursor: null },
      { open: false, cursor: null },
    ]);
    await t.action(internal.shopify.applyCheckout, { open: true, cursor: null });
    expect(productUpdates).toHaveLength(1);
    await t.action(internal.shopify.applyCheckout, { open: false, cursor: null });
    expect(productUpdates.at(-1)).toEqual({ id: "gid://shopify/Product/77", status: "DRAFT" });
  });

  it("gives Shopify what checkout says now when a sync from before the switch turned saves", async () => {
    const t = newTest();
    for (const [key, value] of Object.entries(SHOP_ENV)) vi.stubEnv(key, value);
    const { fetchFake, productUpdates } = fakeShopify();
    vi.stubGlobal("fetch", fetchFake);
    const { listingId } = await pending(t);
    await setFlag(t, "commerce.checkout", true);
    // It started while checkout was off, so Shopify made a draft; checkout is on now.
    await t.mutation(internal.shopify.saveSynced, { listingId, productId: "gid://shopify/Product/77", variants: [], status: "DRAFT" });
    const [job] = await jobs(t, "applyStatus");
    expect(job.args[0]).toEqual({ listingIds: [listingId], attempt: 0 });
    await t.action(internal.shopify.applyStatus, { listingIds: [listingId], attempt: 0 });
    expect(productUpdates).toEqual([{ id: "gid://shopify/Product/77", status: "ACTIVE" }]);
    // What it wrote matches the switch: nothing more to do.
    await t.mutation(internal.shopify.saveSynced, { listingId, productId: "gid://shopify/Product/77", variants: [], status: "ACTIVE" });
    expect(await jobs(t, "applyStatus")).toHaveLength(1);
  });

  it("retries due listings while checkout is still off", async () => {
    const t = newTest();
    const { listingId } = await pending(t);
    await t.run((ctx) => ctx.db.patch("shopProducts", listingId, { nextAttemptAt: 0 }));
    expect(await t.mutation(internal.shopify.retryDueProducts, {})).toBe(1);
  });
});
