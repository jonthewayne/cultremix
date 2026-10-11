import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { sendEmail } from "./email";
import { notifyOpsAlert } from "./lib/notifications";
import { BATCH_CENTS, creditLevel, creditWorsened } from "../shared/config/gatewayCredit";

// The gateway credit watch (convex/gatewayCredit.ts watch reads the balance; this decides). When
// the balance drops below $10, and again when it runs out, the owner and ops staff get a bell
// notification linking to Admin and the owner an email. It tells once per drop: the level is
// kept in opsAlerts, and going back above $10 resets it.

const GATEWAY_KEY = "gateway-credit";
const RELAYER_KEY = "relayer-mon";

// The owner and ops staff, who hear about these.
async function staff(ctx: MutationCtx) {
  const owners = await ctx.db
    .query("users")
    .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_owner"))
    .take(5);
  const ops = await ctx.db
    .query("users")
    .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_ops"))
    .take(20);
  return { owners, everyone: [...owners, ...ops] };
}

// Records an alert's level and says whether it just got worse (so it's told once per drop).
async function moveTo(ctx: MutationCtx, key: string, level: "ok" | "low" | "out") {
  const row = await ctx.db
    .query("opsAlerts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const before = row?.level as "ok" | "low" | "out" | undefined;
  const now = Date.now();
  if (row) await ctx.db.patch("opsAlerts", row._id, { level, updatedAt: now });
  else await ctx.db.insert("opsAlerts", { key, level, updatedAt: now });
  return creditWorsened(before, level);
}

// The Monad relayer ran out of MON (convex/chain.ts held a write for it) or has MON again. While it's
// out, published designs wait for their Monad record; told once until a write goes through again.
export const recordRelayerFunds = internalMutation({
  args: { out: v.boolean(), network: v.string(), address: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await moveTo(ctx, RELAYER_KEY, args.out ? "out" : "ok"))) return null;
    const message = `The Monad relayer is out of MON, so new designs wait for their ${args.network} record. Send MON to ${args.address}; /admin/chain shows its balance.`;
    const { owners, everyone } = await staff(ctx);
    for (const person of everyone) await notifyOpsAlert(ctx, { recipientId: person._id, message });
    for (const owner of owners) {
      if (owner.email) await ctx.scheduler.runAfter(0, internal.opsAlerts.sendCreditEmail, { to: owner.email, message, out: true, subject: "CultRemix's Monad relayer needs MON" });
    }
    return null;
  },
});

function dollars(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export function creditMessage(balanceCents: number) {
  const level = creditLevel(balanceCents);
  if (level === "out") return "The image credit has run out, so new designs fail. Add credit to the CultRemix Gateway account.";
  return `The image credit is low: ${dollars(balanceCents)} left, about ${Math.floor(balanceCents / BATCH_CENTS)} batches. Add credit to the CultRemix Gateway account before it runs out.`;
}

export const recordGatewayCredit = internalMutation({
  args: { balanceCents: v.number() },
  returns: v.union(v.literal("ok"), v.literal("low"), v.literal("out")),
  handler: async (ctx, args) => {
    const level = creditLevel(args.balanceCents);
    if (!(await moveTo(ctx, GATEWAY_KEY, level))) return level;

    const message = creditMessage(args.balanceCents);
    const { owners, everyone } = await staff(ctx);
    for (const person of everyone) await notifyOpsAlert(ctx, { recipientId: person._id, message });
    for (const owner of owners) {
      if (owner.email) {
        await ctx.scheduler.runAfter(0, internal.opsAlerts.sendCreditEmail, { to: owner.email, message, out: level === "out" });
      }
    }
    return level;
  },
});

export const sendCreditEmail = internalAction({
  args: { to: v.string(), message: v.string(), out: v.boolean(), subject: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const site = (process.env.SITE_URL ?? "https://cultremix.com").replace(/\/+$/u, "");
    const subject = args.subject ?? (args.out ? "CultRemix's image credit ran out" : "CultRemix's image credit is low");
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    await sendEmail(ctx, {
      to: args.to,
      subject,
      text: `${args.message}\n\nAdmin: ${site}/admin`,
      html:
        '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;"><div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">' +
        '<p style="margin:0 0 24px;font-size:13px;font-weight:900;letter-spacing:0.2em;">CULTREMIX</p>' +
        '<p style="margin:0 0 24px;font-size:18px;line-height:1.4;font-weight:700;">' +
        escape(args.message) +
        "</p>" +
        '<p style="margin:0;"><a href="' +
        escape(`${site}/admin`) +
        '" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 20px;border-radius:12px;">Admin</a></p></div></body></html>',
    });
    return null;
  },
});
