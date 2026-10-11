// When an order needs a person (convex/orderAlerts.ts): what to call the trouble, and the email to
// the owner. Pure, so it's tested without sending anything.

export const STUCK_STATES = ["needs_attention", "manual_required", "on_hold"] as const;
export type StuckState = (typeof STUCK_STATES)[number];

// What went wrong, in words: the order's own reason, else what the state means.
export function stuckReason(state: StuckState, reason: string | undefined) {
  if (reason?.trim()) return reason.trim();
  if (state === "on_hold") return "Printful put it on hold. Its dashboard says why (often billing or the address).";
  if (state === "manual_required") return "It needs to be made in Printful by hand.";
  return "It needs a look before it can go to print.";
}

// The same trouble alerts once; a new state or reason alerts again.
export function alertKey(state: StuckState, reason: string | undefined) {
  return `${state}:${stuckReason(state, reason)}`.slice(0, 600);
}

// A paid order reaches Printful within minutes, and production confirms its draft when the hour's
// hold ends (convex/fulfillment.ts). An order still waiting an hour after payment, or a production
// draft an hour past its hold, can't go on by itself either: Printful isn't connected, its calls keep
// failing, or confirming is off. Those alert like a stuck order, once per kind of trouble, so a retry
// that fails with a new message doesn't alert again.
export const LATE_MS = 60 * 60 * 1000;
const HOLD_MS = 60 * 60 * 1000;
// fulfillment.run's error while PRINTFUL_API_TOKEN or PRINTFUL_STORE_ID is missing.
export const NOT_CONFIGURED = "Printful is not configured yet.";

export type LateFields = {
  fulfillmentState: string;
  economicEventAt?: number;
  holdUntil?: number;
  cancelled: boolean;
  isTest: boolean;
  simulated: boolean;
  fulfillmentError?: string;
};

// Whether this deployment confirms drafts by itself: production (prod), PRINTFUL_AUTO_CONFIRM=true
// (env), and the Send paid orders to print switch on (flag).
export type Confirming = { prod: boolean; env: boolean; flag: boolean };

export function lateTrouble(order: LateFields, now: number, confirming: Confirming): { key: string; reason: string } | null {
  const paidAt = order.economicEventAt;
  if (paidAt === undefined || order.cancelled || (order.isTest && !order.simulated)) return null;
  if (order.fulfillmentState === "waiting") {
    if (now - paidAt < LATE_MS) return null;
    if (order.fulfillmentError === NOT_CONFIGURED) {
      return {
        key: "late:unconfigured",
        reason:
          "It's paid, but Printful isn't connected here (PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID), so it can't go to print. It goes on by itself once Printful is connected.",
      };
    }
    const error = order.fulfillmentError?.trim();
    return {
      key: "late:waiting",
      reason: error
        ? `It was paid over an hour ago and still hasn't reached Printful. The last try said: ${error}`
        : "It was paid over an hour ago and still hasn't reached Printful.",
    };
  }
  if (order.fulfillmentState === "draft" && confirming.prod) {
    if (now - (order.holdUntil ?? paidAt + HOLD_MS) < LATE_MS) return null;
    if (!confirming.env) {
      return {
        key: "late:draft-env",
        reason:
          "Its Printful draft is waiting to be confirmed, and production doesn't confirm drafts by itself until PRINTFUL_AUTO_CONFIRM is true. Confirm it in Printful, or ask Ops to set it.",
      };
    }
    if (!confirming.flag) {
      return {
        key: "late:draft-paused",
        reason:
          "Its Printful draft is waiting to be confirmed, and Send paid orders to print is off in Admin, Switches. Confirm it in Printful, or turn the switch back on.",
      };
    }
    return {
      key: "late:draft",
      reason: "Its Printful draft should have been confirmed when its hold ended, an hour after payment, and still hasn't been. Check it in Printful.",
    };
  }
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function orderAlertEmailContent(args: { orderName: string; reason: string; siteUrl: string }) {
  const site = args.siteUrl.replace(/\/+$/u, "");
  const orders = `${site}/admin/orders`;
  const subject = `Order ${args.orderName} needs you`;
  const lead = `Order ${args.orderName} can't go on by itself: ${args.reason}`;
  const text = [lead, "", `Admin, Orders: ${orders}`].join("\n");
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Helvetica,Arial,sans-serif;color:#000000;">',
    '<p style="margin:0 0 24px;font-size:13px;font-weight:900;letter-spacing:0.2em;">CULTREMIX</p>',
    '<p style="margin:0 0 24px;font-size:18px;line-height:1.4;font-weight:700;">' + escapeHtml(lead) + "</p>",
    '<p style="margin:0;"><a href="' + escapeHtml(orders) + '" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-weight:900;padding:12px 20px;border-radius:12px;">Admin, Orders</a></p>',
    "</div></body></html>",
  ].join("");
  return { subject, text, html };
}
