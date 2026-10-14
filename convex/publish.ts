import { ConvexError, v } from "convex/values";
import { DEFAULT_PLACEMENT, clampRelative, sameRelative, toInches, withoutMark } from "../src/lib/print/shirtPlacement";
import { GARMENT_KINDS } from "../shared/config/print-products";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getViewerUser, isOwner } from "./identity";
import { requireMember } from "./studio";
import { MAX_DESCRIPTION_LENGTH, defaultOfferedColors, garmentColor, validateOfferedColors } from "./lib/garments";
import { isFlagOn } from "./lib/flagState";
import { formatCr, parseCr } from "./lib/r2";
import { pickLook } from "./lib/prompts";
import { enqueueRegisterWork } from "./lib/chain/queue";
import { publishPlacement, remixChangedOnlyWords } from "./lib/lineage";
import { recordPublishActivity, recordRemix } from "./lib/social";
import { inheritOnPublish } from "./remixFields";
import { carrySetup, inheritPartsOnPublish } from "./remixParts";
import { allowedChangesNote } from "./lib/remixParts";
import { activePalette, colorLookup } from "./merch";
import { relistColors } from "./sales";
import { chosenProducts, offeredShopProducts, retireKeptListings } from "./lib/shopProduct";
import { followPublishPlacement } from "./lib/printSync";
import { crNumber } from "./lib/shopify/productSync";
import { garmentKindValidator, relativePlacementValidator } from "./schema/merch";
import {
  BUDGET_RESTING,
  closeReservation,
  hasRoom,
  imageProviderSetting,
  openReservation,
  reservationFor,
  spendValidator,
} from "./lib/budget";
import { photoWorstCaseCents, qualityOf } from "./lib/pricing";
import { DAILY_LIMIT, startPhotoShoot } from "./lib/photoShoots";
import type { RelativePlacement } from "../src/lib/print/shirtPlacement";
import type { ShopProduct } from "./lib/shopProduct";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const PUBLISHING_OFF = "Publishing is paused for now. Your designs are safe here; try again soon.";
const PARENT_WITHDRAWN = "The design you remixed was taken down, so its remixes can't be published. Your designs stay here.";

// ---- How a remix relates to the design it remixes ----

// What the publish dialog may offer a remix design. A remix that changed only the parent's
// remixable words is a variation (convex/lib/lineage.ts remixChangedOnlyWords). Anything else is
// compared with the parent's art (convex/remixCheck.ts): a remix that reads as a new design may be
// a fork, which the dialog suggests; one that reads as the same design is a variation. If the
// comparison can't run, the remixer chooses.
export const relationStatus = v.union(
  v.literal("words"),
  v.literal("none"),
  v.literal("pending"),
  v.literal("variation"),
  v.literal("fork"),
  v.literal("failed"),
);
type RelationStatus = "words" | "none" | "pending" | "variation" | "fork" | "failed";

// A pending comparison older than this is started again (its action may have died).
const CHECK_STALE_MS = 2 * 60_000;
// A remix design is compared at most this many times.
const CHECK_ATTEMPTS = 3;

function remixRelation(
  generation: Doc<"generations">,
  batch: Doc<"batches">,
  parent: Doc<"works">,
): { status: RelationStatus; reason?: string } {
  if (remixChangedOnlyWords(batch, parent.artKey)) return { status: "words" };
  const check = generation.remixCheck;
  if (!check) return { status: "none" };
  if (check.status === "pending") return { status: "pending" };
  if (check.status === "failed") return { status: "failed" };
  return { status: check.verdict === "fork" ? "fork" : "variation", reason: check.reason };
}

const FORK_REFUSED: Record<Exclude<RelationStatus, "fork" | "failed">, string> = {
  words: "This remix changed only the design's remixable words and parts, so it publishes as a variation.",
  variation: "This remix reads as the same design with changes, so it publishes as a variation.",
  none: "Still comparing it with the original. Try again in a moment.",
  pending: "Still comparing it with the original. Try again in a moment.",
};

// The publish dialog starts the comparison when it opens on a remix design that changed more than
// its words. Nothing happens for other designs, or while a comparison is running or done.
export const checkRemix = mutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id || generation.status !== "succeeded" || !generation.fullKey) return null;
    const batch = await ctx.db.get("batches", generation.batchId);
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    const parent = session?.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    if (!batch || !parent?.artKey || (parent.status !== "published" && parent.status !== "withdrawn")) return null;
    if (remixChangedOnlyWords(batch, parent.artKey)) return null;
    const check = generation.remixCheck;
    const now = Date.now();
    if (check?.status === "done") return null;
    if (check?.status === "pending" && now - check.requestedAt < CHECK_STALE_MS) return null;
    if (check && check.attempts >= CHECK_ATTEMPTS) return null;
    await ctx.db.patch("generations", generation._id, {
      remixCheck: { status: "pending", requestedAt: now, attempts: (check?.attempts ?? 0) + 1 },
    });
    await ctx.scheduler.runAfter(0, internal.remixCheck.compare, { generationId: generation._id });
    return null;
  },
});

// For convex/remixCheck.ts: the parent's art and the design to compare.
export const remixCheckJob = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(v.null(), v.object({ parentKey: v.string(), designKey: v.string(), allowed: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation?.fullKey || generation.remixCheck?.status !== "pending") return null;
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    const parent = session?.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    if (!parent?.artKey) return null;
    // The parts the parent's creator made remixable, so changing them (five elves where there were
    // three) doesn't count toward a fork.
    const allowed = allowedChangesNote(parent.remixParts ?? []) || undefined;
    return { parentKey: parent.artKey, designKey: generation.fullKey, allowed };
  },
});

const aspectValue = v.optional(v.union(v.literal("same"), v.literal("changed")));

export const saveRemixCheck = internalMutation({
  args: {
    generationId: v.id("generations"),
    verdict: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
    reason: v.optional(v.string()),
    subject: aspectValue,
    layout: aspectValue,
    style: aspectValue,
    model: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation?.remixCheck) return null;
    const { requestedAt, attempts } = generation.remixCheck;
    const finishedAt = Date.now();
    await ctx.db.patch("generations", generation._id, {
      remixCheck: args.verdict
        ? {
            status: "done",
            requestedAt,
            attempts,
            finishedAt,
            verdict: args.verdict,
            reason: args.reason?.slice(0, 200),
            subject: args.subject,
            layout: args.layout,
            style: args.style,
            model: args.model,
          }
        : { status: "failed", requestedAt, attempts, finishedAt, error: (args.error ?? "The comparison failed.").slice(0, 200) },
    });
    return null;
  },
});

const lookValidator = v.object({ casting: v.string(), pose: v.string(), world: v.string() });

// Castings and settings of the most recently updated shoots, newest first.
async function recentLooks(ctx: MutationCtx) {
  const shoots = await ctx.db.query("shoots").order("desc").take(50);
  return shoots
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10)
    .map((shoot) => ({ casting: shoot.castingNote, world: shoot.world }));
}

async function peekFamily(ctx: QueryCtx | MutationCtx) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "crFamily"))
    .unique();
  return counter ? counter.next : 101;
}

// Holds one model photo's worst case against today's budget when photos go through the CultRemix
// Gateway. Returns the attempt's id (null when photos aren't budgeted), or "resting" when the day's
// budget can't take it. The action sends the call right away, so it counts as dispatched.
async function reservePhoto(
  ctx: MutationCtx,
  shootId: Id<"shoots">,
  userId: Id<"users"> | undefined,
  now: number,
): Promise<string | null | "resting"> {
  if (imageProviderSetting() !== "gateway") return null;
  const worstCaseCents = photoWorstCaseCents(qualityOf(process.env.PHOTO_QUALITY, "medium"));
  if (!(await hasRoom(ctx, "gateway", worstCaseCents, now))) return "resting";
  // A shoot can be reshot, so each photo call gets its own attempt id (two in one millisecond too).
  let attemptId = `photo:${shootId}:${now}`;
  for (let n = 2; await reservationFor(ctx, attemptId); n++) attemptId = `photo:${shootId}:${now}:${n}`;
  await openReservation(ctx, {
    attemptKind: "photo",
    attemptId,
    shootId,
    provider: "gateway",
    userId,
    credits: 0,
    worstCaseCents,
    dispatched: true,
  }, now);
  return attemptId;
}

async function nextFamily(ctx: MutationCtx) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "crFamily"))
    .unique();
  if (!counter) {
    await ctx.db.insert("counters", { name: "crFamily", next: 102 });
    return 101;
  }
  await ctx.db.patch("counters", counter._id, { next: counter.next + 1 });
  return counter.next;
}

// A private keep's number: family 0 (never shown, and no CR string parses to it) and the next
// keep. It never takes a public number.
async function nextKeep(ctx: MutationCtx) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "keptWork"))
    .unique();
  if (!counter) {
    await ctx.db.insert("counters", { name: "keptWork", next: 2 });
    return 1;
  }
  await ctx.db.patch("counters", counter._id, { next: counter.next + 1 });
  return counter.next;
}

// A public CR number: a new family for an original or a fork, the family's next expression for a
// variation.
async function allocateNumber(ctx: MutationCtx, parent: Doc<"works"> | null, kind: "variation" | "fork") {
  const placement = publishPlacement(parent ? { id: parent._id, family: parent.crFamily } : null, kind);
  if (placement.family === "new") return { placement, crFamily: await nextFamily(ctx), crExpression: 1 };
  const crFamily = placement.family;
  const family = await ctx.db
    .query("crFamilies")
    .withIndex("by_family", (q) => q.eq("family", crFamily))
    .unique();
  if (family) {
    await ctx.db.patch("crFamilies", family._id, { nextExpression: family.nextExpression + 1 });
    return { placement, crFamily, crExpression: family.nextExpression };
  }
  const crExpression = parent!.crExpression + 1;
  await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: crExpression + 1 });
  return { placement, crFamily, crExpression };
}

// What publishing answers: a kept work has no CR number to show.
function published(work: Pick<Doc<"works">, "_id" | "crFamily" | "crExpression" | "status" | "keep">) {
  const kept = work.status === "private" || work.keep === "private";
  return { workId: work._id, cr: kept ? "" : formatCr(work.crFamily, work.crExpression), ...(kept ? { kept: true } : {}) };
}

// Publishes a tile: allocates the CR number (a new family for an original or a
// fork, the family's next expression for a variation), inserts the work, and starts the
// asset copy and model photo. Idempotent by requestId and by generation.
export const quick = mutation({
  args: {
    requestId: v.string(),
    generationId: v.id("generations"),
    title: v.optional(v.string()),
    // For a remix: a variation joins the family (the default); a fork starts a new one.
    remixKind: v.optional(v.union(v.literal("variation"), v.literal("fork"))),
    // A short note for the shop page.
    description: v.optional(v.string()),
    // Shirt color keys (convex/lib/garments.ts), lead color first. Omitted: the design's own
    // shade plus the default colors.
    offeredColors: v.optional(v.array(v.string())),
    // "Keep it just for you": only its creator sees and orders it. No public number, feed, family,
    // onchain record, or shop listing; a remix's original still gets credit (its parent is kept).
    keep: v.optional(v.literal("private")),
    // Where the design sits on the garments (src/lib/print/shirtPlacement.ts), and the products on
    // offer it sells on, each with its own placement when adjusted. Omitted: the default placement
    // on the default product.
    printPlacement: v.optional(relativePlacementValidator),
    printProducts: v.optional(v.array(v.object({ productId: v.number(), placement: v.optional(relativePlacementValidator) }))),
  },
  returns: v.object({ workId: v.id("works"), cr: v.string(), kept: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const byRequest = await ctx.db
      .query("works")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (byRequest) return published(byRequest);
    // Off refuses new publishes; ones already started still get their art and photo.
    if (!(await isFlagOn(ctx, "publishing"))) {
      throw new ConvexError({ code: "PUBLISHING_OFF", message: PUBLISHING_OFF });
    }
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id || generation.kind === "shoot") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tile not found." });
    }
    if (generation.status !== "succeeded" || !generation.fullKey) {
      throw new ConvexError({ code: "NOT_READY", message: "That tile is not ready." });
    }
    const mine = await ctx.db
      .query("works")
      .withIndex("by_creator", (q) => q.eq("creatorId", user._id))
      .collect();
    const already = mine.find((work) => work.generationId === generation._id);
    if (already) return published(already);
    const batch = await ctx.db.get("batches", generation.batchId);
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    if (!batch || !session) throw new ConvexError({ code: "NOT_FOUND", message: "Tile not found." });
    const title = args.title?.trim().slice(0, 80) || undefined;
    const description = args.description?.trim().slice(0, MAX_DESCRIPTION_LENGTH) || undefined;
    // The colors on offer are the active shirt's (convex/merch.ts), or the launch colors.
    const palette = (await activePalette(ctx)).colors;
    const colors = validateOfferedColors(args.offeredColors ?? defaultOfferedColors(batch.backgroundColor, new Set(), palette), palette);
    if (!colors.ok) throw new ConvexError({ code: "INVALID_COLORS", message: colors.message });
    // The lead color is the work's background: the feed, the model photo and remixes all use it.
    const backgroundColor = garmentColor(colors.keys[0], palette)!.hex;
    const marksOn = await isFlagOn(ctx, CHEST_MARKS_FLAG);
    const printPlacement = markAllowed(clampRelative(args.printPlacement ?? DEFAULT_PLACEMENT), [], marksOn);
    const printProducts = pickPrintProducts(withMarksAllowed(args.printProducts, [], marksOn), printPlacement, await offeredShopProducts(ctx));
    if (printProducts.length === 0) {
      throw new ConvexError({ code: "INVALID_PRODUCTS", message: "Pick at least one product it comes on." });
    }

    // A remix is a variation (the parent's family, next expression) or a fork (a new family,
    // expression 1, crediting the parent). The parent must still be published: a design taken down
    // (convex/moderation.ts) gets no new remixes, public or kept, since a remix carries its art, and
    // a takedown is usually about that art. Remixes published before it stay up.
    const parent = session.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    if (parent?.status === "withdrawn") {
      throw new ConvexError({ code: "PARENT_WITHDRAWN", message: PARENT_WITHDRAWN });
    }
    if (session.remixOfWorkId && (!parent || parent.status !== "published")) {
      throw new ConvexError({ code: "PARENT_UNAVAILABLE", message: "The design you remixed isn't published anymore." });
    }
    const keep = args.keep === "private";
    if (parent && args.remixKind === "fork" && !keep) {
      const relation = remixRelation(generation, batch, parent);
      if (relation.status !== "fork" && relation.status !== "failed") {
        throw new ConvexError({ code: "VARIATION_ONLY", message: FORK_REFUSED[relation.status] });
      }
    }
    let crFamily: number;
    let crExpression: number;
    let placement: ReturnType<typeof publishPlacement>;
    if (keep) {
      // A keep's kind is what it would publish as; its number is family 0, never shown.
      placement = publishPlacement(parent ? { id: parent._id, family: parent.crFamily } : null, "variation");
      crFamily = 0;
      crExpression = await nextKeep(ctx);
    } else {
      ({ placement, crFamily, crExpression } = await allocateNumber(ctx, parent, args.remixKind ?? "variation"));
    }

    const startsFamily = placement.family === "new" && !keep;
    const workId = await ctx.db.insert("works", {
      crFamily,
      crExpression,
      creatorId: user._id,
      kind: placement.kind,
      parentWorkId: parent?._id,
      // Direct remixes are listed by effective parent (convex/lineage.ts).
      effectiveParentWorkId: parent?._id,
      familyRootId: keep || startsFamily ? undefined : (parent!.familyRootId ?? parent!._id),
      generationId: generation._id,
      requestId: args.requestId,
      title,
      description,
      offeredColors: colors.keys,
      backgroundColor,
      printPlacement,
      printProducts,
      status: "preparing",
      ...(keep ? { keep: "private" as const } : {}),
    });
    if (startsFamily) {
      await ctx.db.patch("works", workId, { familyRootId: workId });
      await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: 2, rootWorkId: workId });
    }
    // Remixable words and parts the creator set up in the studio come along.
    await carrySetup(ctx, workId, generation);
    await ctx.scheduler.runAfter(0, internal.imageGen.publishAssets, { workId });
    return keep ? { workId, cr: "", kept: true } : { workId, cr: formatCr(crFamily, crExpression) };
  },
});

// "Share with the world" on a kept work: it takes a public CR number (a variation of its
// original, or a fork when its comparison allows; a new family for an original) and goes through
// publishing's public steps: its own public folder, the feed, a model photo, the onchain record.
export const shareKeep = mutation({
  args: { workId: v.id("works"), remixKind: v.optional(v.union(v.literal("variation"), v.literal("fork"))) },
  returns: v.object({ workId: v.id("works"), cr: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.creatorId !== user._id || work.status !== "private") {
      throw new ConvexError({ code: "NOT_FOUND", message: "That design isn't one of your kept designs." });
    }
    if (!(await isFlagOn(ctx, "publishing"))) {
      throw new ConvexError({ code: "PUBLISHING_OFF", message: PUBLISHING_OFF });
    }
    const parent = work.parentWorkId ? await ctx.db.get("works", work.parentWorkId) : null;
    if (parent?.status === "withdrawn") {
      throw new ConvexError({ code: "PARENT_WITHDRAWN", message: PARENT_WITHDRAWN });
    }
    if (work.parentWorkId && (!parent || parent.status !== "published")) {
      throw new ConvexError({ code: "PARENT_UNAVAILABLE", message: "The design you remixed isn't published anymore." });
    }
    const generation = await ctx.db.get("generations", work.generationId);
    const batch = generation ? await ctx.db.get("batches", generation.batchId) : null;
    if (parent && args.remixKind === "fork") {
      const relation = generation && batch ? remixRelation(generation, batch, parent) : { status: "none" as const };
      if (relation.status !== "fork" && relation.status !== "failed") {
        throw new ConvexError({ code: "VARIATION_ONLY", message: FORK_REFUSED[relation.status] });
      }
    }
    const { placement, crFamily, crExpression } = await allocateNumber(ctx, parent, args.remixKind ?? "variation");
    const startsFamily = placement.family === "new";
    await ctx.db.patch("works", work._id, {
      crFamily,
      crExpression,
      kind: placement.kind,
      familyRootId: startsFamily ? work._id : (parent!.familyRootId ?? parent!._id),
      keep: undefined,
      status: "preparing",
    });
    if (startsFamily) await ctx.db.insert("crFamilies", { family: crFamily, nextExpression: 2, rootWorkId: work._id });
    // What it sold to its creator alone comes off sale, and Shopify archives those products; once
    // shared, it sells under its public number after an admin approves it.
    const retired = await retireKeptListings(ctx, work._id, crNumber(crFamily, crExpression));
    if (retired.length > 0) await ctx.scheduler.runAfter(0, internal.shopify.archiveProducts, { productIds: retired });
    await ctx.scheduler.runAfter(0, internal.imageGen.publishAssets, { workId: work._id });
    return { workId: work._id, cr: formatCr(crFamily, crExpression) };
  },
});

// Whether the studio shows its Publish buttons.
export const availability = query({
  args: {},
  returns: v.object({ publishing: v.boolean() }),
  handler: async (ctx) => ({ publishing: await isFlagOn(ctx, "publishing") }),
});

// The Chest marks switch: with a back print, its creator may add the same design small on the front
// chest (src/lib/print/shirtPlacement.ts). While it's off, a design keeps a mark it already has and
// gains no new one.
const CHEST_MARKS_FLAG = "print.chestMarks";

function markAllowed(next: RelativePlacement, had: ReadonlyArray<RelativePlacement>, on: boolean): RelativePlacement {
  if (on || next.mark === undefined) return next;
  const mark = next.mark;
  return had.some((placement) => placement.side === "back" && placement.mark !== undefined && Math.abs(placement.mark - mark) < 0.01)
    ? next
    : withoutMark(next);
}

function withMarksAllowed(
  picks: ReadonlyArray<{ productId: number; placement?: RelativePlacement }> | undefined,
  had: ReadonlyArray<RelativePlacement>,
  on: boolean,
) {
  return picks?.map((pick) => (pick.placement ? { ...pick, placement: markAllowed(clampRelative(pick.placement), had, on) } : pick));
}

// A work's placements as saved: its shared one and each product's own.
function savedPlacements(work: Doc<"works">): Array<RelativePlacement> {
  return [
    ...(work.printPlacement ? [work.printPlacement] : []),
    ...(work.printProducts ?? []).flatMap((pick) => (pick.placement ? [pick.placement] : [])),
  ];
}

// The products a work comes on, each with its own placement when it has one.
const printProductsValidator = v.array(v.object({ productId: v.number(), placement: v.optional(relativePlacementValidator) }));

// What the publish dialog shows before confirming: the CR number the design would get (a new
// family, or the parent family's next number for a variation), a one-line lineage summary for a
// remix, and the colors it starts with. Numbers are a preview; publishing allocates them.
export const preview = query({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({
      publishing: v.boolean(),
      // Whether Publish offers a chest mark with a back print.
      chestMarks: v.boolean(),
      newFamilyCr: v.string(),
      remix: v.optional(
        v.object({
          parentCr: v.string(),
          variationCr: v.string(),
          summary: v.string(),
          // How it relates (remixRelation): the dialog offers a fork for "fork" (suggested) and
          // "failed" (the remixer chooses); otherwise it's a variation.
          relation: v.object({ status: relationStatus, reason: v.optional(v.string()) }),
          // What the parent comes on and where it sits, still on offer: where the remix starts.
          setup: v.object({ printPlacement: relativePlacementValidator, printProducts: printProductsValidator }),
        }),
      ),
      defaultColors: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id) return null;
    const batch = await ctx.db.get("batches", generation.batchId);
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    if (!batch || !session) return null;
    const newFamilyCr = formatCr(await peekFamily(ctx), 1);
    let remix;
    const parent = session.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    if (parent && (parent.status === "published" || parent.status === "withdrawn")) {
      const family = await ctx.db
        .query("crFamilies")
        .withIndex("by_family", (q) => q.eq("family", parent.crFamily))
        .unique();
      const parentCr = formatCr(parent.crFamily, parent.crExpression);
      const creator = await ctx.db.get("users", parent.creatorId);
      const name = parent.title ? ` “${parent.title}”` : "";
      const by = creator?.username && creator._id !== user._id ? ` by @${creator.username}` : "";
      remix = {
        parentCr,
        variationCr: formatCr(parent.crFamily, family ? family.nextExpression : parent.crExpression + 1),
        summary: `A remix of CR ${parentCr}${name}${by}.`,
        relation: remixRelation(generation, batch, parent),
        setup: workSetup(parent, await offeredShopProducts(ctx)),
      };
    }
    return {
      publishing: await isFlagOn(ctx, "publishing"),
      chestMarks: await isFlagOn(ctx, CHEST_MARKS_FLAG),
      newFamilyCr,
      remix,
      defaultColors: defaultOfferedColors(batch.backgroundColor, new Set(), (await activePalette(ctx)).colors),
    };
  },
});

// The products a publish may pick: products on offer, each once, at most MAX_PRINT_PRODUCTS. A
// product's own placement is kept only when it differs from the work's. None picked: the default.
const MAX_PRINT_PRODUCTS = 8;
function pickPrintProducts(
  picks: ReadonlyArray<{ productId: number; placement?: RelativePlacement }> | undefined,
  shared: RelativePlacement,
  offered: ReadonlyArray<ShopProduct>,
) {
  const chosen = picks ?? [{ productId: offered[0].printfulProductId }];
  const out: Array<{ productId: number; placement?: RelativePlacement }> = [];
  for (const pick of chosen) {
    const product = offered.find((p) => p.printfulProductId === pick.productId);
    if (!product || out.some((o) => o.productId === pick.productId) || out.length >= MAX_PRINT_PRODUCTS) continue;
    const own = pick.placement ? clampRelative(pick.placement) : undefined;
    out.push(own && !sameRelative(own, shared) ? { productId: product.printfulProductId, placement: own } : { productId: product.printfulProductId });
  }
  return out;
}

// Where a work sits (its shared placement) and the products on offer it comes on, each with its own
// placement only when that differs.
function workSetup(work: Doc<"works">, offered: ReadonlyArray<ShopProduct>) {
  const shared = clampRelative(work.printPlacement ?? DEFAULT_PLACEMENT);
  return {
    printPlacement: shared,
    printProducts: chosenProducts(work, offered).map(({ product, placement }) =>
      sameRelative(placement, shared) ? { productId: product.printfulProductId } : { productId: product.printfulProductId, placement },
    ),
  };
}

// Where a work sits and what it comes on, for its creator (and the owner) to change after
// publishing. Null for anyone else. onSale: it has listings, so a change reaches the shop when an
// admin approves it again.
export const printSetup = query({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      printPlacement: relativePlacementValidator,
      printProducts: printProductsValidator,
      onSale: v.boolean(),
      // Whether the editor offers a chest mark with a back print.
      chestMarks: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!user || !work || (work.creatorId !== user._id && !isOwner(user))) return null;
    if (work.status !== "published" && work.status !== "private") return null;
    const listings = await ctx.db
      .query("shopProducts")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .take(20);
    return {
      ...workSetup(work, await offeredShopProducts(ctx)),
      onSale: listings.some((row) => row.listing !== undefined),
      chestMarks: await isFlagOn(ctx, CHEST_MARKS_FLAG),
    };
  },
});

export const setPrintSetup = mutation({
  args: { workId: v.id("works"), printPlacement: relativePlacementValidator, printProducts: printProductsValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!work || (work.creatorId !== user._id && !isOwner(user)) || (work.status !== "published" && work.status !== "private")) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That design isn't yours to change." });
    }
    const marksOn = await isFlagOn(ctx, CHEST_MARKS_FLAG);
    const had = savedPlacements(work);
    const printPlacement = markAllowed(clampRelative(args.printPlacement), had, marksOn);
    const printProducts = pickPrintProducts(withMarksAllowed(args.printProducts, had, marksOn), printPlacement, await offeredShopProducts(ctx));
    if (printProducts.length === 0) {
      throw new ConvexError({ code: "INVALID_PRODUCTS", message: "Pick at least one product it comes on." });
    }
    await ctx.db.patch("works", work._id, { printPlacement, printProducts });
    await followPublishPlacement(ctx, work._id, user._id);
    return null;
  },
});

// On a design's page, for its creator and the owner: its shirt colors, lead first, from the colors
// on offer now (convex/merch.ts palette), and whether it's on sale. Null for everyone else.
export const colorSetup = query({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      colors: v.array(v.string()),
      onSale: v.boolean(),
      isOwner: v.boolean(),
      // A shared design has a model photo, which can be shot again on a new lead color.
      canRetake: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!user || !work || (work.creatorId !== user._id && !isOwner(user))) return null;
    if (work.status !== "published" && work.status !== "private") return null;
    const palette = (await activePalette(ctx)).colors;
    const known = new Set(palette.map((color) => color.key));
    const current = (work.offeredColors ?? []).filter((key) => known.has(key));
    const listings = await ctx.db
      .query("shopProducts")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .take(20);
    return {
      colors: current.length > 0 ? current : defaultOfferedColors(work.backgroundColor, new Set(), palette),
      onSale: listings.some((row) => row.listing !== undefined && row.status !== "paused"),
      isOwner: isOwner(user),
      canRetake: work.status === "published",
    };
  },
});

// Changes a design's shirt colors after publishing, for its creator and the owner: colors on offer,
// lead first, up to 20. The lead is its background (the feed, the model photo, and remixes use it).
// Its shop products sell the new colors at once and keep their print files (sales.relistColors).
// When the lead changed and retakePhoto is set, a new model photo is shot on it: the owner's don't
// count against the day's photo shoots, and a creator's do.
export const setOfferedColors = mutation({
  args: { workId: v.id("works"), colors: v.array(v.string()), retakePhoto: v.optional(v.boolean()) },
  returns: v.object({ colors: v.array(v.string()), relisted: v.number(), kept: v.array(v.string()), photo: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const work = await ctx.db.get("works", args.workId);
    if (!work || (work.creatorId !== user._id && !isOwner(user)) || (work.status !== "published" && work.status !== "private")) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That design isn't yours to change." });
    }
    const palette = (await activePalette(ctx)).colors;
    const result = validateOfferedColors(args.colors, palette);
    if (!result.ok) throw new ConvexError({ code: "INVALID_COLORS", message: result.message });
    const lead = garmentColor(result.keys[0], palette)!;
    const leadChanged = (work.offeredColors?.[0] ?? null) !== lead.key;
    await ctx.db.patch("works", work._id, { offeredColors: result.keys, backgroundColor: lead.hex });
    const relisted = await relistColors(ctx, work._id);
    const photo = Boolean(args.retakePhoto && leadChanged && work.status === "published" && work.artKey);
    if (photo) {
      await ctx.scheduler.runAfter(0, internal.imageGen.reshoot, {
        cr: formatCr(work.crFamily, work.crExpression),
        skipLimit: isOwner(user),
      });
    }
    return { colors: result.keys, relisted: relisted.synced, kept: relisted.kept, photo };
  },
});

// What the model photo shows: the first product a work sells on, with the design where its creator
// put it, and how wide it prints there when the design's size is known.
export async function photoGarment(ctx: QueryCtx | MutationCtx, work: Doc<"works">) {
  const [first] = chosenProducts(work, await offeredShopProducts(ctx));
  const kind = first?.product.kind ?? ("tee" as const);
  const placement = first?.placement ?? clampRelative(work.printPlacement ?? DEFAULT_PLACEMENT);
  const area = first
    ? placement.side === "back" && first.product.back
      ? first.product.back
      : first.product.front
    : GARMENT_KINDS[kind][placement.side];
  const generation = await ctx.db.get("generations", work.generationId);
  const aspect = generation?.width && generation.height ? generation.height / generation.width : undefined;
  return { kind, placement, area, ...(aspect ? { widthIn: toInches(placement, aspect, area).widthIn } : {}) };
}

export const photoGarmentValidator = v.object({
  kind: garmentKindValidator,
  placement: relativePlacementValidator,
  widthIn: v.optional(v.number()),
  area: v.optional(v.object({ widthIn: v.number(), heightIn: v.number() })),
});

export const assetJob = internalQuery({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      fullKey: v.string(),
      backgroundColor: v.string(),
      garment: photoGarmentValidator,
      crFamily: v.number(),
      crExpression: v.number(),
      // Kept just for its creator: its art stays at the design's own unguessable address.
      keep: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    const generation = await ctx.db.get("generations", work.generationId);
    if (!generation?.fullKey) return null;
    return {
      fullKey: generation.fullKey,
      backgroundColor: work.backgroundColor,
      garment: await photoGarment(ctx, work),
      crFamily: work.crFamily,
      crExpression: work.crExpression,
      ...(work.keep === "private" ? { keep: true } : {}),
    };
  },
});

export const markPublished = internalMutation({
  args: { workId: v.id("works"), artKey: v.string(), contentHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      shootId: v.id("shoots"),
      look: lookValidator,
      // The photo's reservation; resting when the day's budget can't take it (no photo today).
      attemptId: v.optional(v.string()),
      resting: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    const now = Date.now();
    if (work.keep === "private") {
      // Kept just for its creator: none of the public steps (feed, notifications, onchain record,
      // model photo, shop listing). Its remixable parts come from its parent like any remix.
      await ctx.db.patch("works", work._id, { status: "private", publishedAt: now, artKey: args.artKey, contentHash: args.contentHash });
      await inheritOnPublish(ctx, work._id);
      await inheritPartsOnPublish(ctx, work._id);
      // Its art upscaled for its page and for print (convex/print.ts startArtUpscale).
      await ctx.scheduler.runAfter(0, internal.print.upscaleArt, { workId: work._id });
      return null;
    }
    await ctx.db.patch("works", work._id, {
      status: "published",
      publishedAt: now,
      artKey: args.artKey,
      contentHash: args.contentHash,
    });
    // The Following feed and profiles read this event (convex/lib/social.ts).
    const published = { ...work, status: "published" as const, publishedAt: now };
    await recordPublishActivity(ctx, published);
    // The parent's creator gets a notification, and the parent gains trending attention.
    await recordRemix(ctx, published);
    // A remix's remixable words start from its parent's (convex/remixFields.ts).
    await inheritOnPublish(ctx, work._id);
    await inheritPartsOnPublish(ctx, work._id);
    // Notes on the art for everyone who remixes it (imageNotes.analyzeWork).
    await ctx.scheduler.runAfter(0, internal.imageNotes.analyzeWork, { workId: work._id });
    // Its art upscaled for its page and for print (convex/print.ts startArtUpscale).
    await ctx.scheduler.runAfter(0, internal.print.upscaleArt, { workId: work._id });
    // Onchain provenance: registered by the relayer, signed by the creator's wallet once it's
    // ready, after the parent's registration for a remix (convex/lib/chain/queue.ts).
    await enqueueRegisterWork(ctx, work._id);
    const look = pickLook(work._id, await recentLooks(ctx));
    // Past the creator's photo shoots for today, the work publishes and its photo waits;
    // the creator can try it again tomorrow (photos.retry).
    const allowed = await startPhotoShoot(ctx, work.creatorId, work._id, now);
    const shootId = await ctx.db.insert("shoots", {
      workId: work._id,
      status: allowed ? "running" : "failed",
      reason: allowed ? undefined : DAILY_LIMIT,
      requestedBy: work.creatorId,
      createdAt: now,
      updatedAt: now,
      castingNote: look.casting,
      pose: look.pose,
      world: look.world,
    });
    await ctx.db.insert("shootPhotos", {
      shootId,
      workId: work._id,
      index: 1,
      state: allowed ? "pending" : "failed",
      reason: allowed ? undefined : DAILY_LIMIT,
    });
    // Past today's photo shoots, the work publishes now and its photo waits.
    if (!allowed) return null;
    const attempt = await reservePhoto(ctx, shootId, work.creatorId, now);
    if (attempt === "resting") {
      // The work is published; its model photo waits for a reshoot.
      await failShootPhoto(ctx, shootId, BUDGET_RESTING);
      return { shootId, look, resting: true };
    }
    return { shootId, look, attemptId: attempt ?? undefined };
  },
});

// Starts a new model photo for a published work with a different casting. The
// current photo stays up until the new one is recorded. A reshoot counts against the
// creator's photo shoots for today unless skipLimit is set: photos.retry has already
// counted it, and reshootAll is the operator's own run.
export const beginReshoot = internalMutation({
  args: { cr: v.string(), skipLimit: v.optional(v.boolean()) },
  returns: v.union(
    v.null(),
    v.object({
      shootId: v.id("shoots"),
      artKey: v.string(),
      backgroundColor: v.string(),
      garment: photoGarmentValidator,
      look: lookValidator,
      crFamily: v.number(),
      crExpression: v.number(),
      // The photo shown now; the new one takes the next photo number.
      photoKey: v.optional(v.string()),
      attemptId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const parsed = parseCr(args.cr);
    if (!parsed) return null;
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) =>
        q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
      )
      .unique();
    if (!work || work.status !== "published" || !work.artKey) return null;
    const now = Date.now();
    // Checked before anything changes, so a refused reshoot leaves the shoot as it was.
    const photoCents = photoWorstCaseCents(qualityOf(process.env.PHOTO_QUALITY, "medium"));
    if (imageProviderSetting() === "gateway" && !(await hasRoom(ctx, "gateway", photoCents, now))) {
      console.log("reshoot refused: the daily budget is spent", args.cr);
      return null;
    }
    const existing = await ctx.db
      .query("shoots")
      .withIndex("by_work", (q) => q.eq("workId", work._id))
      .first();
    const current = existing
      ? await ctx.db
          .query("shootPhotos")
          .withIndex("by_shoot_index", (q) => q.eq("shootId", existing._id).eq("index", 1))
          .unique()
      : null;
    if (!args.skipLimit && !(await startPhotoShoot(ctx, work.creatorId, work._id, now))) {
      // A photo that's up stays up; one that never came waits for tomorrow.
      if (current?.state !== "succeeded") await markWaiting(ctx, work, existing?._id ?? null, current?._id ?? null, now);
      return null;
    }
    const look = pickLook(`${work._id}:${now}`, [
      { casting: existing?.castingNote, world: existing?.world },
      ...(await recentLooks(ctx)),
    ]);
    const fields = { castingNote: look.casting, pose: look.pose, world: look.world };
    let shootId = existing?._id;
    if (shootId) {
      const running = current?.state === "succeeded" ? {} : { status: "running" as const, reason: undefined };
      await ctx.db.patch("shoots", shootId, { ...fields, ...running, updatedAt: now });
    } else {
      shootId = await ctx.db.insert("shoots", {
        workId: work._id,
        status: "running",
        requestedBy: work.creatorId,
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
    }
    if (!current) {
      await ctx.db.insert("shootPhotos", { shootId, workId: work._id, index: 1, state: "pending" });
    } else if (current.state === "failed") {
      // Pages show "Developing…" again while the retry runs.
      await ctx.db.patch("shootPhotos", current._id, { state: "pending", reason: undefined });
    }
    const attempt = await reservePhoto(ctx, shootId, undefined, now);
    // The shirt is the design's lead color, which can change after publishing.
    const lead = work.offeredColors && work.offeredColors.length > 0 ? (await colorLookup(ctx)).get(work.offeredColors[0]) : undefined;
    return {
      attemptId: attempt === null || attempt === "resting" ? undefined : attempt,
      shootId,
      artKey: work.artKey,
      backgroundColor: lead?.hex ?? work.backgroundColor,
      garment: await photoGarment(ctx, work),
      look,
      crFamily: work.crFamily,
      crExpression: work.crExpression,
      photoKey: current?.publicKey,
    };
  },
});

// Records that a work's model photo waits for its creator's next day.
async function markWaiting(
  ctx: MutationCtx,
  work: Doc<"works">,
  shootId: Id<"shoots"> | null,
  photoId: Id<"shootPhotos"> | null,
  now: number,
) {
  const waiting = { status: "failed" as const, reason: DAILY_LIMIT, updatedAt: now };
  const id =
    shootId ??
    (await ctx.db.insert("shoots", { workId: work._id, requestedBy: work.creatorId, createdAt: now, ...waiting }));
  if (shootId) await ctx.db.patch("shoots", shootId, waiting);
  if (photoId) await ctx.db.patch("shootPhotos", photoId, { state: "failed", reason: DAILY_LIMIT });
  else await ctx.db.insert("shootPhotos", { shootId: id, workId: work._id, index: 1, state: "failed", reason: DAILY_LIMIT });
}

// Reshoots every published work's model photo, a couple of seconds apart. An operator's
// run, so it doesn't count against members' photo shoots:
// bunx convex run publish:reshootAll
export const reshootAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const works = await ctx.db
      .query("works")
      .withIndex("by_status_publishedAt", (q) => q.eq("status", "published"))
      .collect();
    for (const [i, work] of works.entries()) {
      await ctx.scheduler.runAfter(i * 3000, internal.imageGen.reshoot, {
        cr: formatCr(work.crFamily, work.crExpression),
        skipLimit: true,
      });
    }
    return works.length;
  },
});

export const markAssetFailed = internalMutation({
  args: { workId: v.id("works"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "preparing") return null;
    await ctx.db.patch("works", work._id, { status: "asset_failed", assetError: args.error });
    return null;
  },
});

export const recordPhoto = internalMutation({
  args: {
    shootId: v.id("shoots"),
    publicKey: v.string(),
    // The photo call's reservation and what it cost (convex/lib/paidAttempts.ts).
    attemptId: v.optional(v.string()),
    spend: v.optional(spendValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.attemptId) await closeReservation(ctx, args.attemptId, args.spend ?? { kind: "settle" });
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_shoot_index", (q) => q.eq("shootId", args.shootId).eq("index", 1))
      .unique();
    if (photo) {
      await ctx.db.patch("shootPhotos", photo._id, { state: "succeeded", publicKey: args.publicKey });
      // The same photo in the work's other colors, when Photos in every color is on (convex/colorPhotos.ts).
      await ctx.scheduler.runAfter(0, internal.colorPhotos.start, { workId: photo.workId });
    }
    await ctx.db.patch("shoots", args.shootId, { status: "done", updatedAt: Date.now() });
    return null;
  },
});

export const recordPhotoFailed = internalMutation({
  args: {
    shootId: v.id("shoots"),
    reason: v.string(),
    attemptId: v.optional(v.string()),
    spend: v.optional(spendValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.attemptId) await closeReservation(ctx, args.attemptId, args.spend ?? { kind: "settle" });
    await failShootPhoto(ctx, args.shootId, args.reason);
    return null;
  },
});

export async function failShootPhoto(ctx: MutationCtx, shootId: Id<"shoots">, reason: string) {
  const photo = await ctx.db
    .query("shootPhotos")
    .withIndex("by_shoot_index", (q) => q.eq("shootId", shootId).eq("index", 1))
    .unique();
  // A failed reshoot leaves the photo that's up in place.
  if (photo?.state === "succeeded") return;
  if (photo) {
    await ctx.db.patch("shootPhotos", photo._id, { state: "failed", reason });
  }
  await ctx.db.patch("shoots", shootId, {
    status: "failed",
    reason: "photo_failed",
    updatedAt: Date.now(),
  });
}
