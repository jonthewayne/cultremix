import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type NotificationKind = Doc<"notifications">["kind"];

// A second heart or follow from the same member within a day doesn't notify again.
export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const COLLAPSING: ReadonlySet<NotificationKind> = new Set(["heart", "follow"]);

// Tells a member that someone else did something to them or their work, in the same transaction
// as the thing itself. Nothing for your own actions. Returns the notification's id, or null.
export async function notify(
  ctx: MutationCtx,
  args: {
    recipientId: Id<"users">;
    actorId: Id<"users">;
    kind: NotificationKind;
    workId?: Id<"works">;
    at?: number;
  },
) {
  if (args.recipientId === args.actorId) return null;
  const createdAt = args.at ?? Date.now();
  if (COLLAPSING.has(args.kind)) {
    const previous = await ctx.db
      .query("notifications")
      .withIndex("by_repeat", (q) =>
        q
          .eq("recipientId", args.recipientId)
          .eq("actorId", args.actorId)
          .eq("kind", args.kind)
          .eq("workId", args.workId)
          .gt("createdAt", createdAt - REPEAT_WINDOW_MS),
      )
      .first();
    if (previous) return previous._id;
  }
  const id = await ctx.db.insert("notifications", {
    recipientId: args.recipientId,
    actorId: args.actorId,
    kind: args.kind,
    workId: args.workId,
    createdAt,
  });
  await bumpUnread(ctx, args.recipientId);
  return id;
}

async function bumpUnread(ctx: MutationCtx, userId: Id<"users">) {
  const state = await ctx.db
    .query("notificationState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (state) {
    await ctx.db.patch("notificationState", state._id, { unread: state.unread + 1 });
  } else {
    await ctx.db.insert("notificationState", { userId, unread: 1, lastReadAt: 0 });
  }
}

// How far up a remix's parents to look for the recipient's own design.
const MAX_LINEAGE_STEPS = 50;

// Tells a member that a work they share in sold: "Slow Roll CR 106-001 sold. You earn $4.20." Called
// by earnings (convex/earnings.ts) once per order, recipient, and work, when the order's sale rows
// are first written, so replays of the same order never notify twice. When the work sold isn't the
// recipient's, the notification also names the recipient's own design it was remixed from.
export async function notifySale(
  ctx: MutationCtx,
  args: {
    recipientId: Id<"users">;
    workId: Id<"works">;
    cents: number;
    units: number;
    test: boolean;
    at?: number;
  },
) {
  const work = await ctx.db.get("works", args.workId);
  if (!work) return null;
  let ownWorkId: Id<"works"> | undefined;
  if (work.creatorId !== args.recipientId) {
    let parentId = work.parentWorkId;
    for (let step = 0; parentId && step < MAX_LINEAGE_STEPS; step++) {
      const parent: Doc<"works"> | null = await ctx.db.get("works", parentId);
      if (!parent) break;
      if (parent.creatorId === args.recipientId) {
        ownWorkId = parent._id;
        break;
      }
      parentId = parent.parentWorkId;
    }
  }
  const id = await ctx.db.insert("notifications", {
    recipientId: args.recipientId,
    kind: "sale",
    workId: work._id,
    ownWorkId,
    sale: { cents: args.cents, units: args.units, test: args.test },
    createdAt: args.at ?? Date.now(),
  });
  await bumpUnread(ctx, args.recipientId);
  return id;
}

// The hook for Backs: call it from the mutation that records a back, once per back, and the work's
// creator sees "@backer backed your work". Backs don't collapse; each one notifies.
export async function notifyBacked(
  ctx: MutationCtx,
  args: { workId: Id<"works">; backerId: Id<"users">; at?: number },
) {
  const work = await ctx.db.get("works", args.workId);
  if (!work) return null;
  return await notify(ctx, {
    recipientId: work.creatorId,
    actorId: args.backerId,
    kind: "back",
    workId: work._id,
    at: args.at,
  });
}
