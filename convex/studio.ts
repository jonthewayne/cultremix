import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { creditBalance, getViewerUser, isOwner } from "./identity";
import { isBlockedError, publicTileError } from "./lib/imageErrors";
import { styleShares } from "./lib/prompts";
import { formatCr, isDevDeployment, parseCr, publicUrl } from "./lib/r2";
import { SESSION_TITLE_MAX, sessionName } from "./lib/sessions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

export const TILES_PER_BATCH = 4;
export const MODEL_TEXT = "openai/gpt-image-2.5-flare";
export const MODEL_EDIT = "openai/gpt-image-2.5-sunburst";
// The studio's limits: numbered images to work on, and styles in the mixer.
export const MAX_IMAGES = 4;
export const MAX_STYLES = 3;
const HEX = /^#[0-9a-f]{6}$/iu;
export const IMAGE_KEY = /^((inspo|gen|art)\/[0-9a-f]{64}\.(png|jpg|webp)|cvx:[A-Za-z0-9_-]{8,64})$/u;

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
  url: v.optional(v.string()),
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
  images: v.array(v.object({ url: v.optional(v.string()) })),
  // The style mix as thumbnails and shares; what the styles were read as stays on the server.
  styles: v.array(v.object({ url: v.optional(v.string()), share: v.number() })),
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
      backgroundColor: v.string(),
    }),
  ),
  batches: v.array(batchView),
  favorites: v.array(v.id("generations")),
  // The newest batch's settings, so reopening a session picks up where it left off.
  lastInputs: v.optional(
    v.object({
      instruction: v.string(),
      backgroundColor: v.string(),
      images: v.array(v.object({ imageId: v.id("userImages"), url: v.optional(v.string()) })),
      styles: v.array(
        v.object({ imageId: v.id("userImages"), url: v.optional(v.string()), weight: v.number() }),
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

async function buildSessionView(ctx: Ctx, session: Doc<"creativeSessions">) {
  const batches = await ctx.db
    .query("batches")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .order("desc")
    .take(40);
  const published = new Map<string, string>();
  const myWorks = await ctx.db
    .query("works")
    .withIndex("by_creator", (q) => q.eq("creatorId", session.ownerId))
    .collect();
  for (const work of myWorks) {
    published.set(work.generationId, formatCr(work.crFamily, work.crExpression));
  }
  const batchViews = [];
  for (const batch of batches) {
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .collect();
    generations.sort((a, b) => a.index - b.index);
    const shares = styleShares((batch.styles ?? []).map((s) => s.weight));
    const styles = (batch.styles ?? [])
      .map((style, i) => ({ url: publicUrl(style.key), share: shares[i] }))
      .filter((style) => style.share > 0);
    batchViews.push({
      batchId: batch._id,
      createdAt: batch._creationTime,
      instruction: batch.instruction,
      presets: batch.presets,
      backgroundColor: batch.backgroundColor,
      inspirationUrl: publicUrl(batch.inspirationKey),
      images: (batch.images ?? []).map((image) => ({ url: publicUrl(image.key) })),
      styles,
      tiles: generations.map((g) => {
        const blocked = g.status === "failed" && isBlockedError(g.error);
        return {
          generationId: g._id,
          batchId: g.batchId,
          status: g.status,
          url: publicUrl(g.fullKey),
          key: g.fullKey,
          favorite: g.favorite,
          error: blocked ? undefined : publicTileError(g.error),
          blocked,
          backgroundColor: batch.backgroundColor,
          publishedCr: published.get(g._id),
        };
      }),
    });
  }
  const favorites = await ctx.db
    .query("generations")
    .withIndex("by_session_favorite", (q) =>
      q.eq("sessionId", session._id).eq("favorite", true),
    )
    .collect();

  let remix = undefined;
  if (session.remixOfWorkId) {
    const work = await ctx.db.get("works", session.remixOfWorkId);
    if (work) {
      remix = {
        workId: work._id,
        cr: formatCr(work.crFamily, work.crExpression),
        title: work.title,
        artKey: work.artKey,
        artUrl: publicUrl(work.artKey),
        backgroundColor: work.backgroundColor,
      };
    }
  }
  const newest = batches[0];
  const lastInputs = newest
    ? {
        instruction: newest.instruction,
        backgroundColor: newest.backgroundColor,
        images: (newest.images ?? []).map((image) => ({ imageId: image.imageId, url: publicUrl(image.key) })),
        styles: (newest.styles ?? []).map((style) => ({
          imageId: style.imageId,
          url: publicUrl(style.key),
          weight: style.weight,
        })),
        legacyKey: newest.images || newest.styles ? undefined : newest.inspirationKey,
        legacyUrl: newest.images || newest.styles ? undefined : publicUrl(newest.inspirationKey),
      }
    : undefined;
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
    batches: batchViews,
    favorites: favorites.map((g) => g._id),
    lastInputs,
  };
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
    const user = await getViewerUser(ctx);
    if (!user) return null;
    const sessionId = ctx.db.normalizeId("creativeSessions", args.sessionId);
    if (!sessionId) return null;
    const found = await ctx.db.get("creativeSessions", sessionId);
    if (!found || found.ownerId !== user._id) return null;
    return await buildSessionView(ctx, found);
  },
});

const sessionCard = v.object({
  sessionId: v.id("creativeSessions"),
  name: v.string(),
  updatedAt: v.number(),
  batches: v.number(),
  // The newest finished designs, newest first.
  thumbs: v.array(v.object({ url: v.optional(v.string()), backgroundColor: v.string() })),
});

// The member's sessions with work in them, most recently used first, for the blank studio.
export const sessions = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ sessions: v.array(sessionCard), more: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return { sessions: [], more: false };
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 12)), 60);
    const cards = [];
    let more = false;
    // Sessions with no batches (opened, then left) are skipped.
    for await (const row of ctx.db
      .query("creativeSessions")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", user._id))
      .order("desc")) {
      const batches = await ctx.db
        .query("batches")
        .withIndex("by_session", (q) => q.eq("sessionId", row._id))
        .order("desc")
        .take(100);
      if (batches.length === 0) continue;
      if (cards.length === limit) {
        more = true;
        break;
      }
      const thumbs = [];
      for (const batch of batches.slice(0, 6)) {
        const generations = await ctx.db
          .query("generations")
          .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
          .collect();
        generations.sort((a, b) => a.index - b.index);
        for (const g of generations) {
          if (g.status === "succeeded" && g.fullKey && thumbs.length < 4) {
            thumbs.push({ url: publicUrl(g.fullKey), backgroundColor: batch.backgroundColor });
          }
        }
        if (thumbs.length >= 4) break;
      }
      const first = [...batches].reverse().find((batch) => batch.instruction.trim())?.instruction;
      cards.push({
        sessionId: row._id,
        name: sessionName({ title: row.title, remixCr: await remixCrOf(ctx, row), firstInstruction: first }),
        updatedAt: row.updatedAt,
        batches: batches.length,
        thumbs,
      });
    }
    return { sessions: cards, more };
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
    const result = {
      artKey: work.artKey,
      artUrl: publicUrl(work.artKey),
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
      refused: v.union(v.literal("NO_CREDITS"), v.literal("GENERATION_OFF")),
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
    if (legacyKey && !IMAGE_KEY.test(legacyKey) && !(isDevDeployment() && legacyKey.startsWith("fake:"))) {
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
    if (!owner && (await creditBalance(ctx, user._id)) < TILES_PER_BATCH) {
      return { refused: "NO_CREDITS" as const };
    }

    const now = Date.now();
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
    const operation = session.remixOfWorkId ? "remix" : attached > 0 ? "edit" : "create";
    const chatgpt = Boolean(process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID);
    const forced = process.env.IMAGE_PROVIDER;
    const provider = forced === "gateway" || forced === "chatgpt" ? forced : chatgpt ? "chatgpt" : "gateway";
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
      count: TILES_PER_BATCH,
    });
    for (let index = 0; index < TILES_PER_BATCH; index++) {
      const generationId = await ctx.db.insert("generations", {
        sessionId: session._id,
        batchId,
        ownerId: user._id,
        index,
        kind: operation === "create" ? "concept" : operation,
        status: "queued",
        provider,
        model,
        charged: !owner,
        favorite: false,
      });
      if (!owner) {
        await ctx.db.insert("creditLedger", {
          userId: user._id,
          kind: "settle",
          amount: -1,
          generationId,
        });
      }
      await ctx.scheduler.runAfter(0, internal.imageGen.runTile, { generationId });
    }
    for (const image of images) await ctx.db.patch("userImages", image.imageId, { usedAt: now });
    for (const style of styles) {
      await ctx.db.patch("userImages", style.imageId, { usedAt: now, styleAt: now });
    }
    await ctx.db.patch("creativeSessions", session._id, {
      updatedAt: now,
      phrase: instruction,
    });
    return { batchId, sessionId: session._id };
  },
});

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

// ---- Internal steps used by imageGen.runTile ----

const attachmentView = v.object({
  key: v.string(),
  styleOnly: v.boolean(),
  analysis: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
  summary: v.optional(v.string()),
  kind: v.optional(v.union(v.literal("photo"), v.literal("art"))),
  notes: v.optional(v.string()),
});

export const tileJob = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({
      status: tileStatus,
      instruction: v.string(),
      presets: v.array(v.string()),
      model: v.string(),
      provider: v.string(),
      remixOfParent: v.boolean(),
      // Every image sent with the call: the numbered images, then images added only as styles.
      attachments: v.array(attachmentView),
      // Each style's 1-based attachment number and slider value.
      styles: v.array(v.object({ attachment: v.number(), weight: v.number() })),
    }),
  ),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation) return null;
    const batch = await ctx.db.get("batches", generation.batchId);
    if (!batch) return null;
    // A remix keeps the parent's look only while the parent is still the reference image.
    let remixOfParent = false;
    if (batch.operation === "remix" && batch.inspirationKey) {
      const session = await ctx.db.get("creativeSessions", batch.sessionId);
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
    return {
      status: generation.status,
      instruction: batch.instruction,
      presets: batch.presets,
      model: generation.model,
      provider: generation.provider,
      remixOfParent,
      attachments,
      styles,
    };
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
      return false;
    }
    await ctx.db.patch("generations", generation._id, {
      status: "dispatched",
      dispatchedAt: Date.now(),
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.status !== "dispatched") return null;
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

async function failAndRefund(ctx: MutationCtx, generation: Doc<"generations">, error: string) {
  await ctx.db.patch("generations", generation._id, {
    status: "failed",
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
  args: { generationId: v.id("generations"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || (generation.status !== "dispatched" && generation.status !== "queued")) {
      return null;
    }
    await failAndRefund(ctx, generation, args.error.slice(0, 300));
    return null;
  },
});
