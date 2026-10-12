import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, mutation, query } from "./_generated/server";
import { sendEmail } from "./email";
import { getViewerUser } from "./identity";
import { isFlagOn } from "./lib/flagState";
import { formatCr } from "./lib/r2";
import { saleEmailContent } from "./lib/saleEmail";
import { requireMember } from "./studio";
import type { SoldLine } from "./lib/saleEmail";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// The "someone bought your design" email, alongside the notification, while the "Sale emails"
// switch is on. One per recipient per order; never for test orders; never to a member who turned
// them off in Settings. earnings.notifyNewSales schedules it after the order's sale rows are written.

export const SALE_EMAILS_FLAG = "email.sales";

type Total = { workId: Id<"works">; cents: number; units: number };

// Called by earnings.notifyNewSales once per recipient of a real (non-test) order's new sales.
export async function scheduleSaleEmail(ctx: MutationCtx, recipientId: Id<"users">, totals: Array<Total>) {
  if (totals.length === 0 || !(await isFlagOn(ctx, SALE_EMAILS_FLAG))) return;
  const user = await ctx.db.get("users", recipientId);
  if (!user?.email || user.saleEmails === false) return;
  const lines = await saleLines(ctx, recipientId, totals);
  if (lines.length > 0) await ctx.scheduler.runAfter(0, internal.saleEmails.send, { to: user.email, lines });
}

// The email's lines for one recipient: each work, with the recipient's own design it came from
// when it's someone else's remix.
export async function saleLines(ctx: MutationCtx, recipientId: Id<"users">, totals: Array<Total>): Promise<Array<SoldLine>> {
  const lines: Array<SoldLine> = [];
  for (const total of totals) {
    const work = await ctx.db.get("works", total.workId);
    if (!work) continue;
    let from: SoldLine["from"];
    if (work.creatorId !== recipientId) {
      let parentId = work.parentWorkId;
      for (let step = 0; parentId && step < 50; step++) {
        const parent = await ctx.db.get("works", parentId);
        if (!parent) break;
        if (parent.creatorId === recipientId) {
          from = { title: parent.title, cr: formatCr(parent.crFamily, parent.crExpression) };
          break;
        }
        parentId = parent.parentWorkId;
      }
    }
    // A kept design (just for its creator) is never named to anyone else it pays: no title, and its
    // family-0 number isn't a CR number.
    const shown = work.status !== "private";
    lines.push({
      ...(shown ? { title: work.title, cr: formatCr(work.crFamily, work.crExpression) } : {}),
      cents: total.cents,
      units: total.units,
      from,
    });
  }
  return lines;
}

const lineValidator = v.object({
  title: v.optional(v.string()),
  cr: v.optional(v.string()),
  cents: v.number(),
  units: v.number(),
  from: v.optional(v.object({ title: v.optional(v.string()), cr: v.string() })),
});

export const send = internalAction({
  args: { to: v.string(), lines: v.array(lineValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const siteUrl = process.env.SITE_URL ?? "https://cultremix.com";
    await sendEmail(ctx, { to: args.to, ...saleEmailContent({ lines: args.lines, siteUrl }) });
    return null;
  },
});

// For Settings: whether the switch is on (so the choice is worth showing) and the member's choice.
export const preference = query({
  args: {},
  returns: v.union(v.null(), v.object({ available: v.boolean(), on: v.boolean() })),
  handler: async (ctx) => {
    const user = await getViewerUser(ctx);
    if (!user) return null;
    return { available: await isFlagOn(ctx, SALE_EMAILS_FLAG), on: user.saleEmails !== false };
  },
});

export const setPreference = mutation({
  args: { on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMember(ctx);
    await ctx.db.patch("users", user._id, { saleEmails: args.on ? undefined : false });
    return null;
  },
});

