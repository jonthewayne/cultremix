import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { creditBalance, getViewerUser, isOwner } from "./identity";
import { formatCr, isDevDeployment, parseCr, publicUrl } from "./lib/r2";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

export const TILES_PER_BATCH = 4;
export const MODEL_TEXT = "openai/gpt-image-2.5-flare";
export const MODEL_EDIT = "openai/gpt-image-2.5-sunburst";
const HEX = /^#[0-9a-f]{6}$/iu;
const IMAGE_KEY = /^(inspo|gen|art)\/[0-9a-f]{64}\.(png|jpg|webp)$/u;

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
  error: v.optional(v.string()),
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
  tiles: v.array(tileView),
});

const sessionView = v.object({
  sessionId: v.id("creativeSessions"),
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
    batchViews.push({
      batchId: batch._id,
      createdAt: batch._creationTime,
      instruction: batch.instruction,
      presets: batch.presets,
      backgroundColor: batch.backgroundColor,
      inspirationUrl: publicUrl(batch.inspirationKey),
      tiles: generations.map((g) => ({
        generationId: g._id,
        batchId: g.batchId,
        status: g.status,
        url: publicUrl(g.fullKey),
        key: g.fullKey,
        favorite: g.favorite,
        error: g.error,
        backgroundColor: batch.backgroundColor,
        publishedCr: published.get(g._id),
      })),
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
  return {
    sessionId: session._id,
    remix,
    batches: batchViews,
    favorites: favorites.map((g) => g._id),
  };
}

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
  args: { cr: v.string() },
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
    if (existing && existing.remixOfWorkId === work._id) {
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
    instruction: v.string(),
    presets: v.array(v.string()),
    backgroundColor: v.string(),
    inspirationKey: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ batchId: v.id("batches") }),
    v.object({
      refused: v.union(v.literal("NO_CREDITS"), v.literal("GENERATION_OFF")),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    const instruction = args.instruction.trim().slice(0, 600);
    const presets = args.presets.map((p) => p.trim()).filter(Boolean).slice(0, 6);
    const inspirationKey = args.inspirationKey;
    if (!instruction && !inspirationKey) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Say what to make, or add an inspiration image.",
      });
    }
    if (!HEX.test(args.backgroundColor)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Pick a background color." });
    }
    if (
      inspirationKey &&
      !IMAGE_KEY.test(inspirationKey) &&
      !(isDevDeployment() && inspirationKey.startsWith("fake:"))
    ) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "That image did not upload." });
    }
    if (!(await flagEnabled(ctx, "gen.vercel"))) return { refused: "GENERATION_OFF" as const };
    const owner = isOwner(user);
    if (!owner && (await creditBalance(ctx, user._id)) < TILES_PER_BATCH) {
      return { refused: "NO_CREDITS" as const };
    }

    const now = Date.now();
    let session = await latestSession(ctx, user._id);
    if (!session) {
      const sessionId = await ctx.db.insert("creativeSessions", {
        ownerId: user._id,
        updatedAt: now,
        phrase: instruction,
        styleDirection: "",
        presets,
      });
      session = (await ctx.db.get("creativeSessions", sessionId))!;
    }
    const operation = session.remixOfWorkId ? "remix" : inspirationKey ? "edit" : "create";
    const model = inspirationKey ? MODEL_EDIT : MODEL_TEXT;
    const batchId = await ctx.db.insert("batches", {
      sessionId: session._id,
      ownerId: user._id,
      instruction,
      presets,
      inspirationKey,
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
        provider: "gateway",
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
    await ctx.db.patch("creativeSessions", session._id, {
      updatedAt: now,
      phrase: instruction,
      presets,
    });
    return { batchId };
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

export const tileJob = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({
      status: tileStatus,
      instruction: v.string(),
      presets: v.array(v.string()),
      inspirationKey: v.optional(v.string()),
      model: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation) return null;
    const batch = await ctx.db.get("batches", generation.batchId);
    if (!batch) return null;
    return {
      status: generation.status,
      instruction: batch.instruction,
      presets: batch.presets,
      inspirationKey: batch.inspirationKey,
      model: generation.model,
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
