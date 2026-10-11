import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { sendEmail } from "./email";
import { notifyOrderAttention } from "./lib/notifications";
import { STUCK_STATES, alertKey, lateTrouble, orderAlertEmailContent, stuckReason } from "./lib/orderAlert";
import { autoConfirmAllowedByEnv, autoConfirmFlagAllows, deploymentEnv } from "./lib/shopFlags";
import type { Doc } from "./_generated/dataModel";

// Orders that can't go on by themselves (fulfillment's needs_attention and manual_required, and
// Printful's on_hold) tell the people who can fix them: the owner and ops staff get a notification
// linking to Admin, Orders, and the owner an email. The fulfillment notes say these "go to the
// owner"; until now only Admin, Orders showed them. Paid orders that are late alert the same way
// (lib/orderAlert.ts lateTrouble): still waiting an hour after payment, or a production draft an hour
// past its hold. Each order alerts once per state and reason, or kind of lateness
// (orders.alertedFor). A cron runs it every 15 minutes.

const SCAN = 50;

export const alertStuck = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const owners = await ctx.db
      .query("users")
      .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_owner"))
      .take(5);
    const ops = await ctx.db
      .query("users")
      .withIndex("by_platformRole", (q) => q.eq("platformRole", "super_admin_ops"))
      .take(20);
    let alerted = 0;
    const tell = async (order: Doc<"orders">, key: string, reason: string) => {
      await ctx.db.patch("orders", order._id, { alertedFor: key });
      const orderName = order.orderName ?? `#${order.shopifyOrderId}`;
      for (const person of [...owners, ...ops]) {
        await notifyOrderAttention(ctx, { recipientId: person._id, orderName, reason });
      }
      for (const owner of owners) {
        if (owner.email) await ctx.scheduler.runAfter(0, internal.orderAlerts.sendAlert, { to: owner.email, orderName, reason });
      }
      alerted++;
    };
    for (const state of STUCK_STATES) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_fulfillmentState_updated", (q) => q.eq("fulfillmentState", state))
        .order("desc")
        .take(SCAN);
      for (const order of orders) {
        const key = alertKey(state, order.attentionReason);
        if (order.alertedFor === key) continue;
        await tell(order, key, stuckReason(state, order.attentionReason));
      }
    }
    // Late: paid and still waiting, or (production only, since dev and staging stop at drafts) a
    // draft past its hold.
    const now = Date.now();
    const confirming = { prod: deploymentEnv() === "prod", env: autoConfirmAllowedByEnv(), flag: await autoConfirmFlagAllows(ctx) };
    for (const state of confirming.prod ? (["waiting", "draft"] as const) : (["waiting"] as const)) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_fulfillmentState_updated", (q) => q.eq("fulfillmentState", state))
        .order("desc")
        .take(SCAN);
      for (const order of orders) {
        const late = lateTrouble(order, now, confirming);
        if (!late || order.alertedFor === late.key) continue;
        await tell(order, late.key, late.reason);
      }
    }
    return alerted;
  },
});

export const sendAlert = internalAction({
  args: { to: v.string(), orderName: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const siteUrl = process.env.SITE_URL ?? "https://cultremix.com";
    await sendEmail(ctx, { to: args.to, ...orderAlertEmailContent({ orderName: args.orderName, reason: args.reason, siteUrl }) });
    return null;
  },
});
