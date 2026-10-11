import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

// Creator № 1 is the owner's (bootstrapFirstSuperAdmin), so the counter starts at 2.
export const FIRST_ASSIGNED_CREATOR_NUMBER = 2;

export async function activeCreatorAccess(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("creatorAccess")
    .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
    .first();
}

export async function isCreator(ctx: Ctx, user: Doc<"users">) {
  if (user.platformRole === "super_admin_owner") return true;
  return (await activeCreatorAccess(ctx, user._id)) !== null;
}

// The next creator number, from the `creatorNumber` counter (seeded at 2).
export async function nextCreatorNumber(ctx: MutationCtx) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "creatorNumber"))
    .unique();
  if (!counter) {
    await ctx.db.insert("counters", { name: "creatorNumber", next: FIRST_ASSIGNED_CREATOR_NUMBER + 1 });
    return FIRST_ASSIGNED_CREATOR_NUMBER;
  }
  await ctx.db.patch("counters", counter._id, { next: counter.next + 1 });
  return counter.next;
}

// Turns creator access on (a "comp" row and a creator number, kept if they already have one)
// or off. Returns the member's creator number.
export async function setCreatorAccess(
  ctx: MutationCtx,
  user: Doc<"users">,
  active: boolean,
  options: { grantedBy?: Id<"users">; note?: string } = {},
): Promise<number | undefined> {
  const current = await activeCreatorAccess(ctx, user._id);
  if (!active) {
    if (current) await ctx.db.patch("creatorAccess", current._id, { active: false });
    return user.creatorNumber;
  }
  if (!current) {
    await ctx.db.insert("creatorAccess", {
      userId: user._id,
      source: "comp",
      active: true,
      grantedBy: options.grantedBy,
      activatedAt: Date.now(),
      note: options.note,
    });
  }
  return await ensureCreatorNumber(ctx, user);
}

// Keeps a member's creator number, or gives them the next one.
export async function ensureCreatorNumber(ctx: MutationCtx, user: Doc<"users">): Promise<number> {
  if (user.creatorNumber !== undefined) return user.creatorNumber;
  const creatorNumber = await nextCreatorNumber(ctx);
  await ctx.db.patch("users", user._id, { creatorNumber });
  // Sale shares held for them while they had no creator access become Pending (plan A1).
  await ctx.scheduler.runAfter(0, internal.earnings.releaseCreatorHolds, { userId: user._id });
  return creatorNumber;
}
