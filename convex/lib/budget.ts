// The daily image budget's bookkeeping (plan KTD-4), called inside the mutations that admit,
// dispatch, and finish each paid call, so a reservation and its day's totals always change in the
// same transaction. Convex mutations are serializable transactions that both read and write the
// day's row, so two batches racing for the last of the budget can't both be admitted.
import { v } from "convex/values";
import { getAppSettings } from "../identity";
import { PRICING_VERSION } from "./pricing";
import { dayUtc } from "./paidAttempts";
import type { budgetProvider } from "../schema/budget";
import type { Infer } from "convex/values";
import type { Spend } from "./paidAttempts";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type BudgetProvider = Infer<typeof budgetProvider>;

export const spendValidator = v.union(
  v.object({ kind: v.literal("release"), reason: v.optional(v.string()) }),
  v.object({ kind: v.literal("settle"), actualCents: v.optional(v.number()), reason: v.optional(v.string()) }),
);

// The flag an overage turns off for each provider (convex/lib/flags.ts).
export const PROVIDER_FLAG: Record<BudgetProvider, string> = {
  gateway: "gen.vercel",
  fal: "gen.upscale",
};

// What the warm refusal says when the day's budget is spent.
export const BUDGET_RESTING = "The studio is resting until tomorrow.";

// Which service the studio's images go through, as convex/studio.ts generate decides it:
// IMAGE_PROVIDER forces one; otherwise the ChatGPT login wins when its token is set. Only the
// CultRemix Gateway is billed per call, so only its calls hold reservations.
export function imageProviderSetting(): "gateway" | "chatgpt" {
  const forced = process.env.IMAGE_PROVIDER;
  if (forced === "gateway" || forced === "chatgpt") return forced;
  return process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCOUNT_ID ? "chatgpt" : "gateway";
}

export async function readBudgetDay(ctx: QueryCtx | MutationCtx, provider: BudgetProvider, day: string) {
  return await ctx.db
    .query("budgetDays")
    .withIndex("by_provider_day", (q) => q.eq("provider", provider).eq("dayUtc", day))
    .unique();
}

// What's left of a provider's day: the cap now in force, minus settled spend and open reservations.
export async function budgetLeft(ctx: QueryCtx | MutationCtx, provider: BudgetProvider, now: number) {
  const settings = await getAppSettings(ctx);
  const row = await readBudgetDay(ctx, provider, dayUtc(now));
  return settings.dailyBudgetCents - (row?.settledCents ?? 0) - (row?.openCents ?? 0);
}

export async function hasRoom(ctx: MutationCtx, provider: BudgetProvider, cents: number, now: number) {
  return cents <= (await budgetLeft(ctx, provider, now));
}

async function adjustDay(
  ctx: MutationCtx,
  provider: BudgetProvider,
  day: string,
  change: { openCents?: number; settledCents?: number; overageCents?: number },
) {
  const row = await readBudgetDay(ctx, provider, day);
  const capCents = (await getAppSettings(ctx)).dailyBudgetCents;
  if (!row) {
    await ctx.db.insert("budgetDays", {
      provider,
      dayUtc: day,
      capCents,
      openCents: Math.max(0, change.openCents ?? 0),
      settledCents: change.settledCents ?? 0,
      overageCents: change.overageCents || undefined,
    });
    return;
  }
  await ctx.db.patch("budgetDays", row._id, {
    capCents,
    // Rounding guard: open reservations are whole cents, but never let the total go below zero.
    openCents: Math.max(0, row.openCents + (change.openCents ?? 0)),
    settledCents: row.settledCents + (change.settledCents ?? 0),
    ...(change.overageCents ? { overageCents: (row.overageCents ?? 0) + change.overageCents } : {}),
  });
}

// Holds the worst case of one paid attempt against today's budget. Call hasRoom first, in the same
// mutation, for the whole batch.
export async function openReservation(
  ctx: MutationCtx,
  attempt: {
    attemptKind: Doc<"reservations">["attemptKind"];
    attemptId: string;
    batchId?: Id<"batches">;
    generationId?: Id<"generations">;
    shootId?: Id<"shoots">;
    provider: BudgetProvider;
    userId?: Id<"users">;
    credits: number;
    worstCaseCents: number;
    // Set for calls that are sent as soon as they're admitted (model photos).
    dispatched?: boolean;
  },
  now: number,
) {
  const { dispatched, ...fields } = attempt;
  const day = dayUtc(now);
  const id = await ctx.db.insert("reservations", {
    ...fields,
    dayUtc: day,
    pricingVersion: PRICING_VERSION,
    state: "open",
    openedAt: now,
    dispatchedAt: dispatched ? now : undefined,
  });
  await adjustDay(ctx, attempt.provider, day, { openCents: attempt.worstCaseCents });
  return id;
}

export async function reservationFor(ctx: QueryCtx | MutationCtx, attemptId: string) {
  return await ctx.db
    .query("reservations")
    .withIndex("by_attempt", (q) => q.eq("attemptId", attemptId))
    .unique();
}

// The dispatch check: an attempt with a reservation may be sent only while that reservation is
// open. Attempts without one (the ChatGPT path) aren't budgeted and always pass.
export async function authorizeDispatch(ctx: MutationCtx, attemptId: string, now: number) {
  const reservation = await reservationFor(ctx, attemptId);
  if (!reservation) return true;
  if (reservation.state !== "open") return false;
  if (reservation.dispatchedAt === undefined) {
    await ctx.db.patch("reservations", reservation._id, { dispatchedAt: now });
  }
  return true;
}

async function setFlagOff(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) {
    if (row.enabled) await ctx.db.patch("featureFlags", row._id, { enabled: false });
  } else {
    await ctx.db.insert("featureFlags", { key, enabled: false });
  }
}

// Ends a reservation. Release gives the whole hold back (nothing was spent). Settle records what
// the call cost: the gateway's reported cost, else the worst case. A reported cost above the
// reservation is an overage: it's recorded and the provider's flag goes off until an admin turns
// it back on (INV-12). Closing an already closed reservation does nothing.
export async function closeReservation(ctx: MutationCtx, attemptId: string, spend: Spend, now = Date.now()) {
  const reservation = await reservationFor(ctx, attemptId);
  if (!reservation || reservation.state !== "open") return null;
  if (spend.kind === "release") {
    await ctx.db.patch("reservations", reservation._id, { state: "released", closedAt: now, reason: spend.reason });
    await adjustDay(ctx, reservation.provider, reservation.dayUtc, { openCents: -reservation.worstCaseCents });
    return reservation;
  }
  const reported = spend.actualCents !== undefined && Number.isFinite(spend.actualCents) && spend.actualCents >= 0;
  const actualCents = reported ? spend.actualCents! : reservation.worstCaseCents;
  const overageCents = Math.max(0, Math.round((actualCents - reservation.worstCaseCents) * 100) / 100);
  await ctx.db.patch("reservations", reservation._id, {
    state: "settled",
    closedAt: now,
    actualCents,
    costSource: reported ? "reported" : "worst_case",
    overageCents: overageCents > 0 ? overageCents : undefined,
    reason: spend.reason,
  });
  await adjustDay(ctx, reservation.provider, reservation.dayUtc, {
    openCents: -reservation.worstCaseCents,
    settledCents: actualCents,
    overageCents,
  });
  if (overageCents > 0) {
    console.warn("budget overage", reservation.provider, attemptId, actualCents, "cents against", reservation.worstCaseCents);
    await setFlagOff(ctx, PROVIDER_FLAG[reservation.provider]);
  }
  return reservation;
}

// What one member's attempts hold or cost today, in cents (open at worst case, settled at cost).
export async function memberSpendToday(ctx: QueryCtx | MutationCtx, userId: Id<"users">, now: number) {
  const rows = await ctx.db
    .query("reservations")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("dayUtc", dayUtc(now)))
    .take(500);
  let cents = 0;
  for (const row of rows) {
    if (row.state === "open") cents += row.worstCaseCents;
    else if (row.state === "settled") cents += row.actualCents ?? row.worstCaseCents;
  }
  return Math.round(cents * 100) / 100;
}
