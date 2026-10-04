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
  const state = await ctx.db
    .query("notificationState")
    .withIndex("by_user", (q) => q.eq("userId", args.recipientId))
    .unique();
  if (state) {
    await ctx.db.patch("notificationState", state._id, { unread: state.unread + 1 });
  } else {
    await ctx.db.insert("notificationState", { userId: args.recipientId, unread: 1, lastReadAt: 0 });
  }
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
