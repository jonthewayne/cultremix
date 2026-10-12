import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getViewerUser } from "./identity";
import { chainWritesEnabled, enqueueBack } from "./lib/chain/queue";
import { registryWeek } from "./lib/chain/writes";
import { isFlagOn } from "./lib/flagState";
import { backStatusValidator } from "./schema/chain";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Backs (R28/R29): a member's public, onchain show of support for a work, signed by their
// wallet and sent by the relayer. A Back carries no money and no promise of any (KD8).
//
// Admission: signed in with a username, a verified email, a ready wallet, the Backs and Monad
// records switches on, a published work registered on Monad, not your own, once per work, and at
// most 3 per registry week counting reserved, submitted, and confirmed Backs. The registry enforces
// the same weekly limit, self-Back, and once-per-work rules, and the backer's ordinal comes from
// its Backed event.

export const MAX_BACKS_PER_WEEK = 3;
const EARLIEST_SHOWN = 10;

type Ctx = QueryCtx | MutationCtx;
type Refusal = { code: string; message: string };

/** Backing is open when both the Backs switch (social.backs) and Monad records (chain.writes) are on. */
async function backingOpen(ctx: Ctx) {
  return (await isFlagOn(ctx, "social.backs")) && (await chainWritesEnabled(ctx));
}

function counts(back: Doc<"backs">) {
  return back.status === "reserved" || back.status === "submitted" || back.status === "confirmed";
}

async function backsThisWeek(ctx: Ctx, user: Doc<"users">, week: number) {
  const backs = await ctx.db
    .query("backs")
    .withIndex("by_backer_and_week", (q) => q.eq("backerId", user._id).eq("week", week))
    .take(50);
  return backs.filter(counts).length;
}

async function viewerBack(ctx: Ctx, work: Doc<"works">, user: Doc<"users">) {
  return await ctx.db
    .query("backs")
    .withIndex("by_work_and_backer", (q) => q.eq("workId", work._id).eq("backerId", user._id))
    .unique();
}

/** Why this member can't Back this work right now, or null when they can. */
async function refusal(ctx: Ctx, user: Doc<"users"> | null, work: Doc<"works"> | null): Promise<Refusal | null> {
  if (!user) return { code: "SIGNED_OUT", message: "Sign in to Back this work." };
  if (!user.username) return { code: "NEEDS_USERNAME", message: "Pick a username first." };
  if (user.emailVerified !== true) return { code: "EMAIL_UNVERIFIED", message: "Verify your email to Back work." };
  if (!work || work.status !== "published") return { code: "NOT_PUBLISHED", message: "This design isn’t published." };
  if (work.creatorId === user._id) return { code: "OWN_WORK", message: "You can't Back your own work." };
  const existing = await viewerBack(ctx, work, user);
  if (existing && counts(existing)) return { code: "ALREADY_BACKED", message: "You've Backed this work." };
  if (!(await backingOpen(ctx))) return { code: "PAUSED", message: "Backing is paused right now." };
  if (work.provenanceStatus !== "confirmed") {
    return { code: "NOT_REGISTERED", message: "This work can be Backed once it's registered on Monad." };
  }
  if (user.walletStatus !== "ready" || !user.walletAddress) {
    return { code: "WALLET_NOT_READY", message: "Your wallet is still being set up. Try again in a minute." };
  }
  if ((await backsThisWeek(ctx, user, registryWeek(Date.now()))) >= MAX_BACKS_PER_WEEK) {
    return { code: "WEEKLY_LIMIT", message: "You've used your 3 Backs for this registry week." };
  }
  return null;
}

/** Backs a work. The Back is reserved now and recorded onchain by the relayer. */
export const back = mutation({
  args: { workId: v.id("works") },
  returns: v.object({ backId: v.id("backs") }),
  handler: async (ctx, args) => {
    const user = await getViewerUser(ctx);
    const work = await ctx.db.get("works", args.workId);
    const refused = await refusal(ctx, user, work);
    if (refused) throw new ConvexError(refused);
    const backer = user!;
    const now = Date.now();
    const fields = { status: "reserved" as const, week: registryWeek(now), createdAt: now };
    // A Back that failed or was rejected doesn't count; Backing again reuses its row and write.
    const previous = await viewerBack(ctx, work!, backer);
    const backId = previous ? previous._id : await ctx.db.insert("backs", { workId: work!._id, backerId: backer._id, ...fields });
    if (previous) {
      await ctx.db.patch("backs", backId, { ...fields, ordinal: undefined, txHash: undefined, error: undefined, confirmedAt: undefined });
    }
    const chainWriteId = await enqueueBack(ctx, { backId, work: work!, backer });
    await ctx.db.patch("backs", backId, { chainWriteId });
    return { backId };
  },
});

const backerValidator = v.object({ ordinal: v.number(), username: v.union(v.null(), v.string()), isViewer: v.boolean() });

/** A work's Backs for its page: the earliest backers, the viewer's own Back, and whether they can Back. */
export const forWork = query({
  args: { workId: v.id("works") },
  returns: v.union(
    v.null(),
    v.object({
      count: v.number(),
      earliest: v.array(backerValidator),
      viewer: v.union(
        v.null(),
        v.object({
          status: backStatusValidator,
          ordinal: v.union(v.null(), v.number()),
          error: v.union(v.null(), v.string()),
        }),
      ),
      canBack: v.boolean(),
      reason: v.union(v.null(), v.object({ code: v.string(), message: v.string() })),
      // Whether Backing is switched on at all; the work page hides Backers while it's off and empty.
      open: v.boolean(),
      weeklyLimit: v.number(),
      weeklyUsed: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const work = await ctx.db.get("works", args.workId);
    if (!work || work.status !== "published") return null;
    const user = await getViewerUser(ctx);
    const earliestBacks = await ctx.db
      .query("backs")
      .withIndex("by_work_and_ordinal", (q) => q.eq("workId", work._id).gte("ordinal", 1))
      .take(EARLIEST_SHOWN);
    // Ordinals run 1, 2, 3… onchain, so the highest is the count of recorded Backs.
    const latest = await ctx.db
      .query("backs")
      .withIndex("by_work_and_ordinal", (q) => q.eq("workId", work._id).gte("ordinal", 1))
      .order("desc")
      .first();
    const earliest = [];
    for (const back of earliestBacks) {
      const backer = await ctx.db.get("users", back.backerId);
      earliest.push({ ordinal: back.ordinal!, username: backer?.username ?? null, isViewer: user?._id === back.backerId });
    }
    const mine = user ? await viewerBack(ctx, work, user) : null;
    const reason = await refusal(ctx, user, work);
    return {
      count: latest?.ordinal ?? 0,
      earliest,
      viewer: mine ? { status: mine.status, ordinal: mine.ordinal ?? null, error: mine.error ?? null } : null,
      canBack: reason === null,
      reason,
      open: await backingOpen(ctx),
      weeklyLimit: MAX_BACKS_PER_WEEK,
      weeklyUsed: user ? await backsThisWeek(ctx, user, registryWeek(Date.now())) : null,
    };
  },
});
