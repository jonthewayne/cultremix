import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAppSettings } from "./identity";
import { requireAdmin } from "./lib/adminAccess";
import {
  PROVIDER_FLAG,
  closeReservation,
  hasRoom,
  openReservation,
  readBudgetDay,
  spendValidator,
} from "./lib/budget";
import { DISPATCHED_EXPIRE_MS, EXPIRED_MESSAGE, QUEUED_EXPIRE_MS, UNKNOWN_MESSAGE, dayUtc } from "./lib/paidAttempts";
import { PRICING_VERSION } from "./lib/pricing";
import { budgetProvider } from "./schema/budget";
import { failAndRefund, flagEnabled, settleBatch } from "./studio";
import { failShootPhoto } from "./publish";
import { failPrintVersion } from "./print";
import type { Spend } from "./lib/paidAttempts";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// How many open reservations one sweep looks at; the next sweep takes the rest.
const SWEEP_BATCH = 100;

// Closes one reservation from an action (a reshoot that failed, or another area's paid call).
export const closeAttempt = internalMutation({
  args: { attemptId: v.string(), spend: spendValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await closeReservation(ctx, args.attemptId, args.spend);
    return null;
  },
});

// Admission for another area's paid call (an upscale on fal, say): true when the call's worst case
// fits today's budget and its provider's flag is on; the reservation is then open and dispatched.
// Close it with closeAttempt.
export const reserve = internalMutation({
  args: {
    attemptKind: v.union(v.literal("batch"), v.literal("tile"), v.literal("photo"), v.literal("upscale")),
    attemptId: v.string(),
    provider: budgetProvider,
    userId: v.optional(v.id("users")),
    credits: v.number(),
    worstCaseCents: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!(await flagEnabled(ctx, PROVIDER_FLAG[args.provider]))) return false;
    if (!(await hasRoom(ctx, args.provider, args.worstCaseCents, now))) return false;
    await openReservation(ctx, { ...args, dispatched: true }, now);
    return true;
  },
});

// Finishes an attempt whose action died ("Paid attempt lifecycle"): one never sent is released and
// expires ("Timed out before starting."); one sent and never finished is settled at its worst case
// and its outcome is unknown. Credits come back as for any missing design.
async function finishAbandoned(ctx: MutationCtx, reservation: Doc<"reservations">, sent: boolean) {
  const status = sent ? "unknown_outcome" : "expired";
  const message = sent ? UNKNOWN_MESSAGE : EXPIRED_MESSAGE;
  const spend: Spend = sent ? { kind: "settle", reason: "sweeper" } : { kind: "release", reason: "sweeper" };
  if (reservation.batchId) {
    const batchId = reservation.batchId;
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_batch", (q) => q.eq("batchId", batchId))
      .collect();
    await settleBatch(
      ctx,
      batchId,
      generations.map((g) => ({ index: g.index, error: message })),
      { missingStatus: status },
    );
  } else if (reservation.generationId) {
    const generation = await ctx.db.get("generations", reservation.generationId);
    if (generation && (generation.status === "queued" || generation.status === "dispatched")) {
      await failAndRefund(ctx, generation, message, status);
    }
  } else if (reservation.shootId) {
    const photo = await ctx.db
      .query("shootPhotos")
      .withIndex("by_shoot_index", (q) => q.eq("shootId", reservation.shootId!).eq("index", 1))
      .unique();
    // A reshoot keeps the photo that's up; only a first photo still pending is marked failed.
    if (photo?.state === "pending") await failShootPhoto(ctx, reservation.shootId, message);
  } else if (reservation.attemptKind === "upscale") {
    // An upscale's (or a background removal's) attempt is its print version; failing it gives the
    // credits back.
    const versionId = ctx.db.normalizeId("printVersions", reservation.attemptId);
    const version = versionId ? await ctx.db.get("printVersions", versionId) : null;
    if (version) await failPrintVersion(ctx, version, message, spend);
  }
  await closeReservation(ctx, reservation.attemptId, spend);
}

// Every 10 minutes (convex/crons.ts): settles or releases reservations left open by actions that died.
export const sweep = internalMutation({
  args: {},
  returns: v.object({ settled: v.number(), released: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("reservations")
      .withIndex("by_state_openedAt", (q) => q.eq("state", "open").lt("openedAt", now - QUEUED_EXPIRE_MS))
      .take(SWEEP_BATCH);
    let settled = 0;
    let released = 0;
    for (const reservation of stale) {
      if (reservation.dispatchedAt === undefined) {
        await finishAbandoned(ctx, reservation, false);
        released++;
      } else if (now - reservation.dispatchedAt > DISPATCHED_EXPIRE_MS) {
        await finishAbandoned(ctx, reservation, true);
        settled++;
      }
    }
    if (settled + released > 0) console.log("budget sweep", { settled, released });
    return { settled, released };
  },
});

const providerDay = v.object({
  provider: budgetProvider,
  // Whether the provider's flag is on; an overage turns it off.
  on: v.boolean(),
  capCents: v.number(),
  settledCents: v.number(),
  openCents: v.number(),
  openCount: v.number(),
  leftCents: v.number(),
  overageCents: v.number(),
  // Settled calls today, by where their cost came from.
  reportedCount: v.number(),
  worstCaseCount: v.number(),
});

// Today's spend for the admin overview: the cap, settled spend, open reservations, and what's left,
// for the CultRemix Gateway and for upscales.
export const today = query({
  args: {},
  returns: v.object({ dayUtc: v.string(), pricingVersion: v.number(), providers: v.array(providerDay) }),
  handler: async (ctx) => {
    await requireAdmin(ctx, "view");
    const now = Date.now();
    const day = dayUtc(now);
    const capCents = (await getAppSettings(ctx)).dailyBudgetCents;
    const providers = [];
    for (const provider of ["gateway", "fal"] as const) {
      const row = await readBudgetDay(ctx, provider, day);
      const open = await ctx.db
        .query("reservations")
        .withIndex("by_provider_day_state", (q) => q.eq("provider", provider).eq("dayUtc", day).eq("state", "open"))
        .take(1000);
      const settled = await ctx.db
        .query("reservations")
        .withIndex("by_provider_day_state", (q) => q.eq("provider", provider).eq("dayUtc", day).eq("state", "settled"))
        .take(2000);
      const settledCents = row?.settledCents ?? 0;
      const openCents = row?.openCents ?? 0;
      providers.push({
        provider,
        on: await flagEnabled(ctx, PROVIDER_FLAG[provider]),
        capCents,
        settledCents: Math.round(settledCents * 100) / 100,
        openCents,
        openCount: open.length,
        leftCents: Math.max(0, Math.round((capCents - settledCents - openCents) * 100) / 100),
        overageCents: row?.overageCents ?? 0,
        reportedCount: settled.filter((r) => r.costSource === "reported").length,
        worstCaseCount: settled.filter((r) => r.costSource !== "reported").length,
      });
    }
    return { dayUtc: day, pricingVersion: PRICING_VERSION, providers };
  },
});
