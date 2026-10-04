import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { creditBalance, getViewerUser, isOwner } from "./identity";
import { authorizeDispatch, closeReservation, hasRoom, openReservation, spendValidator } from "./lib/budget";
import { isBlockedError, publicTileError } from "./lib/imageErrors";
import { imageUrlReader } from "./lib/imageUrls";
import { EMPTY_PAGE, cappedPage } from "./lib/paging";
import { styleShares } from "./lib/prompts";
import type { ImageRole } from "./lib/prompts";
import { gridWorstCaseCents, qualityOf, singleWorstCaseCents } from "./lib/pricing";
import { formatCr, isDevDeployment, parseCr, publicUrl } from "./lib/r2";
import { SESSION_TITLE_MAX, sessionName } from "./lib/sessions";
import { isImageKey } from "./lib/sizes";
import {
  BATCH_COUNT_CAP,
  BATCH_CREDITS,
  DESIGNS_PER_BATCH,
  MAX_IMAGES,
  MAX_STYLES,
  creditsBack,
} from "./lib/studioRules";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

export const MODEL_TEXT = "openai/gpt-image-2.5-flare";
export const MODEL_EDIT = "openai/gpt-image-2.5-sunburst";
const HEX = /^#[0-9a-f]{6}$/iu;

export const tileStatus = v.union(
  v.literal("queued"),
  v.literal("dispatched"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("needs_provider_choice"),
  v.literal("unknown_outcome"),
  v.literal("refused"),
  v.literal("expired"),
);

const tileView = v.object({
  generationId: v.id("generations"),
  batchId: v.id("batches"),
  status: tileStatus,
  // The original, for download and "Open full size"; the medium and thumbnail are for showing it.
  url: v.optional(v.string()),
  mediumUrl: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  key: v.optional(v.string()),
  favorite: v.boolean(),
  // A fixed message (publicTileError); the provider's own error text stays on the server.
  error: v.optional(v.string()),
  // The provider's content filter refused it; the studio shows a friendly stamp instead of the error.
  blocked: v.boolean(),
  backgroundColor: v.string(),
  publishedCr: v.optional(v.string()),
});

const batchView = v.object({
  batchId: v.id("batches"),
  createdAt: v.number(),
  instruction: v.string(),
  presets: v.array(v.string()),
  backgroundColor: v.string(),
  inspirationUrl: v.optional(v.string()),
  images: v.array(v.object({ url: v.optional(v.string()), thumbUrl: v.optional(v.string()) })),
  // The style mix as thumbnails and shares; what the styles were read as stays on the server.
  styles: v.array(v.object({ url: v.optional(v.string()), thumbUrl: v.optional(v.string()), share: v.number() })),
  // A grid batch is charged as a whole; refunded is the credits it gave back for missing designs.
  grid: v.boolean(),
  refunded: v.optional(v.number()),
  tiles: v.array(tileView),
});

const sessionView = v.object({
  sessionId: v.id("creativeSessions"),
  // The member's title, and the name shown (title, "Remix of CR …", or the first request).
  title: v.optional(v.string()),
  name: v.string(),
  createdAt: v.number(),
  remix: v.optional(
    v.object({
      workId: v.id("works"),
      cr: v.string(),
      title: v.optional(v.string()),
      artKey: v.optional(v.string()),
      artUrl: v.optional(v.string()),
      artThumbUrl: v.optional(v.string()),
      backgroundColor: v.string(),
    }),
  ),
  // How many batches it has, counted up to BATCH_COUNT_CAP.
  batchCount: v.number(),
  // The newest batch's settings, so reopening a session picks up where it left off.
  lastInputs: v.optional(
    v.object({
      instruction: v.string(),
      backgroundColor: v.string(),
      images: v.array(
        v.object({ imageId: v.id("userImages"), url: v.optional(v.string()), thumbUrl: v.optional(v.string()) }),
      ),
      styles: v.array(
        v.object({
          imageId: v.id("userImages"),
          url: v.optional(v.string()),
          thumbUrl: v.optional(v.string()),
          weight: v.number(),
        }),
      ),
      // A batch from the previous studio: its one image, not yet in the member's images.
      legacyKey: v.optional(v.string()),
      legacyUrl: v.optional(v.string()),
    }),
  ),
});

export async function flagEnabled(ctx: Ctx, key: string) {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row ? row.enabled : true;
}

async function latestSession(ctx: Ctx, ownerId: Id<"users">) {
  return await ctx.db
    .query("creativeSessions")
    .withIndex("by_owner_updated", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .first();
}

// The session's first request, for its default name.
async function firstInstruction(ctx: Ctx, sessionId: Id<"creativeSessions">) {
  const early = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .order("asc")
    .take(5);
  return early.find((batch) => batch.instruction.trim())?.instruction;
}

async function remixCrOf(ctx: Ctx, session: Doc<"creativeSessions">) {
  if (!session.remixOfWorkId) return undefined;
  const work = await ctx.db.get("works", session.remixOfWorkId);
  return work ? formatCr(work.crFamily, work.crExpression) : undefined;
}

// A batch as the studio shows it: its line (request, images, style mix) and its four designs.
async function batchViewOf(ctx: Ctx, urls: ReturnType<typeof imageUrlReader>, batch: Doc<"batches">) {
  const generations = await ctx.db
    .query("generations")
    .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
    .take(DESIGNS_PER_BATCH * 2);
  generations.sort((a, b) => a.index - b.index);
  // The mixer's styles plus images the request named for their look (as studioPrompt reads them).
  const mix = (batch.styles ?? []).map((s) => ({ imageId: s.imageId, key: s.key, weight: s.weight }));
  for (const [i, role] of (batch.roles ?? []).entries()) {
    const image = batch.images?.[i];
    if (!image || role === "content") continue;
    const at = mix.findIndex((s) => s.imageId === image.imageId);
    if (at < 0) mix.push({ imageId: image.imageId, key: image.key, weight: 100 });
    else if (mix[at].weight <= 0) mix[at] = { ...mix[at], weight: 100 };
  }
  const shares = styleShares(mix.map((s) => s.weight));
  const styles = [];
  for (const [i, style] of mix.entries()) {
    if (shares[i] <= 0) continue;
    const { url, thumbUrl } = await urls(style.key);
    styles.push({ url, thumbUrl, share: shares[i] });
  }
  const images = [];
  for (const image of batch.images ?? []) {
    const { url, thumbUrl } = await urls(image.key);
    images.push({ url, thumbUrl });
  }
  const tiles = [];
  for (const g of generations) {
    const blocked = g.status === "failed" && isBlockedError(g.error);
    const { url, mediumUrl, thumbUrl } = await urls(g.fullKey);
    const work =
      g.status === "succeeded"
        ? await ctx.db
            .query("works")
            .withIndex("by_generation", (q) => q.eq("generationId", g._id))
            .first()
        : null;
    tiles.push({
      generationId: g._id,
      batchId: g.batchId,
      status: g.status,
      url,
      mediumUrl,
      thumbUrl,
      key: g.fullKey,
      favorite: g.favorite,
      error: blocked ? undefined : publicTileError(g.error),
      blocked,
      backgroundColor: batch.backgroundColor,
      publishedCr: work ? formatCr(work.crFamily, work.crExpression) : undefined,
    });
  }
  return {
    batchId: batch._id,
    createdAt: batch._creationTime,
    instruction: batch.instruction,
    presets: batch.presets,
    backgroundColor: batch.backgroundColor,
    inspirationUrl: publicUrl(batch.inspirationKey),
    images,
    styles,
    grid: batch.layout === "grid",
    refunded: batch.refunded,
    tiles,
  };
}

// The session's header: its name, remix source, how many batches it has, and the newest batch's
// settings. Its batches page in through sessionBatches.
async function buildSessionView(ctx: Ctx, session: Doc<"creativeSessions">) {
  const urls = imageUrlReader(ctx);
  const counted = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .order("desc")
    .take(BATCH_COUNT_CAP);

  let remix = undefined;
  if (session.remixOfWorkId) {
    const work = await ctx.db.get("works", session.remixOfWorkId);
    if (work) {
      const art = await urls(work.artKey);
      remix = {
        workId: work._id,
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title,
        artKey: work.artKey,
        artUrl: art.url,
        artThumbUrl: art.thumbUrl,
        backgroundColor: work.backgroundColor,
      };
    }
  }
  const newest = counted[0];
  let lastInputs = undefined;
  if (newest) {
    const images = [];
    for (const image of newest.images ?? []) {
      const { url, thumbUrl } = await urls(image.key);
      images.push({ imageId: image.imageId, url, thumbUrl });
    }
    const styles = [];
    for (const style of newest.styles ?? []) {
      const { url, thumbUrl } = await urls(style.key);
      styles.push({ imageId: style.imageId, url, thumbUrl, weight: style.weight });
    }
    const legacy = !newest.images && !newest.styles;
    lastInputs = {
      instruction: newest.instruction,
      backgroundColor: newest.backgroundColor,
      images,
      styles,
      legacyKey: legacy ? newest.inspirationKey : undefined,
      legacyUrl: legacy ? publicUrl(newest.inspirationKey) : undefined,
    };
  }
  return {
    sessionId: session._id,
    title: session.title,
    name: sessionName({
      title: session.title,
      remixCr: remix?.cr,
      firstInstruction: await firstInstruction(ctx, session._id),
    }),
    createdAt: session._creationTime,
    remix,
    batchCount: counted.length,
    lastInputs,
  };
}

// The member's own session, or null (signed out, a bad id, or someone else's).
async function ownSession(ctx: Ctx, sessionId: string) {
  const user = await getViewerUser(ctx);
  if (!user) return null;
  const id = ctx.db.normalizeId("creativeSessions", sessionId);
  if (!id) return null;
  const found = await ctx.db.get("creativeSessions", id);
  return found && found.ownerId === user._id ? found : null;
}

// The member's latest session (the previous studio always reopened it).
export const current = query({
  args: {},
  returns: v.union(v.null(), sessionView),
  handler: async (ctx) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    const session = await latestSession(ctx, user._id);
    if (!session) return null;
    return await buildSessionView(ctx, session);
  },
});

// One session, by the id in the studio's address (?s=…). Null if it isn't the member's.
export const session = query({
  args: { sessionId: v.string() },
  returns: v.union(v.null(), sessionView),
  handler: async (ctx, args) => {
    const found = await ownSession(ctx, args.sessionId);
    return found ? await buildSessionView(ctx, found) : null;
  },
});

// A session's batches, newest first, a page at a time. Empty if the session isn't the member's.
// A new batch lands at the top of the first page, and in-flight designs update in place.
export const sessionBatches = query({
  args: { sessionId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(batchView),
  handler: async (ctx, args) => {
    const found = await ownSession(ctx, args.sessionId);
    if (!found) return EMPTY_PAGE;
    const result = await ctx.db
      .query("batches")
      .withIndex("by_session", (q) => q.eq("sessionId", found._id))
      .order("desc")
      .paginate(cappedPage(args.paginationOpts, 12));
    const urls = imageUrlReader(ctx);
    const page = [];
    for (const batch of result.page) page.push(await batchViewOf(ctx, urls, batch));
    return { ...result, page };
  },
});

const sessionCard = v.object({
  sessionId: v.id("creativeSessions"),
  name: v.string(),
  updatedAt: v.number(),
  // Counted up to BATCH_COUNT_CAP; the studio shows "100+" from there.
  batches: v.number(),
  // The newest finished designs, newest first: the original and its thumbnail.
  thumbs: v.array(v.object({ url: v.optional(v.string()), thumbUrl: v.optional(v.string()), backgroundColor: v.string() })),
});

// A session's card, or null for a session with no batches (opened, then left).
async function sessionCardOf(ctx: Ctx, urls: ReturnType<typeof imageUrlReader>, row: Doc<"creativeSessions">) {
  const batches = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", row._id))
    .order("desc")
    .take(BATCH_COUNT_CAP);
  if (batches.length === 0) return null;
  const thumbs = [];
  for (const batch of batches.slice(0, 6)) {
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .take(DESIGNS_PER_BATCH * 2);
    generations.sort((a, b) => a.index - b.index);
    for (const g of generations) {
      if (g.status === "succeeded" && g.fullKey && thumbs.length < 4) {
        const { url, thumbUrl } = await urls(g.fullKey);
        thumbs.push({ url, thumbUrl, backgroundColor: batch.backgroundColor });
      }
    }
    if (thumbs.length >= 4) break;
  }
  const first = [...batches].reverse().find((batch) => batch.instruction.trim())?.instruction;
  return {
    sessionId: row._id,
    name: sessionName({ title: row.title, remixCr: await remixCrOf(ctx, row), firstInstruction: first }),
    updatedAt: row.updatedAt,
    batches: batches.length,
    thumbs,
  };
}

// The member's sessions with work in them, most recently used first, a page at a time, for the
// blank studio. Sessions with no batches are left out, so a page can hold fewer cards than asked.
export const sessions = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(sessionCard),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return EMPTY_PAGE;
    const result = await ctx.db
      .query("creativeSessions")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .paginate(cappedPage(args.paginationOpts, 24));
    const urls = imageUrlReader(ctx);
    const page = [];
    for (const row of result.page) {
      const card = await sessionCardOf(ctx, urls, row);
      if (card) page.push(card);
    }
    return { ...result, page };
  },
});

export const renameSession = mutation({
  args: { sessionId: v.id("creativeSessions"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const found = await ctx.db.get("creativeSessions", args.sessionId);
    if (!found || found.ownerId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found." });
    }
    const title = args.title.replace(/\s+/gu, " ").trim().slice(0, SESSION_TITLE_MAX);
    await ctx.db.patch("creativeSessions", found._id, { title: title || undefined });
    return null;
  },
});

export async function requireMember(ctx: MutationCtx) {
  const user = await getViewerUser(ctx);
  if (!user) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
  if (!user.username) {
    throw new ConvexError({ code: "NEEDS_USERNAME", message: "Pick a username first." });
  }
  return user;
}

export const newSession = mutation({
  args: {},
  returns: v.id("creativeSessions"),
  handler: async (ctx) => {
    const user = await requireMember(ctx);
    return await ctx.db.insert("creativeSessions", {
      ownerId: user._id,
      updatedAt: Date.now(),
      phrase: "",
      styleDirection: "",
      presets: [],
    });
  },
});

// Opens a remix session on a published work; the studio then uses the work's
// art and background color as the inspiration.
export const startRemix = mutation({
  // fresh: always a new session (the studio's remix links); otherwise the latest session
  // remixing this work is reused.
  args: { cr: v.string(), fresh: v.optional(v.boolean()) },
  returns: v.object({
    sessionId: v.id("creativeSessions"),
    artKey: v.optional(v.string()),
    artUrl: v.optional(v.string()),
    artThumbUrl: v.optional(v.string()),
    backgroundColor: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const parsed = parseCr(args.cr);
    if (!parsed) throw new ConvexError({ code: "NOT_FOUND", message: "No such CR number." });
    const work = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) =>
        q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
      )
      .unique();
    if (!work || work.status !== "published") {
      throw new ConvexError({ code: "NOT_FOUND", message: "That design is not published." });
    }
    const art = await imageUrlReader(ctx)(work.artKey);
    const result = {
      artKey: work.artKey,
      artUrl: art.url,
      artThumbUrl: art.thumbUrl,
      backgroundColor: work.backgroundColor,
    };
    const existing = await latestSession(ctx, user._id);
    if (!args.fresh && existing && existing.remixOfWorkId === work._id) {
      await ctx.db.patch("creativeSessions", existing._id, { updatedAt: Date.now() });
      return { sessionId: existing._id, ...result };
    }
    const sessionId = await ctx.db.insert("creativeSessions", {
      ownerId: user._id,
      updatedAt: Date.now(),
      phrase: "",
      styleDirection: "",
      presets: [],
      remixOfWorkId: work._id,
      remixMode: "variation",
    });
    return { sessionId, ...result };
  },
});

export const generate = mutation({
  args: {
    // The session to add the batch to (from the studio's address). Without it, a new session
    // starts; pages from the previous studio send nothing and keep using their latest session.
    sessionId: v.optional(v.id("creativeSessions")),
    newSession: v.optional(v.boolean()),
    instruction: v.string(),
    backgroundColor: v.string(),
    // The studio's numbered images in order, and its style mix (a 0-100 slider per style).
    images: v.optional(v.array(v.id("userImages"))),
    styles: v.optional(v.array(v.object({ imageId: v.id("userImages"), weight: v.number() }))),
    // Sent by pages still running the previous studio until they reload.
    presets: v.optional(v.array(v.string())),
    inspirationKey: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ batchId: v.id("batches"), sessionId: v.id("creativeSessions") }),
    v.object({
      refused: v.union(v.literal("NO_CREDITS"), v.literal("GENERATION_OFF"), v.literal("BUDGET")),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const instruction = args.instruction.trim().slice(0, 600);
    const imageIds = args.images ?? [];
    const styleArgs = args.styles ?? [];
    if (imageIds.length > MAX_IMAGES || styleArgs.length > MAX_STYLES) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Use up to ${MAX_IMAGES} images and ${MAX_STYLES} styles.`,
      });
    }
    if (
      new Set(imageIds).size !== imageIds.length ||
      new Set(styleArgs.map((s) => s.imageId)).size !== styleArgs.length
    ) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Each image can be added once." });
    }
    const load = async (imageId: Id<"userImages">) => {
      const image = await ctx.db.get("userImages", imageId);
      if (!image || image.ownerId !== user._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "That image is not available." });
      }
      return image;
    };
    const images = [];
    for (const imageId of imageIds) {
      const image = await load(imageId);
      images.push({ imageId: image._id, key: image.key });
    }
    const styles = [];
    for (const style of styleArgs) {
      if (!Number.isFinite(style.weight) || style.weight < 0 || style.weight > 100) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "Style sliders go from 0 to 100." });
      }
      const image = await load(style.imageId);
      styles.push({ imageId: image._id, key: image.key, weight: Math.round(style.weight) });
    }
    const styleOnly = styles.filter((s) => s.weight > 0 && !imageIds.includes(s.imageId));
    // The previous studio's one image, used as it was: no notes and no style mix.
    const legacyKey = images.length === 0 && styles.length === 0 ? args.inspirationKey : undefined;
    if (legacyKey && !isImageKey(legacyKey) && !(isDevDeployment() && legacyKey.startsWith("fake:"))) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "That image did not upload." });
    }
    const presets = (args.presets ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6);
    const attached = images.length + styleOnly.length + (legacyKey ? 1 : 0);
    if (!instruction && attached === 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Say what to make, or add an image.",
      });
    }
    if (!HEX.test(args.backgroundColor)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Pick a background color." });
    }
    if (!(await flagEnabled(ctx, "gen.vercel"))) return { refused: "GENERATION_OFF" as const };
    const owner = isOwner(user);
    const chatgpt = Boolean(process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID);
    const forced = process.env.IMAGE_PROVIDER;
    const provider = forced === "gateway" || forced === "chatgpt" ? forced : chatgpt ? "chatgpt" : "gateway";
    // A grid (one call cut into four) on the gateway; the ChatGPT path and STUDIO_LAYOUT=single
    // make four separate designs, charged one credit each.
    const layout = provider === "gateway" && process.env.STUDIO_LAYOUT !== "single" ? "grid" : "single";
    const price = layout === "grid" ? BATCH_CREDITS : DESIGNS_PER_BATCH;
    if (!owner && (await creditBalance(ctx, user._id)) < price) {
      return { refused: "NO_CREDITS" as const };
    }
    // The daily budget (convex/lib/budget.ts): the batch's worst case must fit in what's left of
    // the gateway's UTC day, all four designs or none. The owner counts too.
    const now = Date.now();
    const designCents = provider === "gateway"
      ? layout === "grid"
        ? gridWorstCaseCents(attached, qualityOf(process.env.GRID_QUALITY, "high"))
        : singleWorstCaseCents(attached, qualityOf(process.env.IMAGE_QUALITY, "medium"))
      : 0;
    const batchCents = layout === "grid" ? designCents : designCents * DESIGNS_PER_BATCH;
    if (batchCents > 0 && !(await hasRoom(ctx, "gateway", batchCents, now))) {
      return { refused: "BUDGET" as const };
    }
    let session: Doc<"creativeSessions"> | null = null;
    if (args.sessionId) {
      session = await ctx.db.get("creativeSessions", args.sessionId);
      if (!session || session.ownerId !== user._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Session not found." });
      }
    } else if (!args.newSession) {
      session = await latestSession(ctx, user._id);
    }
    if (!session) {
      const sessionId = await ctx.db.insert("creativeSessions", {
        ownerId: user._id,
        updatedAt: now,
        phrase: instruction,
        styleDirection: "",
        presets: [],
      });
      session = (await ctx.db.get("creativeSessions", sessionId))!;
    }
    const inspirationKey = images[0]?.key ?? legacyKey;
    // The batch's number in its session, which names its folder (batch-01, batch-02, ...).
    const batchNumber = (session.batchCount ?? (await countBatches(ctx, session._id))) + 1;
    const operation = session.remixOfWorkId ? "remix" : attached > 0 ? "edit" : "create";
    const model = provider === "chatgpt"
      ? (process.env.CHATGPT_IMAGE_MODEL ?? "gpt-5.5")
      : attached > 0
        ? MODEL_EDIT
        : MODEL_TEXT;
    const batchId = await ctx.db.insert("batches", {
      sessionId: session._id,
      ownerId: user._id,
      instruction,
      presets,
      inspirationKey,
      images: legacyKey ? undefined : images,
      styles: legacyKey ? undefined : styles,
      backgroundColor: args.backgroundColor.toLowerCase(),
      operation,
      model,
      count: DESIGNS_PER_BATCH,
      layout,
      charged: layout === "grid" && !owner ? BATCH_CREDITS : undefined,
      number: batchNumber,
    });
    if (layout === "grid" && !owner) {
      await ctx.db.insert("creditLedger", { userId: user._id, kind: "settle", amount: -BATCH_CREDITS, batchId });
    }
    if (layout === "grid" && designCents > 0) {
      await openReservation(ctx, {
        attemptKind: "batch",
        attemptId: batchId,
        batchId,
        provider: "gateway",
        userId: user._id,
        credits: owner ? 0 : BATCH_CREDITS,
        worstCaseCents: designCents,
      }, now);
    }
    for (let index = 0; index < DESIGNS_PER_BATCH; index++) {
      const generationId = await ctx.db.insert("generations", {
        sessionId: session._id,
        batchId,
        ownerId: user._id,
        index,
        kind: operation === "create" ? "concept" : operation,
        status: "queued",
        provider,
        model,
        // Grid designs are charged with their batch.
        charged: layout === "single" && !owner,
        favorite: false,
      });
      if (layout === "single") {
        if (!owner) await ctx.db.insert("creditLedger", { userId: user._id, kind: "settle", amount: -1, generationId });
        if (designCents > 0) {
          await openReservation(ctx, {
            attemptKind: "tile",
            attemptId: generationId,
            generationId,
            provider: "gateway",
            userId: user._id,
            credits: owner ? 0 : 1,
            worstCaseCents: designCents,
          }, now);
        }
        await ctx.scheduler.runAfter(0, internal.imageGen.runTile, { generationId });
      }
    }
    if (layout === "grid") await ctx.scheduler.runAfter(0, internal.imageGen.runBatch, { batchId });
    for (const image of images) await ctx.db.patch("userImages", image.imageId, { usedAt: now });
    for (const style of styles) {
      await ctx.db.patch("userImages", style.imageId, { usedAt: now, styleAt: now });
    }
    await ctx.db.patch("creativeSessions", session._id, {
      updatedAt: now,
      phrase: instruction,
      batchCount: batchNumber,
    });
    return { batchId, sessionId: session._id };
  },
});

// How many batches a session has (sessions from before batch numbers are counted once).
async function countBatches(ctx: QueryCtx, sessionId: Id<"creativeSessions">) {
  const batches = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  return batches.length;
}

export const toggleFavorite = mutation({
  args: { generationId: v.id("generations") },
  returns: v.object({ favorite: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tile not found." });
    }
    if (generation.status !== "succeeded") {
      throw new ConvexError({ code: "NOT_READY", message: "That tile is not ready." });
    }
    const favorite = !generation.favorite;
    await ctx.db.patch("generations", generation._id, {
      favorite,
      favoritedAt: favorite ? Date.now() : undefined,
    });
    return { favorite };
  },
});

// ---- Internal steps used by imageGen.runTile and imageGen.runBatch ----

const attachmentView = v.object({
  key: v.string(),
  styleOnly: v.boolean(),
  analysis: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
  summary: v.optional(v.string()),
  kind: v.optional(v.union(v.literal("photo"), v.literal("art"))),
  notes: v.optional(v.string()),
});

const jobInputs = {
  instruction: v.string(),
  presets: v.array(v.string()),
  model: v.string(),
  provider: v.string(),
  remixOfParent: v.boolean(),
  // Every image sent with the call: the numbered images, then images added only as styles.
  attachments: v.array(attachmentView),
  // Each style's 1-based attachment number and slider value.
  styles: v.array(v.object({ attachment: v.number(), weight: v.number() })),
  place: v.object({
    memberId: v.id("users"),
    sessionId: v.id("creativeSessions"),
    sessionStartedAt: v.number(),
    batchNumber: v.number(),
  }),
};

// What a batch's prompt is built from.
async function batchInputs(ctx: QueryCtx, batch: Doc<"batches">) {
  const session = await ctx.db.get("creativeSessions", batch.sessionId);
  // A remix keeps the parent's look only while the parent is still the reference image.
  let remixOfParent = false;
  if (batch.operation === "remix" && batch.inspirationKey) {
    const parent = session?.remixOfWorkId ? await ctx.db.get("works", session.remixOfWorkId) : null;
    remixOfParent = parent?.artKey === batch.inspirationKey;
  }
  const describe = async (imageId: Id<"userImages">, key: string, styleOnly: boolean) => {
    const image = await ctx.db.get("userImages", imageId);
    return {
      key,
      styleOnly,
      analysis: image?.analysis,
      summary: image?.summary,
      kind: image?.kind,
      notes: image?.notes,
    };
  };
  const attachments: Array<Infer<typeof attachmentView>> = [];
  const styles: Array<{ attachment: number; weight: number }> = [];
  if (batch.images || batch.styles) {
    const workIds = (batch.images ?? []).map((image) => image.imageId);
    for (const image of batch.images ?? []) attachments.push(await describe(image.imageId, image.key, false));
    for (const style of batch.styles ?? []) {
      if (style.weight <= 0) continue;
      let index = workIds.indexOf(style.imageId);
      if (index < 0) {
        attachments.push(await describe(style.imageId, style.key, true));
        index = attachments.length - 1;
      }
      styles.push({ attachment: index + 1, weight: style.weight });
    }
  } else if (batch.inspirationKey) {
    attachments.push({ key: batch.inspirationKey, styleOnly: false });
  }
  // Where the batch's files go (convex/lib/sizes.ts batchFolder).
  const place = {
    memberId: batch.ownerId,
    sessionId: batch.sessionId,
    sessionStartedAt: session?._creationTime ?? batch._creationTime,
    batchNumber: batch.number ?? (await batchNumberOf(ctx, batch)),
  };
  return { instruction: batch.instruction, presets: batch.presets, remixOfParent, attachments, styles, place };
}

// A batch's number from its position in its session (for batches made before batches had numbers).
export async function batchNumberOf(ctx: QueryCtx, batch: Doc<"batches">) {
  const earlier = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", batch.sessionId).lte("_creationTime", batch._creationTime))
    .collect();
  return earlier.length;
}

export const tileJob = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(v.null(), v.object({ status: tileStatus, index: v.number(), ...jobInputs })),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation) return null;
    const batch = await ctx.db.get("batches", generation.batchId);
    if (!batch) return null;
    return {
      status: generation.status,
      index: generation.index,
      model: generation.model,
      provider: generation.provider,
      ...(await batchInputs(ctx, batch)),
    };
  },
});

export const batchJob = internalQuery({
  args: { batchId: v.id("batches") },
  returns: v.union(
    v.null(),
    v.object({
      ...jobInputs,
      // The batch's four designs, in grid order (top left, top right, bottom left, bottom right).
      tiles: v.array(v.object({ generationId: v.id("generations"), index: v.number(), status: tileStatus })),
    }),
  ),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get("batches", args.batchId);
    if (!batch) return null;
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    if (generations.length === 0) return null;
    generations.sort((a, b) => a.index - b.index);
    return {
      model: generations[0].model,
      provider: generations[0].provider,
      ...(await batchInputs(ctx, batch)),
      tiles: generations.map((g) => ({ generationId: g._id, index: g.index, status: g.status })),
    };
  },
});

// Claims a grid batch's designs for one runBatch; false if they're already claimed or generation
// is paused (then the batch fails and its credits come back).
export const markBatchDispatched = internalMutation({
  args: { batchId: v.id("batches") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    if (generations.length === 0 || generations.some((g) => g.status !== "queued")) return false;
    if (!(await flagEnabled(ctx, "gen.vercel"))) {
      await settleBatch(ctx, args.batchId, generations.map((g) => ({ index: g.index, error: "Generation is paused." })));
      await closeReservation(ctx, args.batchId, { kind: "release", reason: "paused" });
      return false;
    }
    const now = Date.now();
    // Its reservation must still be open (the sweeper may have released it).
    if (!(await authorizeDispatch(ctx, args.batchId, now))) return false;
    for (const g of generations) await ctx.db.patch("generations", g._id, { status: "dispatched", dispatchedAt: now });
    return true;
  },
});

const designResult = v.object({
  index: v.number(),
  design: v.optional(
    v.object({ fullKey: v.string(), sha256: v.optional(v.string()), width: v.number(), height: v.number(), hasAlpha: v.boolean() }),
  ),
  error: v.optional(v.string()),
});

// Records a grid batch's four results and gives back credits for missing designs
// (convex/lib/studioRules.ts).
export async function settleBatch(
  ctx: MutationCtx,
  batchId: Id<"batches">,
  results: Array<Infer<typeof designResult>>,
  extra: {
    gridKey?: string;
    roles?: Array<ImageRole>;
    // What a missing design becomes: failed, or (when the call may have run) unknown_outcome, or
    // (when it never started) expired. Credits come back the same way for all three.
    missingStatus?: "failed" | "unknown_outcome" | "expired";
  } = {},
) {
  const batch = await ctx.db.get("batches", batchId);
  if (!batch) return;
  const generations = await ctx.db
    .query("generations")
    .withIndex("by_batch", (q) => q.eq("batchId", batchId))
    .collect();
  const now = Date.now();
  let missing = 0;
  for (const g of generations) {
    if (g.status !== "dispatched" && g.status !== "queued") continue;
    const result = results.find((r) => r.index === g.index);
    if (result?.design) {
      await ctx.db.patch("generations", g._id, { status: "succeeded", finishedAt: now, ...result.design });
    } else {
      missing++;
      await ctx.db.patch("generations", g._id, {
        status: extra.missingStatus ?? "failed",
        finishedAt: now,
        error: (result?.error ?? "No design came back.").slice(0, 300),
      });
    }
  }
  const refund = batch.charged ? Math.min(creditsBack(missing), batch.charged - (batch.refunded ?? 0)) : 0;
  if (refund > 0) {
    await ctx.db.insert("creditLedger", { userId: batch.ownerId, kind: "refund_credit", amount: refund, batchId });
  }
  await ctx.db.patch("batches", batchId, {
    ...(refund > 0 ? { refunded: (batch.refunded ?? 0) + refund } : {}),
    ...(extra.gridKey ? { gridKey: extra.gridKey } : {}),
    ...(extra.roles ? { roles: extra.roles } : {}),
  });
}

export const finishBatch = internalMutation({
  args: {
    batchId: v.id("batches"),
    results: v.array(designResult),
    gridKey: v.optional(v.string()),
    roles: v.optional(v.array(v.union(v.literal("content"), v.literal("style"), v.literal("both")))),
    // What the grid call cost (convex/lib/paidAttempts.ts); without it, the batch's reservation
    // settles at its worst case. unknown: the call may have run, so missing designs are unknown_outcome.
    spend: v.optional(spendValidator),
    unknown: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await settleBatch(ctx, args.batchId, args.results, {
      gridKey: args.gridKey,
      roles: args.roles,
      missingStatus: args.unknown ? "unknown_outcome" : undefined,
    });
    await closeReservation(ctx, args.batchId, args.spend ?? { kind: "settle" });
    return null;
  },
});


export const markDispatched = internalMutation({
  args: { generationId: v.id("generations") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.status !== "queued") return false;
    if (!(await flagEnabled(ctx, "gen.vercel"))) {
      await failAndRefund(ctx, generation, "Generation is paused.");
      await closeReservation(ctx, generation._id, { kind: "release", reason: "paused" });
      return false;
    }
    const now = Date.now();
    if (!(await authorizeDispatch(ctx, generation._id, now))) return false;
    await ctx.db.patch("generations", generation._id, {
      status: "dispatched",
      dispatchedAt: now,
    });
    return true;
  },
});

export const markSucceeded = internalMutation({
  args: {
    generationId: v.id("generations"),
    fullKey: v.string(),
    sha256: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    hasAlpha: v.boolean(),
    spend: v.optional(spendValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.status !== "dispatched") return null;
    await closeReservation(ctx, generation._id, args.spend ?? { kind: "settle" });
    await ctx.db.patch("generations", generation._id, {
      status: "succeeded",
      finishedAt: Date.now(),
      fullKey: args.fullKey,
      sha256: args.sha256,
      width: args.width,
      height: args.height,
      hasAlpha: args.hasAlpha,
    });
    return null;
  },
});

export async function failAndRefund(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  error: string,
  status: "failed" | "unknown_outcome" | "expired" = "failed",
) {
  await ctx.db.patch("generations", generation._id, {
    status,
    finishedAt: Date.now(),
    error,
  });
  if (generation.charged) {
    await ctx.db.insert("creditLedger", {
      userId: generation.ownerId,
      kind: "refund_credit",
      amount: 1,
      generationId: generation._id,
    });
  }
}

export const markFailed = internalMutation({
  args: {
    generationId: v.id("generations"),
    error: v.string(),
    // As in finishBatch.
    spend: v.optional(spendValidator),
    unknown: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || (generation.status !== "dispatched" && generation.status !== "queued")) {
      return null;
    }
    await failAndRefund(ctx, generation, args.error.slice(0, 300), args.unknown ? "unknown_outcome" : "failed");
    await closeReservation(ctx, generation._id, args.spend ?? { kind: "settle" });
    return null;
  },
});
