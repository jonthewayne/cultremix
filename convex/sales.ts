import { ConvexError, v } from "convex/values";
import { sameRelative } from "../src/lib/print/shirtPlacement";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/adminAccess";
import { creatorEligibleAt } from "./lib/creators";
import { hasRoom, openReservation } from "./lib/budget";
import { imageUrlReader } from "./lib/imageUrls";
import { printfulConfigFromEnv } from "./lib/printful/client";
import { topazWorstCaseCents } from "./lib/pricing";
import { publicUrl } from "./lib/r2";
import { commerceOpen, simulatesTestOrders } from "./lib/shopFlags";
import { chosenProducts, listingFor, listingsOf, offeredShopProducts, printTargetForWork } from "./lib/shopProduct";
import type { ShopProduct } from "./lib/shopProduct";
import { shopifyAdminConfigFromEnv } from "./lib/shopify/adminClient";
import { crNumber, keptHandle, productHandle } from "./lib/shopify/productSync";
import { MAX_VERSIONS, UPSCALE_MAX_SIDE } from "./print";
import { garmentKindValidator, printAreaValidator, printSideValidator, relativePlacementValidator } from "./schema/merch";
import { listingFileValidator } from "./schema/shop";
import { flagEnabled } from "./studio";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Putting works on sale (for launch, each one by hand). An admin approves a published work in
// Admin, For sale. That fixes a listing for every product its creator picked (convex/lib/shopProduct.ts:
// the product, its colors and prices, where the design sits), makes a print file for each, and
// then creates a Shopify product for each (convex/shopify.ts). The work page sells them once they're
// live and the Checkout switch is on.
//
// The print files come from the Print Studio's versions (convex/print.ts): the version placed in the
// Print Studio when there is one, else version 1 (the published art, measured), upscaled at no
// credit cost when it's small enough for Topaz. Each product's file is that art placed on the
// product's whole print area at 300 DPI (convex/printTools.ts renderListings). The Print Studio's
// steps nudge advance() as they finish (convex/lib/salePrep.ts).

type Ctx = QueryCtx | MutationCtx;
type Row = Doc<"shopProducts">;

// Published works sell to anyone; a kept design sells to its creator alone (shopify.keptOffer).
function sellable(work: Doc<"works">) {
  return work.status === "published" || work.status === "private";
}

// A print file run that hasn't reported back in this long can be started again.
const RENDER_STALE_MS = 10 * 60_000;

const statusValidator = v.union(
  v.literal("preparing"),
  v.literal("pending"),
  v.literal("live"),
  v.literal("failed"),
  v.literal("paused"),
);

function sameArea(a: { widthIn: number; heightIn: number }, b: { widthIn: number; heightIn: number }) {
  return Math.abs(a.widthIn - b.widthIn) < 0.001 && Math.abs(a.heightIn - b.heightIn) < 0.001;
}

async function prepFailed(ctx: MutationCtx, rows: Array<Row>, message: string) {
  const now = Date.now();
  for (const row of rows) {
    await ctx.db.patch("shopProducts", row._id, { prepError: message.slice(0, 300), renderStartedAt: undefined, updatedAt: now });
  }
}

// A row whose print file exists goes on to Shopify.
async function toShop(ctx: MutationCtx, row: Row) {
  const now = Date.now();
  await ctx.db.patch("shopProducts", row._id, {
    status: "pending",
    prepError: undefined,
    renderStartedAt: undefined,
    attempts: 0,
    lastError: undefined,
    nextAttemptAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.shopify.syncListing, { listingId: row._id });
}

// One step further for a work being prepared for sale. Safe to call any time: it looks at what
// exists and starts only what's missing. A row with an error waits until it's approved again.
export async function advancePrep(ctx: MutationCtx, workId: Id<"works">) {
  const rows = (await listingsOf(ctx, workId)).filter((row) => row.status === "preparing" && row.listing && row.approvedBy);
  if (rows.length === 0) return;
  const work = await ctx.db.get("works", workId);
  if (!work || !sellable(work)) return await prepFailed(ctx, rows, "Only published and kept designs can go on sale.");
  const waiting: Array<Row> = [];
  for (const row of rows) {
    if (row.printFile) await toShop(ctx, row);
    else if (!row.prepError) waiting.push(row);
  }
  if (waiting.length === 0) return;
  const actor = waiting[0].approvedBy!;
  const since = Math.min(...waiting.map((row) => row.approvedAt ?? 0));
  const versions = await ctx.db
    .query("printVersions")
    .withIndex("by_work_number", (q) => q.eq("workId", workId))
    .collect();

  // Version 1: the published art, measured.
  const first = versions.find((version) => version.number === 1);
  if (!first) {
    if (!work.artKey) return await prepFailed(ctx, waiting, "The art is still being published.");
    const versionId = await ctx.db.insert("printVersions", {
      workId,
      number: 1,
      op: "published",
      status: "pending",
      key: work.artKey,
      ...(work.contentHash ? { sha256: work.contentHash } : {}),
      upscaled: false,
      charged: 0,
      createdBy: actor,
    });
    await ctx.scheduler.runAfter(0, internal.printTools.measure, { versionId });
    return;
  }
  if (first.status === "pending") return;
  if (first.status === "failed") {
    if ((first.finishedAt ?? 0) >= since) return await prepFailed(ctx, waiting, `Couldn't read the art: ${first.error ?? "unknown error"}`);
    await ctx.db.patch("printVersions", first._id, { status: "pending", error: undefined });
    await ctx.scheduler.runAfter(0, internal.printTools.measure, { versionId: first._id });
    return;
  }

  // The base: the version placed in the Print Studio when it's ready, else version 1.
  const studio = await ctx.db
    .query("printPlacements")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  const base = (studio && versions.find((version) => version._id === studio.versionId && version.status === "ready")) || first;

  // Print size: an upscale of the base (Topaz takes up to UPSCALE_MAX_SIDE; larger art goes as it is).
  let source: Doc<"printVersions"> = base;
  if (!base.upscaled && Math.max(base.width ?? 0, base.height ?? 0) <= UPSCALE_MAX_SIDE) {
    const upscales = versions.filter((version) => version.op === "upscale" && version.parentId === base._id);
    const ready = upscales.filter((version) => version.status === "ready");
    if (ready.length > 0) {
      source = ready[ready.length - 1];
    } else {
      if (upscales.some((version) => version.status === "pending")) return;
      const failed = upscales.filter((version) => version.status === "failed" && (version.finishedAt ?? 0) >= since);
      if (failed.length >= 2) {
        return await prepFailed(ctx, waiting, `The upscale failed twice: ${failed[failed.length - 1].error ?? "unknown error"}`);
      }
      if (!base.metrics?.hasAlpha || !base.width || !base.height) {
        return await prepFailed(ctx, waiting, "The art has no transparent background. Remove its background in the Print Studio (or knock out a flat color), then approve again.");
      }
      if (!(await flagEnabled(ctx, "gen.upscale"))) return await prepFailed(ctx, waiting, "Turn on Print-size art in Admin, then approve again.");
      if (versions.length >= MAX_VERSIONS) return await prepFailed(ctx, waiting, "This work has too many Print Studio versions. Finish it there.");
      const now = Date.now();
      const worstCaseCents = topazWorstCaseCents(base.width, base.height);
      if (!(await hasRoom(ctx, "fal", worstCaseCents, now))) {
        return await prepFailed(ctx, waiting, "Today's upscale budget is used up. Approve again tomorrow, or raise the daily budget in Admin.");
      }
      const versionId = await ctx.db.insert("printVersions", {
        workId,
        number: versions.reduce((max, version) => Math.max(max, version.number), 0) + 1,
        parentId: base._id,
        op: "upscale",
        status: "pending",
        upscaled: true,
        remixSourceId: base.remixSourceId ?? base._id,
        fal: { state: "queued", polls: 0 },
        charged: 0,
        createdBy: actor,
      });
      await openReservation(
        ctx,
        { attemptKind: "upscale", attemptId: versionId, provider: "fal", userId: actor, credits: 0, worstCaseCents },
        now,
      );
      await ctx.scheduler.runAfter(0, internal.upscale.submit, { versionId });
      return;
    }
  }
  if (!source.key || !source.width || !source.height || !source.metrics) {
    return await prepFailed(ctx, waiting, "The art couldn't be measured.");
  }

  // Every product's print file, made in one run.
  const now = Date.now();
  if (waiting.some((row) => row.renderStartedAt !== undefined && now - row.renderStartedAt < RENDER_STALE_MS)) return;
  for (const row of waiting) await ctx.db.patch("shopProducts", row._id, { renderStartedAt: now, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.printTools.renderListings, {
    workId,
    versionId: source._id,
    listingIds: waiting.map((row) => row._id),
  });
}

export const advance = internalMutation({
  args: { workId: v.id("works") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await advancePrep(ctx, args.workId);
    return null;
  },
});

const metricsValidator = v.object({ hasAlpha: v.boolean(), solid: v.number(), visible: v.number(), haze: v.number() });

// For printTools.renderListings: the art and each listing still waiting for its print file.
export const renderJob = internalQuery({
  args: { workId: v.id("works"), versionId: v.id("printVersions"), listingIds: v.array(v.id("shopProducts")) },
  returns: v.union(
    v.null(),
    v.object({
      family: v.number(),
      expression: v.number(),
      // A kept design's creator, whose folder holds its print files.
      keptBy: v.optional(v.id("users")),
      version: v.object({ id: v.id("printVersions"), key: v.string(), width: v.number(), height: v.number(), metrics: metricsValidator }),
      listings: v.array(
        v.object({
          listingId: v.id("shopProducts"),
          productKey: v.string(),
          placement: relativePlacementValidator,
          printArea: printAreaValidator,
          // Where the creator placed it in the Print Studio, in inches, when that was on this
          // product's front; it wins over the publish placement for this product.
          studio: v.optional(v.object({ xIn: v.number(), yIn: v.number(), widthIn: v.number() })),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    const version = await ctx.db.get("printVersions", args.versionId);
    if (!work || !version || version.workId !== work._id) return null;
    if (version.status !== "ready" || !version.key || !version.width || !version.height || !version.metrics) return null;
    const studio = await ctx.db
      .query("printPlacements")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .unique();
    const target = studio ? await printTargetForWork(ctx, work) : null;
    const listings = [];
    for (const listingId of args.listingIds) {
      const row = await ctx.db.get("shopProducts", listingId);
      if (!row || row.workId !== work._id || row.status !== "preparing" || row.printFile || !row.listing) continue;
      const placedHere =
        studio &&
        target &&
        row.listing.placement.side === "front" &&
        target.geometry.key === row.listing.productKey &&
        sameArea(target.geometry.printArea, row.listing.printArea);
      listings.push({
        listingId: row._id,
        productKey: row.listing.productKey,
        placement: row.listing.placement,
        printArea: row.listing.printArea,
        ...(placedHere ? { studio: { xIn: studio.xIn, yIn: studio.yIn, widthIn: studio.widthIn } } : {}),
      });
    }
    return {
      family: work.crFamily,
      expression: work.crExpression,
      ...(work.crFamily === 0 ? { keptBy: work.creatorId } : {}),
      version: { id: version._id, key: version.key, width: version.width, height: version.height, metrics: version.metrics },
      listings,
    };
  },
});

export const recordListingFile = internalMutation({
  args: { listingId: v.id("shopProducts"), file: listingFileValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row || row.status !== "preparing" || row.printFile) return null;
    await ctx.db.patch("shopProducts", row._id, { printFile: args.file, renderStartedAt: undefined, updatedAt: Date.now() });
    await advancePrep(ctx, row.workId);
    return null;
  },
});

export const failListingFile = internalMutation({
  args: { listingId: v.id("shopProducts"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("shopProducts", args.listingId);
    if (!row || row.status !== "preparing") return null;
    await ctx.db.patch("shopProducts", row._id, {
      prepError: `The print file failed: ${args.error}`.slice(0, 300),
      renderStartedAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ---- Admin ----

const approvedValidator = v.object({
  products: v.array(v.object({ name: v.string(), status: statusValidator, colors: v.number() })),
  // Products it was picked for that don't come in any of its colors.
  skipped: v.array(v.string()),
});

export const approve = mutation({
  args: { workId: v.id("works") },
  returns: approvedValidator,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "manage");
    const work = await ctx.db.get("works", args.workId);
    if (!work || !sellable(work)) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Only published and kept designs can go on sale." });
    }
    // A kept remix of a design taken down isn't printed: nothing new is made from that art
    // (convex/moderation.ts). A published remix is a work of its own, which an admin can take down.
    const withdrawnParent = await withdrawnParentOf(ctx, work);
    if (withdrawnParent) {
      throw new ConvexError({
        code: "PARENT_WITHDRAWN",
        message: `Its original, CR ${withdrawnParent}, was taken down, so it can't be printed. Put that design back up first.`,
      });
    }
    const choices = chosenProducts(work, await offeredShopProducts(ctx));
    if (choices.length === 0) {
      throw new ConvexError({ code: "NO_PRODUCTS", message: "None of the products this design was published on are offered now." });
    }
    const rows = await listingsOf(ctx, work._id);
    const cr = crNumber(work.crFamily, work.crExpression);
    const now = Date.now();
    // A Print Studio placement saved after a product's file was made means a new file for it.
    const studio = await ctx.db
      .query("printPlacements")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .unique();
    const studioKey = studio ? (await printTargetForWork(ctx, work)).geometry.key : null;
    const products: Array<{ name: string; status: Row["status"]; colors: number }> = [];
    const skipped: Array<string> = [];
    const kept = new Set<string>();
    let prepare = false;
    for (const { product, placement } of choices) {
      const listing = listingFor(work, product, placement);
      if (listing.colors.length === 0) {
        skipped.push(product.name);
        continue;
      }
      const existing = rows.find((row) => row.productKey === product.key);
      // A print file made for the same placement and print area is kept.
      const sameFile = Boolean(
        existing?.printFile &&
          existing.listing &&
          sameRelative(existing.listing.placement, listing.placement) &&
          sameArea(existing.listing.printArea, listing.printArea) &&
          !(studio && studioKey === product.key && studio.updatedAt > existing.printFile.madeAt),
      );
      // A live product stays on sale while it syncs again.
      const status: Row["status"] = !sameFile ? "preparing" : existing?.status === "live" ? "live" : "pending";
      const fields = {
        listing,
        approvedAt: now,
        approvedBy: admin._id,
        status,
        attempts: 0,
        updatedAt: now,
        ...(status === "preparing" ? {} : { nextAttemptAt: now }),
      };
      let id: Id<"shopProducts">;
      if (existing) {
        id = existing._id;
        await ctx.db.patch("shopProducts", existing._id, {
          ...fields,
          prepError: undefined,
          renderStartedAt: undefined,
          lastError: undefined,
          ...(sameFile ? {} : { printFile: undefined, nextAttemptAt: undefined }),
        });
      } else {
        id = await ctx.db.insert("shopProducts", {
          workId: work._id,
          productKey: product.key,
          handle:
            work.status === "private"
              ? keptHandle(work._id, product.printfulProductId)
              : productHandle(cr, product.printfulProductId),
          ...fields,
        });
      }
      kept.add(product.key);
      products.push({ name: product.name, status, colors: listing.colors.length });
      if (status === "preparing") prepare = true;
      else await ctx.scheduler.runAfter(0, internal.shopify.syncListing, { listingId: id });
    }
    // Products no longer picked or offered come off sale, in Shopify too.
    const dropped = [];
    for (const row of rows) {
      if (row.productKey && kept.has(row.productKey)) continue;
      if (row.status !== "paused") await ctx.db.patch("shopProducts", row._id, { status: "paused", nextAttemptAt: undefined, updatedAt: now });
      dropped.push(row);
    }
    await draftInShopify(ctx, dropped);
    if (products.length === 0) {
      throw new ConvexError({ code: "NO_COLORS", message: "None of this design's colors come in the products it was picked for." });
    }
    if (prepare) await advancePrep(ctx, work._id);
    return { products, skipped };
  },
});

// Off sale: the work page stops selling it (one product, or all). Approving or resuming puts it back.
export const pause = mutation({
  args: { workId: v.id("works"), productKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const rows = (await listingsOf(ctx, args.workId)).filter((row) => !args.productKey || row.productKey === args.productKey);
    if (rows.length === 0) throw new ConvexError({ code: "NOT_FOUND", message: "This work isn't on sale." });
    const now = Date.now();
    for (const row of rows) {
      await ctx.db.patch("shopProducts", row._id, { status: "paused", nextAttemptAt: undefined, renderStartedAt: undefined, updatedAt: now });
    }
    // Shopify drafts them too, so even a cart made before the pause can't check out; resuming syncs
    // them again, which makes them sellable.
    await draftInShopify(ctx, rows);
    return null;
  },
});

async function draftInShopify(ctx: MutationCtx, rows: Array<Doc<"shopProducts">>) {
  const productIds = rows.flatMap((row) => (row.shopifyProductId ? [row.shopifyProductId] : []));
  if (productIds.length > 0) await ctx.scheduler.runAfter(0, internal.shopify.draftProducts, { productIds });
}

export const resume = mutation({
  args: { workId: v.id("works"), productKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "manage");
    const work = await ctx.db.get("works", args.workId);
    const rows = (await listingsOf(ctx, args.workId)).filter(
      (row) => row.listing && row.status === "paused" && (!args.productKey || row.productKey === args.productKey),
    );
    if (!work || !sellable(work) || rows.length === 0) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Approve it for sale first." });
    }
    const now = Date.now();
    let prepare = false;
    for (const row of rows) {
      if (row.printFile) {
        await ctx.db.patch("shopProducts", row._id, { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now });
        await ctx.scheduler.runAfter(0, internal.shopify.syncListing, { listingId: row._id });
      } else {
        await ctx.db.patch("shopProducts", row._id, { status: "preparing", prepError: undefined, updatedAt: now });
        prepare = true;
      }
    }
    if (prepare) await advancePrep(ctx, work._id);
    return null;
  },
});

// What's happening while a work is being prepared, for the admin page.
async function prepStep(ctx: Ctx, workId: Id<"works">, rows: Array<Row>) {
  if (rows.some((row) => row.renderStartedAt !== undefined)) return "Making the print files";
  const versions = await ctx.db
    .query("printVersions")
    .withIndex("by_work_number", (q) => q.eq("workId", workId))
    .take(30);
  if (versions.some((version) => version.op === "upscale" && version.status === "pending")) return "Upscaling for print";
  if (versions.length === 0 || versions.some((version) => version.number === 1 && version.status === "pending")) return "Reading the art";
  return "Getting ready";
}

const listingRowValidator = v.object({
  productKey: v.string(),
  name: v.string(),
  kind: garmentKindValidator,
  side: printSideValidator,
  status: statusValidator,
  priceCents: v.number(),
  largePriceCents: v.number(),
  colors: v.array(v.object({ name: v.string(), hex: v.string() })),
  prepError: v.optional(v.string()),
  lastError: v.optional(v.string()),
  printFile: v.union(
    v.null(),
    v.object({ previewUrl: v.optional(v.string()), url: v.optional(v.string()), widthIn: v.number(), dpi: v.number(), grade: v.string() }),
  ),
});

const rowValidator = v.object({
  workId: v.id("works"),
  cr: v.string(),
  title: v.optional(v.string()),
  creator: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  // A kept design (sold to its creator alone), and when its creator asked to have it printed.
  kept: v.optional(v.boolean()),
  requestedAt: v.optional(v.number()),
  // A kept design whose original (this CR number) was taken down, so it can't be approved.
  parentWithdrawn: v.optional(v.string()),
  // The products its creator picked, by name.
  picked: v.array(v.string()),
  step: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  // Its creator changed what it comes on or where it sits since it was approved.
  changed: v.boolean(),
  // Its creator has creator access now; without it, their share of each sale waits (plan A1).
  creatorAccess: v.boolean(),
  listings: v.array(listingRowValidator),
});

// Published works, newest first, with how each one sells.
export const list = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ page: v.array(rowValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "view");
    const result = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 20 });
    const urls = imageUrlReader(ctx);
    const products = await offeredShopProducts(ctx);
    const page = await Promise.all(result.page.map((work) => saleRow(ctx, work, products, urls)));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

// How many kept designs Admin, For sale looks through for print requests.
const KEPT_SCAN = 300;

// Kept designs whose creators asked to have them printed (keeps.requestPrint), newest request
// first. Approving one puts it on sale for its creator alone (shopify.keptOffer).
export const keptRequests = query({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const kept = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "private"))
      .order("desc")
      .take(KEPT_SCAN);
    const asked = kept
      .filter((work) => work.printRequestedAt !== undefined)
      .sort((a, b) => (b.printRequestedAt ?? 0) - (a.printRequestedAt ?? 0))
      .slice(0, 50);
    const urls = imageUrlReader(ctx);
    const products = await offeredShopProducts(ctx);
    return await Promise.all(asked.map((work) => saleRow(ctx, work, products, urls)));
  },
});

// "101-003" when a kept design's original was taken down; null otherwise, and for published works.
async function withdrawnParentOf(ctx: Pick<QueryCtx, "db">, work: Doc<"works">) {
  if (work.status !== "private" || !work.parentWorkId) return null;
  const parent = await ctx.db.get("works", work.parentWorkId);
  return parent?.status === "withdrawn" ? crNumber(parent.crFamily, parent.crExpression) : null;
}

// One work's row in Admin, For sale: what its creator picked and how each product sells.
async function saleRow(
  ctx: QueryCtx,
  work: Doc<"works">,
  products: Array<ShopProduct>,
  urls: ReturnType<typeof imageUrlReader>,
) {
  const rows = (await listingsOf(ctx, work._id)).filter((row) => row.listing);
  const creator = await ctx.db.get("users", work.creatorId);
  const withdrawnParent = await withdrawnParentOf(ctx, work);
  const art = await urls(work.artKey);
  const preparing = rows.filter((row) => row.status === "preparing" && !row.prepError);
  const choices = chosenProducts(work, products);
  const live = rows.filter((row) => row.status !== "paused");
  const changed =
    live.length > 0 &&
    (choices.some((choice) => !live.some((row) => row.productKey === choice.product.key && sameRelative(row.listing!.placement, choice.placement))) ||
      live.some((row) => !choices.some((choice) => choice.product.key === row.productKey)));
  return {
    workId: work._id,
    cr: crNumber(work.crFamily, work.crExpression),
    title: work.title,
    creator: creator?.username,
    thumbUrl: art.thumbUrl,
    publishedAt: work.publishedAt,
    ...(work.status === "private" ? { kept: true, requestedAt: work.printRequestedAt } : {}),
    ...(withdrawnParent ? { parentWithdrawn: withdrawnParent } : {}),
    picked: choices.map((choice) => choice.product.name),
    changed,
    creatorAccess: await creatorEligibleAt(ctx, creator, Date.now()),
    step: preparing.length > 0 ? await prepStep(ctx, work._id, preparing) : undefined,
    ...(rows.some((row) => row.approvedAt !== undefined) ? { approvedAt: Math.max(...rows.map((row) => row.approvedAt ?? 0)) } : {}),
    listings: rows.map((row) => {
      const listing = row.listing!;
      return {
        productKey: listing.productKey,
        name: listing.name,
        kind: listing.kind,
        side: listing.placement.side,
        status: row.status,
        priceCents: listing.priceCents,
        largePriceCents: listing.largePriceCents,
        colors: listing.colors.map(({ name, hex }) => ({ name, hex })),
        ...(row.prepError ? { prepError: row.prepError } : {}),
        ...(row.lastError && row.status !== "live" ? { lastError: row.lastError } : {}),
        printFile: row.printFile
          ? {
              previewUrl: publicUrl(row.printFile.previewKey) ?? publicUrl(row.printFile.key),
              url: publicUrl(row.printFile.key),
              widthIn: row.printFile.placement.widthIn,
              dpi: Math.floor(row.printFile.dpi),
              grade: row.printFile.grade,
            }
          : null,
      };
    }),
  };
}

// The products on offer, and what still stands between an approved work and a sale.
export const overview = query({
  args: {},
  returns: v.object({
    products: v.array(
      v.object({
        name: v.string(),
        kind: garmentKindValidator,
        isDefault: v.boolean(),
        fromAdmin: v.boolean(),
        priceCents: v.number(),
        largePriceCents: v.number(),
        backExtraCents: v.number(),
        back: v.boolean(),
        colors: v.number(),
      }),
    ),
    checkoutOn: v.boolean(),
    upscaleOn: v.boolean(),
    shopify: v.boolean(),
    printful: v.boolean(),
    // Dev and staging: the owner can simulate a sale (orders.simulateSale).
    canSimulate: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const products = await offeredShopProducts(ctx);
    return {
      products: products.map((product) => ({
        name: product.name,
        kind: product.kind,
        isDefault: product.isDefault,
        fromAdmin: product.fromAdmin,
        priceCents: product.priceCents,
        largePriceCents: product.largePriceCents,
        backExtraCents: product.backExtraCents,
        back: Boolean(product.back),
        colors: product.colors.length,
      })),
      checkoutOn: await commerceOpen(ctx),
      upscaleOn: await flagEnabled(ctx, "gen.upscale"),
      shopify: shopifyAdminConfigFromEnv() !== null,
      printful: printfulConfigFromEnv() !== null,
      canSimulate: simulatesTestOrders(),
    };
  },
});

