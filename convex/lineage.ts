import { ConvexError,  v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { imageUrlReader } from "./lib/imageUrls";
import { workHeartCount } from "./lib/social";
import { formatCr, parseCr } from "./lib/r2";
import { LineageError, MAX_TRAIL, effectiveAncestors, effectiveOf, validateAmendment } from "./lib/lineage";
import { amendmentStatusValidator, workKindValidator } from "./schema/lineage";
import type {Infer} from "convex/values";
import type { LineageWork, WorkKind } from "./lib/lineage";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------------------------
// Shared helpers (also used by convex/workEconomics.ts)

export function toLineageWork(work: Doc<"works">): LineageWork {
  return {
    id: work._id,
    family: work.crFamily,
    expression: work.crExpression,
    creator: work.creatorId,
    kind: work.kind,
    parentId: work.parentWorkId,
    effectiveKind: work.effectiveKind,
    effectiveParentId: work.effectiveParentWorkId,
    registered: work.status === "published" || work.status === "withdrawn",
  };
}

// One cached reader per function call: each work is read once however often a walk meets it.
export function worksReader(ctx: Ctx) {
  const cache = new Map<string, Promise<Doc<"works"> | null>>();
  const doc = (id: string) => {
    let found = cache.get(id);
    if (!found) {
      const workId = ctx.db.normalizeId("works", id);
      found = workId ? ctx.db.get("works", workId) : Promise.resolve(null);
      cache.set(id, found);
    }
    return found;
  };
  return {
    doc,
    load: async (id: string) => {
      const work = await doc(id);
      return work ? toLineageWork(work) : null;
    },
    familyRoot: async (family: number) => {
      const root = await ctx.db
        .query("works")
        .withIndex("by_family_expression", (q) => q.eq("crFamily", family).eq("crExpression", 1))
        .unique();
      return root ? toLineageWork(root) : null;
    },
  };
}

export async function workByCr(ctx: Ctx, cr: string) {
  const parsed = parseCr(cr);
  if (!parsed) return null;
  return await ctx.db
    .query("works")
    .withIndex("by_family_expression", (q) =>
      q.eq("crFamily", parsed.family).eq("crExpression", parsed.expression),
    )
    .unique();
}

const crOf = (work: Doc<"works">) => formatCr(work.crFamily, work.crExpression);

async function usernameOf(ctx: Ctx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  return user?.username ?? "member";
}

// Chain writes are off unless the flag row exists and is on (unlike generation flags).
export async function chainWritesOn(ctx: Ctx) {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", "chain.writes"))
    .unique();
  return row?.enabled === true;
}

// Correcting lineage: the owner and ops admins (V1 plan authorization matrix).
async function requireLineageAdmin(ctx: Ctx) {
  const user = await getViewerUser(ctx);
  if (!user) throw new ConvexError({ code: "SIGNED_OUT", message: "Sign in first." });
  if (user.platformRole !== "super_admin_owner" && user.platformRole !== "super_admin_ops") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only admins can correct lineage." });
  }
  return user;
}

// ---------------------------------------------------------------------------------------------
// Work page: lineage trail, amendment notes, direct remixes, family

const trailStep = v.object({
  cr: v.string(),
  title: v.optional(v.string()),
  username: v.string(),
  family: v.number(),
  // How the work below it got here.
  via: v.union(v.literal("variation"), v.literal("fork")),
  published: v.boolean(),
});

const historyItem = v.object({
  sequence: v.number(),
  status: amendmentStatusValidator,
  fromKind: workKindValidator,
  fromParentCr: v.optional(v.string()),
  newKind: workKindValidator,
  newParentCr: v.optional(v.string()),
  reason: v.string(),
  requestedAt: v.number(),
  effectiveFrom: v.optional(v.number()),
  offchainOnly: v.boolean(),
});

async function crById(ctx: Ctx, id: Id<"works"> | undefined) {
  if (!id) return undefined;
  const work = await ctx.db.get("works", id);
  return work ? crOf(work) : undefined;
}

async function historyOf(ctx: Ctx, workId: Id<"works">, limit: number) {
  const rows = await ctx.db
    .query("lineageAmendments")
    .withIndex("by_work_sequence", (q) => q.eq("workId", workId))
    .order("desc")
    .take(limit);
  return await Promise.all(
    rows.map(async (row) => ({
      sequence: row.sequence,
      status: row.status,
      fromKind: row.fromKind,
      fromParentCr: await crById(ctx, row.fromParentId),
      newKind: row.newKind,
      newParentCr: await crById(ctx, row.newParentId),
      reason: row.reason,
      requestedAt: row.requestedAt,
      effectiveFrom: row.effectiveFrom,
      offchainOnly: row.offchainOnly === true,
    })),
  );
}

// The work's effective lineage: each ancestor up to the family root and across forks to the
// origin, nearest first, plus its correction history (confirmed and pending; never rejected).
export const trail = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: workKindValidator,
      family: v.number(),
      steps: v.array(trailStep),
      truncated: v.boolean(),
      // The stored lineage is damaged (a loop or a missing work); the trail stops there.
      broken: v.boolean(),
      amended: v.boolean(),
      pending: v.boolean(),
      history: v.array(historyItem),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await workByCr(ctx, args.cr);
    if (!work || work.status !== "published") return null;
    const reader = worksReader(ctx);
    let steps: Awaited<ReturnType<typeof effectiveAncestors>>["steps"] = [];
    let truncated = false;
    let broken = false;
    try {
      ({ steps, truncated } = await effectiveAncestors(toLineageWork(work), reader.load, MAX_TRAIL));
    } catch (error) {
      if (!(error instanceof LineageError)) throw error;
      broken = true;
    }
    const usernames = new Map<string, Promise<string>>();
    const nameOf = (id: Id<"users">) => {
      if (!usernames.has(id)) usernames.set(id, usernameOf(ctx, id));
      return usernames.get(id)!;
    };
    const shown = await Promise.all(
      steps.map(async (step) => {
        const doc = (await reader.doc(step.work.id))!;
        return {
          cr: crOf(doc),
          title: doc.title,
          username: await nameOf(doc.creatorId),
          family: doc.crFamily,
          via: step.via,
          published: doc.status === "published",
        };
      }),
    );
    const history = (await historyOf(ctx, work._id, 20)).filter((row) => row.status !== "rejected");
    return {
      kind: effectiveOf(toLineageWork(work)).kind,
      family: work.crFamily,
      steps: shown,
      truncated,
      broken,
      amended: work.effectiveKind !== undefined,
      pending: history.some((row) => row.status === "requested" || row.status === "submitted"),
      history,
    };
  },
});

const workCard = v.object({
  cr: v.string(),
  title: v.optional(v.string()),
  username: v.string(),
  kind: workKindValidator,
  backgroundColor: v.string(),
  artUrl: v.optional(v.string()),
});

async function toCard(ctx: Ctx, work: Doc<"works">, urls: ReturnType<typeof imageUrlReader>) {
  const art = await urls(work.artKey);
  return {
    cr: crOf(work),
    title: work.title,
    username: await usernameOf(ctx, work.creatorId),
    kind: effectiveOf(toLineageWork(work)).kind,
    backgroundColor: work.backgroundColor,
    artUrl: art.mediumUrl ?? art.url,
  };
}

// Published works whose effective parent is this work (variations and forks), oldest first.
export const directRemixes = query({
  args: { cr: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(workCard),
  handler: async (ctx, args) => {
    const work = await workByCr(ctx, args.cr);
    if (!work || work.status !== "published") return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("works")
      .withIndex("by_effectiveParent_status", (q) =>
        q.eq("effectiveParentWorkId", work._id).eq("status", "published"),
      )
      .paginate(args.paginationOpts);
    const urls = imageUrlReader(ctx);
    return { ...result, page: await Promise.all(result.page.map((child) => toCard(ctx, child, urls))) };
  },
});

const FAMILY_LIMIT = 48;

// The work's family by number: its root and every published expression, up to FAMILY_LIMIT.
export const family = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({ family: v.number(), works: v.array(workCard), more: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const work = await workByCr(ctx, args.cr);
    if (!work || work.status !== "published") return null;
    const rows = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) => q.eq("crFamily", work.crFamily))
      .take(FAMILY_LIMIT * 2);
    const published = rows.filter((row) => row.status === "published");
    const urls = imageUrlReader(ctx);
    return {
      family: work.crFamily,
      works: await Promise.all(published.slice(0, FAMILY_LIMIT).map((row) => toCard(ctx, row, urls))),
      more: published.length > FAMILY_LIMIT || rows.length === FAMILY_LIMIT * 2,
    };
  },
});

// The family tree (src/lib/familyTree.ts draws it). Withdrawn works stay in as bare CR numbers
// so their remixes keep their place.
const treeWork = v.object({
  cr: v.string(),
  family: v.number(),
  expression: v.number(),
  kind: workKindValidator,
  parentCr: v.optional(v.string()),
  withdrawn: v.boolean(),
  title: v.optional(v.string()),
  username: v.optional(v.string()),
  backgroundColor: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  remixes: v.optional(v.number()),
  remixesMore: v.optional(v.boolean()),
  hearts: v.optional(v.number()),
});

export const TREE_PAGE = 60;
export const TREE_MAX = 240;
// Direct remixes read per work: enough to count and to find its forks into other families.
export const TREE_CHILD_SCAN = 50;
export const TREE_FORKS = 60;

// A family's works in CR order (up to `limit`, raised by "show more"), each with its spread
// (published direct remixes, hearts), the forks out of it, and where it was forked from.
export const familyTree = query({
  args: { family: v.number(), limit: v.optional(v.number()) },
  returns: v.union(
    v.null(),
    v.object({
      family: v.number(),
      works: v.array(treeWork),
      forks: v.array(treeWork),
      origins: v.array(treeWork),
      more: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(TREE_MAX, Math.max(1, Math.floor(args.limit ?? TREE_PAGE)));
    // Designs still being prepared hold numbers too; read past them, within a bound.
    const rows = await ctx.db
      .query("works")
      .withIndex("by_family_expression", (q) => q.eq("crFamily", args.family))
      .take(limit * 2);
    const shown = rows.filter((row) => row.status === "published" || row.status === "withdrawn");
    if (!shown.some((row) => row.status === "published")) return null;
    const inTree = shown.slice(0, limit);
    const loaded = new Map(inTree.map((row) => [row._id as string, row]));
    const reader = worksReader(ctx);
    const urls = imageUrlReader(ctx);
    const usernames = new Map<string, Promise<string>>();
    const nameOf = (id: Id<"users">) => {
      if (!usernames.has(id)) usernames.set(id, usernameOf(ctx, id));
      return usernames.get(id)!;
    };

    const parentOf = async (row: Doc<"works">) => {
      const id = row.effectiveParentWorkId ?? row.parentWorkId;
      if (!id) return null;
      return loaded.get(id) ?? (await reader.doc(id));
    };
    const toTreeWork = async (row: Doc<"works">, parent: Doc<"works"> | null): Promise<Infer<typeof treeWork>> => {
      const base = {
        cr: crOf(row),
        family: row.crFamily,
        expression: row.crExpression,
        kind: effectiveOf(toLineageWork(row)).kind,
        parentCr: parent ? crOf(parent) : undefined,
        withdrawn: row.status !== "published",
      };
      if (row.status !== "published") return base;
      const art = await urls(row.artKey);
      return {
        ...base,
        title: row.title,
        username: await nameOf(row.creatorId),
        backgroundColor: row.backgroundColor,
        thumbUrl: art.thumbUrl ?? art.url,
      };
    };

    const forkRows: Array<Doc<"works">> = [];
    let forksMore = false;
    const works = await Promise.all(
      inTree.map(async (row) => {
        const [children, hearts, parent] = await Promise.all([
          ctx.db
            .query("works")
            .withIndex("by_effectiveParent_status", (q) =>
              q.eq("effectiveParentWorkId", row._id).eq("status", "published"),
            )
            .take(TREE_CHILD_SCAN + 1),
          workHeartCount(ctx, row._id),
          parentOf(row),
        ]);
        for (const child of children.slice(0, TREE_CHILD_SCAN)) {
          if (child.crFamily === args.family) continue;
          if (forkRows.length < TREE_FORKS) forkRows.push(child);
          else forksMore = true;
        }
        const node = await toTreeWork(row, parent);
        if (row.status !== "published") return { node, parent };
        return {
          node: {
            ...node,
            remixes: Math.min(children.length, TREE_CHILD_SCAN),
            remixesMore: children.length > TREE_CHILD_SCAN,
            hearts,
          },
          parent,
        };
      }),
    );

    // Where this family was forked from (normally just its original's parent).
    const originRows = new Map<string, Doc<"works">>();
    for (const { parent } of works) {
      if (parent && parent.crFamily !== args.family) originRows.set(parent._id, parent);
    }
    const origins = await Promise.all(
      [...originRows.values()].map((row) => toTreeWork(row, null)),
    );
    const forks = await Promise.all(forkRows.map((row) => toTreeWork(row, loaded.get(row.effectiveParentWorkId!) ?? null)));

    return {
      family: args.family,
      works: works.map((entry) => entry.node),
      forks,
      origins,
      more: shown.length > limit || rows.length === limit * 2 || forksMore,
    };
  },
});

// For the studio's publish dialog: the work a design remixes, so it can offer variation or fork.
export const publishOptions = query({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({ parentCr: v.string(), parentTitle: v.optional(v.string()), family: v.number() }),
  ),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    const generation = await ctx.db.get("generations", args.generationId);
    if (!generation || generation.ownerId !== user._id) return null;
    const session = await ctx.db.get("creativeSessions", generation.sessionId);
    if (!session?.remixOfWorkId) return null;
    const parent = await ctx.db.get("works", session.remixOfWorkId);
    if (!parent || parent.status !== "published") return null;
    return { parentCr: crOf(parent), parentTitle: parent.title, family: parent.crFamily };
  },
});

// ---------------------------------------------------------------------------------------------
// Amendments (offchain half; the chain engine calls the internal mutations below)

const OPEN = new Set(["requested", "submitted"]);

async function openAmendment(ctx: Ctx, workId: Id<"works">) {
  const recent = await ctx.db
    .query("lineageAmendments")
    .withIndex("by_work_sequence", (q) => q.eq("workId", workId))
    .order("desc")
    .take(20);
  return recent.find((row) => OPEN.has(row.status)) ?? null;
}

async function nextSequences(ctx: Ctx, workId: Id<"works">) {
  const recent = await ctx.db
    .query("lineageAmendments")
    .withIndex("by_work_sequence", (q) => q.eq("workId", workId))
    .order("desc")
    .take(200);
  const lastOnchain = recent.find((row) => row.status === "confirmed" && !row.offchainOnly);
  return { sequence: (recent[0]?.sequence ?? 0) + 1, chainSequence: (lastOnchain?.chainSequence ?? 0) + 1 };
}

async function refuseUnlessValid(
  ctx: Ctx,
  work: Doc<"works">,
  change: { newKind: WorkKind; newParentId?: Id<"works"> },
) {
  const result = await validateAmendment(toLineageWork(work), change, worksReader(ctx).load);
  if (!result.ok) throw new ConvexError({ code: result.code, message: result.message });
}

async function applyConfirmed(ctx: MutationCtx, row: Doc<"lineageAmendments">, at: number, offchainOnly: boolean) {
  await ctx.db.patch("works", row.workId, {
    effectiveKind: row.newKind,
    effectiveParentWorkId: row.newParentId,
    lineageAmendedAt: at,
  });
  await ctx.db.patch("lineageAmendments", row._id, {
    status: "confirmed",
    decidedAt: at,
    effectiveFrom: at,
    offchainOnly: offchainOnly || undefined,
  });
}

export const requestAmendment = mutation({
  args: {
    cr: v.string(),
    newKind: workKindValidator,
    newParentCr: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.id("lineageAmendments"),
  handler: async (ctx, args) => {
    const admin = await requireLineageAdmin(ctx);
    const reason = args.reason.replace(/\s+/gu, " ").trim().slice(0, 280);
    if (!reason) throw new ConvexError({ code: "NEEDS_REASON", message: "Say why it's being corrected." });
    const work = await workByCr(ctx, args.cr);
    if (!work) throw new ConvexError({ code: "NOT_FOUND", message: "No work has that CR number." });
    let newParentId: Id<"works"> | undefined;
    if (args.newParentCr?.trim()) {
      const parent = await workByCr(ctx, args.newParentCr);
      if (!parent) throw new ConvexError({ code: "parent_not_registered", message: "No work has the new parent's CR number." });
      newParentId = parent._id;
    }
    if (await openAmendment(ctx, work._id)) {
      throw new ConvexError({ code: "OPEN_AMENDMENT", message: "This work already has a correction in progress." });
    }
    await refuseUnlessValid(ctx, work, { newKind: args.newKind, newParentId });
    const current = effectiveOf(toLineageWork(work));
    const { sequence, chainSequence } = await nextSequences(ctx, work._id);
    return await ctx.db.insert("lineageAmendments", {
      workId: work._id,
      sequence,
      chainSequence,
      fromKind: current.kind,
      fromParentId: current.parentId as Id<"works"> | undefined,
      newKind: args.newKind,
      newParentId,
      reason,
      adminId: admin._id,
      status: "requested",
      requestedAt: Date.now(),
    });
  },
});

// While chain writes are off, an admin can make a requested correction effective directly. It is
// labeled offchain only: Monad doesn't have it.
export const confirmOffchain = mutation({
  args: { amendmentId: v.id("lineageAmendments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireLineageAdmin(ctx);
    if (await chainWritesOn(ctx)) {
      throw new ConvexError({ code: "CHAIN_ON", message: "Chain writes are on, so corrections confirm on Monad." });
    }
    const row = await ctx.db.get("lineageAmendments", args.amendmentId);
    if (!row || row.status !== "requested") {
      throw new ConvexError({ code: "NOT_REQUESTED", message: "Only a requested correction can be confirmed." });
    }
    const work = await ctx.db.get("works", row.workId);
    if (!work) throw new ConvexError({ code: "NOT_FOUND", message: "That work is gone." });
    const current = effectiveOf(toLineageWork(work));
    if (current.kind !== row.fromKind || current.parentId !== row.fromParentId) {
      throw new ConvexError({ code: "STALE", message: "The work's lineage changed since this was requested." });
    }
    await refuseUnlessValid(ctx, work, { newKind: row.newKind, newParentId: row.newParentId });
    await applyConfirmed(ctx, row, Date.now(), true);
    return null;
  },
});

// Withdraws a correction that hasn't been sent to Monad.
export const cancelAmendment = mutation({
  args: { amendmentId: v.id("lineageAmendments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireLineageAdmin(ctx);
    const row = await ctx.db.get("lineageAmendments", args.amendmentId);
    if (!row || row.status !== "requested") {
      throw new ConvexError({ code: "NOT_REQUESTED", message: "Only a requested correction can be cancelled." });
    }
    await ctx.db.patch("lineageAmendments", row._id, {
      status: "rejected",
      decidedAt: Date.now(),
      rejectReason: "cancelled",
    });
    return null;
  },
});

const adminAmendment = v.object({
  amendmentId: v.id("lineageAmendments"),
  cr: v.string(),
  sequence: v.number(),
  chainSequence: v.number(),
  status: amendmentStatusValidator,
  fromKind: workKindValidator,
  fromParentCr: v.optional(v.string()),
  newKind: workKindValidator,
  newParentCr: v.optional(v.string()),
  reason: v.string(),
  admin: v.string(),
  requestedAt: v.number(),
  decidedAt: v.optional(v.number()),
  offchainOnly: v.boolean(),
  rejectReason: v.optional(v.string()),
});

// The admin page: recent corrections, newest first, and whether chain writes are on.
export const adminHistory = query({
  args: {},
  returns: v.object({ chainWrites: v.boolean(), amendments: v.array(adminAmendment) }),
  handler: async (ctx) => {
    await requireLineageAdmin(ctx);
    const rows = await ctx.db.query("lineageAmendments").order("desc").take(50);
    const amendments = await Promise.all(
      rows.map(async (row) => ({
        amendmentId: row._id,
        cr: (await crById(ctx, row.workId)) ?? "?",
        sequence: row.sequence,
        chainSequence: row.chainSequence,
        status: row.status,
        fromKind: row.fromKind,
        fromParentCr: await crById(ctx, row.fromParentId),
        newKind: row.newKind,
        newParentCr: await crById(ctx, row.newParentId),
        reason: row.reason,
        admin: await usernameOf(ctx, row.adminId),
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
        offchainOnly: row.offchainOnly === true,
        rejectReason: row.rejectReason,
      })),
    );
    return { chainWrites: await chainWritesOn(ctx), amendments };
  },
});

// The admin page: a work's original and effective lineage before correcting it.
export const adminWork = query({
  args: { cr: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      cr: v.string(),
      title: v.optional(v.string()),
      username: v.string(),
      status: v.string(),
      family: v.number(),
      kind: workKindValidator,
      parentCr: v.optional(v.string()),
      effectiveKind: workKindValidator,
      effectiveParentCr: v.optional(v.string()),
      allowedKinds: v.array(workKindValidator),
      open: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireLineageAdmin(ctx);
    const work = await workByCr(ctx, args.cr);
    if (!work) return null;
    const effective = effectiveOf(toLineageWork(work));
    const allowedKinds: Array<WorkKind> =
      effective.kind === "variation" ? ["variation"] : ["original", "fork"];
    return {
      cr: crOf(work),
      title: work.title,
      username: await usernameOf(ctx, work.creatorId),
      status: work.status,
      family: work.crFamily,
      kind: work.kind,
      parentCr: await crById(ctx, work.parentWorkId),
      effectiveKind: effective.kind,
      effectiveParentCr: await crById(ctx, effective.parentId as Id<"works"> | undefined),
      allowedKinds,
      open: (await openAmendment(ctx, work._id)) !== null,
    };
  },
});

// For the chain engine: requested corrections waiting to be sent, oldest first.
export const requestedForChain = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      amendmentId: v.id("lineageAmendments"),
      workId: v.id("works"),
      chainSequence: v.number(),
      newKind: workKindValidator,
      newParentId: v.optional(v.id("works")),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("lineageAmendments")
      .withIndex("by_status", (q) => q.eq("status", "requested"))
      .take(Math.min(Math.max(args.limit ?? 20, 1), 100));
    return rows.map((row) => ({
      amendmentId: row._id,
      workId: row.workId,
      chainSequence: row.chainSequence,
      newKind: row.newKind,
      newParentId: row.newParentId,
      reason: row.reason,
    }));
  },
});

export const markSubmitted = internalMutation({
  args: { amendmentId: v.id("lineageAmendments"), chainWriteId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("lineageAmendments", args.amendmentId);
    if (!row) return false;
    if (row.status === "submitted" && row.chainWriteId === args.chainWriteId) return true;
    if (row.status !== "requested") return false;
    await ctx.db.patch("lineageAmendments", row._id, {
      status: "submitted",
      submittedAt: Date.now(),
      chainWriteId: args.chainWriteId,
    });
    return true;
  },
});

// The registry accepted it (finalized receipt), so it's effective from confirmedAt whatever the
// offchain state says now: the chain is the record.
export const markConfirmed = internalMutation({
  args: { amendmentId: v.id("lineageAmendments"), confirmedAt: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("lineageAmendments", args.amendmentId);
    if (!row) return false;
    if (row.status === "confirmed") return true;
    if (row.status !== "submitted") return false;
    await applyConfirmed(ctx, row, args.confirmedAt ?? Date.now(), false);
    return true;
  },
});

export const markRejected = internalMutation({
  args: { amendmentId: v.id("lineageAmendments"), reason: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("lineageAmendments", args.amendmentId);
    if (!row) return false;
    if (row.status === "rejected") return true;
    if (!OPEN.has(row.status)) return false;
    await ctx.db.patch("lineageAmendments", row._id, {
      status: "rejected",
      decidedAt: Date.now(),
      rejectReason: args.reason.slice(0, 500),
    });
    return true;
  },
});

// Works published before effective lineage existed get effectiveParentWorkId = parentWorkId, so
// they show up in their parent's direct remixes. Safe to rerun; returns the next cursor until done.
// bunx convex run lineage:backfillEffectiveParents (repeat with the returned cursor)
export const backfillEffectiveParents = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ updated: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("works").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const work of page.page) {
      if (work.parentWorkId && work.effectiveKind === undefined && work.effectiveParentWorkId === undefined) {
        await ctx.db.patch("works", work._id, { effectiveParentWorkId: work.parentWorkId });
        updated += 1;
      }
    }
    return { updated, cursor: page.isDone ? null : page.continueCursor };
  },
});
